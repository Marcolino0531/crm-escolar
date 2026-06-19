// Integração com a API da Nuvemshop (lado servidor). Usada pelos endpoints
// nativos da Vercel roteados em `src/server.ts`:
//   POST /api/nuvemshop/sync     — reconciliação/auditoria (polling) do catálogo
//   POST /api/nuvemshop/webhook  — eventos em tempo real (produto/pedido)
//   GET  /api/nuvemshop/cron     — auditoria noturna (Vercel Cron, 03h)
//
// Variáveis de ambiente (painel da Vercel):
//   NUVEMSHOP_STORE_ID, NUVEMSHOP_ACCESS_TOKEN
//   NUVEMSHOP_WEBHOOK_TOKEN (token da query string que protege o webhook)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (já existentes — gravam o estoque)
//   CRON_SECRET (opcional — protege o endpoint de cron)
//
// Docs: https://tiendanube.github.io/api-documentation/

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const API_BASE = "https://api.nuvemshop.com.br/v1";

type Localized = { pt?: string } | string;

type NuvemshopVariant = {
  id: number;
  product_id: number;
  stock: number | null;
  sku: string | null;
  price: string | null;
  values?: { pt?: string; es?: string; en?: string }[];
};

type NuvemshopProduct = {
  id: number;
  name: Localized;
  handle?: Localized;
  published?: boolean;
  categories?: { name?: Localized }[];
  variants?: NuvemshopVariant[];
};

export type SyncResult = { products: number; variants: number; discrepancies: number };

function readLocalized(v: Localized | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.pt ?? Object.values(v)[0] ?? "";
}

function variantSize(v: NuvemshopVariant): string {
  if (!v.values || v.values.length === 0) return "Único";
  return (
    v.values
      .map((val) => readLocalized(val))
      .filter(Boolean)
      .join(" / ") || "Único"
  );
}

function getNuvemshopEnv() {
  const storeId = process.env.NUVEMSHOP_STORE_ID;
  const token = process.env.NUVEMSHOP_ACCESS_TOKEN;
  if (!storeId || !token) {
    throw new Error(
      "Credenciais da Nuvemshop ausentes: defina NUVEMSHOP_STORE_ID e NUVEMSHOP_ACCESS_TOKEN.",
    );
  }
  return { storeId, token };
}

async function nuvemshopFetch(path: string): Promise<Response> {
  const { storeId, token } = getNuvemshopEnv();
  return fetch(`${API_BASE}/${storeId}${path}`, {
    headers: {
      // A Nuvemshop usa o header "Authentication" (não "Authorization").
      Authentication: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "SchoolHub CRM (suporte@schoolhub.app)",
    },
  });
}

async function fetchAllProducts(): Promise<NuvemshopProduct[]> {
  const products: NuvemshopProduct[] = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const res = await nuvemshopFetch(
      `/products?page=${page}&per_page=${perPage}&fields=id,name,handle,published,categories,variants`,
    );
    if (res.status === 404) break;
    if (!res.ok) {
      throw new Error(`Nuvemshop GET /products falhou: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as NuvemshopProduct[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    products.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return products;
}

async function fetchProduct(productId: number | string): Promise<NuvemshopProduct | null> {
  const res = await nuvemshopFetch(`/products/${productId}`);
  if (!res.ok) return null;
  return (await res.json()) as NuvemshopProduct;
}

// Espelha (upsert) os produtos + variações da Nuvemshop no Supabase. Conta como
// "discrepância" toda variação cujo estoque local divergia do estoque da API.
async function upsertCatalog(products: NuvemshopProduct[]): Promise<SyncResult> {
  let variantCount = 0;
  let discrepancies = 0;

  const { data: existing } = await supabaseAdmin
    .from("uniform_variants" as never)
    .select("ns_variant_id, stock");
  const localStock = new Map<string, number>();
  for (const row of (existing ?? []) as { ns_variant_id: string; stock: number }[]) {
    localStock.set(String(row.ns_variant_id), Number(row.stock));
  }

  for (const p of products) {
    const productRow = {
      ns_product_id: String(p.id),
      name: readLocalized(p.name),
      category: p.categories?.[0] ? readLocalized(p.categories[0].name) : null,
      handle: readLocalized(p.handle) || null,
      active: p.published ?? true,
    };
    const { error: pErr } = await supabaseAdmin
      .from("uniform_products" as never)
      .upsert(productRow as never, { onConflict: "ns_product_id" });
    if (pErr) throw new Error(`upsert produto ${p.id}: ${pErr.message}`);

    for (const v of p.variants ?? []) {
      const stock = Number(v.stock ?? 0);
      const prev = localStock.get(String(v.id));
      if (prev !== undefined && prev !== stock) discrepancies += 1;
      const variantRow = {
        ns_variant_id: String(v.id),
        ns_product_id: String(p.id),
        size: variantSize(v),
        sku: v.sku ?? null,
        stock,
        price: v.price ? Number(v.price) : null,
      };
      const { error: vErr } = await supabaseAdmin
        .from("uniform_variants" as never)
        .upsert(variantRow as never, { onConflict: "ns_variant_id" });
      if (vErr) throw new Error(`upsert variação ${v.id}: ${vErr.message}`);
      variantCount += 1;
    }
  }

  return { products: products.length, variants: variantCount, discrepancies };
}

async function logSync(
  source: string,
  status: string,
  extra: Partial<SyncResult> & { message?: string } = {},
): Promise<void> {
  await supabaseAdmin.from("uniform_sync_log" as never).insert({
    source,
    status,
    products_synced: extra.products ?? 0,
    variants_synced: extra.variants ?? 0,
    discrepancies: extra.discrepancies ?? 0,
    message: extra.message ?? null,
    finished_at: new Date().toISOString(),
  } as never);
}

// Reconciliação completa do catálogo (acionada pelo botão da UI e pelo cron).
export async function runFullSync(source: "manual" | "cron"): Promise<SyncResult> {
  try {
    const products = await fetchAllProducts();
    const result = await upsertCatalog(products);
    await logSync(source, "ok", result);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSync(source, "error", { message });
    throw e;
  }
}

type WebhookPayload = { store_id: number; event: string; id: number };

// Processa um evento de webhook já validado (produto atualizado ou pedido criado).
export async function handleWebhookEvent(payload: WebhookPayload): Promise<void> {
  try {
    if (payload.event.startsWith("product/")) {
      const product = await fetchProduct(payload.id);
      if (product) await upsertCatalog([product]);
    } else if (payload.event.startsWith("order/")) {
      const res = await nuvemshopFetch(`/orders/${payload.id}`);
      if (res.ok) {
        const order = (await res.json()) as {
          products?: { variant_id?: number; variant?: { id?: number }; quantity?: number }[];
        };
        for (const item of order.products ?? []) {
          const variantId = item.variant_id ?? item.variant?.id;
          const qty = Number(item.quantity ?? 0);
          if (!variantId || qty <= 0) continue;
          const { data: current } = await supabaseAdmin
            .from("uniform_variants" as never)
            .select("stock")
            .eq("ns_variant_id", String(variantId))
            .maybeSingle();
          if (current) {
            const novoSaldo = Math.max(0, Number((current as { stock: number }).stock) - qty);
            await supabaseAdmin
              .from("uniform_variants" as never)
              .update({ stock: novoSaldo } as never)
              .eq("ns_variant_id", String(variantId));
          }
        }
      }
    }
    await logSync("webhook", "ok", { message: payload.event });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSync("webhook", "error", { message });
    throw e;
  }
}
