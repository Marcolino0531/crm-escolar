// Integração com a API da Nuvemshop (lado servidor). Usada pelos endpoints
// nativos da Vercel roteados em `src/server.ts`:
//   POST /api/nuvemshop/sync     — reconciliação/auditoria (polling) do catálogo
//   POST /api/nuvemshop/webhook  — eventos em tempo real (produto/pedido)
//   GET  /api/nuvemshop/cron     — auditoria noturna (Vercel Cron, 03h)
//
// Variáveis de ambiente (painel da Vercel), por loja (multiloja):
//   NUVEMSHOP_BELVEDERE_STORE_ID / NUVEMSHOP_BELVEDERE_TOKEN
//   NUVEMSHOP_CEC_STORE_ID       / NUVEMSHOP_CEC_TOKEN
//   NUVEMSHOP_STORE_ID / NUVEMSHOP_ACCESS_TOKEN (legado → fallback 'belvedere')
//   NUVEMSHOP_CLIENT_SECRET (HMAC dos webhooks)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (já existentes — gravam o estoque)
//   CRON_SECRET (opcional — protege o endpoint de cron)
//
// Docs: https://tiendanube.github.io/api-documentation/

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { STORES, type StoreKey } from "@/lib/nuvemshop.stores";
import type { PedidoVenda } from "@/lib/uniformes.vendas";

const API_BASE = "https://api.nuvemshop.com.br/v1";

// Identifica o app em toda chamada à API da Nuvemshop (obrigatório):
// https://tiendanube.github.io/api-documentation/intro#identify-your-app
export const NUVEMSHOP_USER_AGENT = "School Hub (uniformesnb@gmail.com)";

type Localized = { [lang: string]: string | undefined } | string;

type NuvemshopVariant = {
  id: number;
  product_id: number;
  stock: number | null;
  sku: string | null;
  price: string | null;
  // Cada elemento corresponde a um atributo do produto (ex.: Tamanho, Cor),
  // localizado por idioma: [{ pt: "P" }, { pt: "Azul" }].
  values?: Localized[];
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

// Erro de autenticação/autorização vindo da própria API da Nuvemshop (HTTP
// 401/403): o token de acesso da loja é inválido, foi revogado ou o app foi
// desinstalado. É distinto de uma sessão inválida do School Hub (Supabase);
// os endpoints usam essa distinção para não pedir novo login por engano.
export class NuvemshopAuthError extends Error {
  readonly storeKey: StoreKey;
  readonly status: number;
  constructor(storeKey: StoreKey, status: number, detail: string) {
    super(
      `Nuvemshop [${storeKey}] recusou o token (HTTP ${status}): ${detail || "token inválido ou revogado"}.`,
    );
    this.name = "NuvemshopAuthError";
    this.storeKey = storeKey;
    this.status = status;
  }
}

function readLocalized(v: Localized | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  // Prioriza pt; cai para qualquer idioma com valor não vazio.
  const candidates = [v.pt, ...Object.values(v)];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
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

export type StoreCreds = { key: StoreKey; storeId: string; token: string };

// Resolve as credenciais de uma loja a partir do ambiente, com fallback legado
// (NUVEMSHOP_STORE_ID/ACCESS_TOKEN) apenas para a loja 'belvedere'.
function storeCreds(key: StoreKey): StoreCreds | null {
  const prefix = `NUVEMSHOP_${key.toUpperCase()}`;
  let storeId = process.env[`${prefix}_STORE_ID`];
  let token = process.env[`${prefix}_TOKEN`];
  if ((!storeId || !token) && key === "belvedere") {
    storeId = storeId ?? process.env.NUVEMSHOP_STORE_ID;
    token = token ?? process.env.NUVEMSHOP_ACCESS_TOKEN;
  }
  if (!storeId || !token) return null;
  return { key, storeId, token };
}

// Lojas com credenciais configuradas no ambiente.
export function configuredStores(): StoreCreds[] {
  const found: StoreCreds[] = [];
  for (const store of STORES) {
    const creds = storeCreds(store.key);
    console.info(`[nuvemshop] loja ${store.key}: credenciais ${creds ? "set" : "VAZIO"}`);
    if (creds) found.push(creds);
  }
  return found;
}

const MAX_RATE_LIMIT_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Atraso (ms) ao receber 429: respeita o header Retry-After (em segundos) e,
// na ausência dele, usa backoff exponencial.
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(1000 * 2 ** attempt, 16000);
}

async function nuvemshopFetch(store: StoreCreds, path: string): Promise<Response> {
  const { storeId, token } = store;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}/${storeId}${path}`, {
      headers: {
        // A Nuvemshop usa o header "Authentication" (não "Authorization").
        Authentication: `bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": NUVEMSHOP_USER_AGENT,
      },
    });
    console.info(`[nuvemshop] [${store.key}] GET ${path} -> ${res.status}`);
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const delay = retryDelayMs(res, attempt);
      console.warn(
        `[nuvemshop] [${store.key}] 429 Too Many Requests em ${path}; retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} em ${delay}ms`,
      );
      await sleep(delay);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      const detail = await res.text().catch(() => "");
      throw new NuvemshopAuthError(store.key, res.status, detail.slice(0, 200));
    }
    return res;
  }
}

async function fetchAllProducts(store: StoreCreds): Promise<NuvemshopProduct[]> {
  const products: NuvemshopProduct[] = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    // Sem `fields=` para garantir o retorno completo das variações
    // (values/sku/price) e do nome localizado.
    const res = await nuvemshopFetch(store, `/products?page=${page}&per_page=${perPage}`);
    if (res.status === 404) break;
    if (res.status === 429) {
      throw new Error(
        "Nuvemshop GET /products: limite de requisições (429) persistiu após retries. Tente novamente em instantes.",
      );
    }
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

// Pedidos pagos e não cancelados criados na janela informada (ISO 8601). A API
// só filtra por data de CRIAÇÃO; a data de pagamento é conferida depois, na
// agregação (`uniformes.vendas.ts`), que é quem define o ano da venda.
//
// `fields` enxuga a resposta para o que a agregação usa — sem isso cada pedido
// vem com cliente, endereço e imagens.
export async function fetchPaidOrders(
  store: StoreCreds,
  createdMin: string,
  createdMax: string,
): Promise<PedidoVenda[]> {
  const orders: PedidoVenda[] = [];
  const perPage = 200;
  const fields = "id,status,payment_status,paid_at,cancelled_at,products";
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      status: "any",
      payment_status: "paid",
      created_at_min: createdMin,
      created_at_max: createdMax,
      fields,
    });
    const res = await nuvemshopFetch(store, `/orders?${query.toString()}`);
    if (res.status === 404) break;
    if (!res.ok) {
      throw new Error(`Nuvemshop GET /orders falhou: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as PedidoVenda[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    orders.push(...batch);
    if (batch.length < perPage) break;
  }
  return orders;
}

async function fetchProduct(
  store: StoreCreds,
  productId: number | string,
): Promise<NuvemshopProduct | null> {
  const res = await nuvemshopFetch(store, `/products/${productId}`);
  if (!res.ok) return null;
  return (await res.json()) as NuvemshopProduct;
}

// Espelha (upsert) os produtos + variações da Nuvemshop no Supabase. Conta como
// "discrepância" toda variação cujo estoque local divergia do estoque da API.
async function upsertCatalog(
  storeKey: StoreKey,
  products: NuvemshopProduct[],
): Promise<SyncResult> {
  let variantCount = 0;
  let discrepancies = 0;

  const { data: existing } = await supabaseAdmin
    .from("uniform_variants" as never)
    .select("ns_variant_id, stock")
    .eq("store_key", storeKey);
  const localStock = new Map<string, number>();
  for (const row of (existing ?? []) as { ns_variant_id: string; stock: number }[]) {
    localStock.set(String(row.ns_variant_id), Number(row.stock));
  }

  for (const p of products) {
    const productRow = {
      store_key: storeKey,
      ns_product_id: String(p.id),
      name: readLocalized(p.name),
      category: p.categories?.[0] ? readLocalized(p.categories[0].name) : null,
      handle: readLocalized(p.handle) || null,
      active: p.published ?? true,
    };
    const { error: pErr } = await supabaseAdmin
      .from("uniform_products" as never)
      .upsert(productRow as never, { onConflict: "store_key,ns_product_id" });
    if (pErr) throw new Error(`upsert produto ${p.id}: ${pErr.message}`);

    for (const v of p.variants ?? []) {
      const stock = Number(v.stock ?? 0);
      const prev = localStock.get(String(v.id));
      if (prev !== undefined && prev !== stock) discrepancies += 1;
      const variantRow = {
        store_key: storeKey,
        ns_variant_id: String(v.id),
        ns_product_id: String(p.id),
        size: variantSize(v),
        sku: v.sku?.trim() || null,
        stock,
        price: v.price ? Number(v.price) : null,
      };
      const { error: vErr } = await supabaseAdmin
        .from("uniform_variants" as never)
        .upsert(variantRow as never, { onConflict: "store_key,ns_variant_id" });
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

// Reconciliação completa do catálogo de TODAS as lojas configuradas (acionada
// pelo botão da UI e pelo cron). Agrega os totais e grava no log.
export async function runFullSync(source: "manual" | "cron"): Promise<SyncResult> {
  const stores = configuredStores();
  if (stores.length === 0) {
    const message =
      "Nenhuma loja Nuvemshop configurada: defina NUVEMSHOP_<LOJA>_STORE_ID e NUVEMSHOP_<LOJA>_TOKEN.";
    await logSync(source, "error", { message });
    throw new Error(message);
  }
  const total: SyncResult = { products: 0, variants: 0, discrepancies: 0 };
  try {
    for (const store of stores) {
      const products = await fetchAllProducts(store);
      const result = await upsertCatalog(store.key, products);
      total.products += result.products;
      total.variants += result.variants;
      total.discrepancies += result.discrepancies;
    }
    await logSync(source, "ok", total);
    return total;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSync(source, "error", { message });
    throw e;
  }
}

type WebhookPayload = { store_id: number; event: string; id: number };

// Verifica a assinatura HMAC-SHA256 do webhook (header x-linkedstore-hmac-sha256),
// calculada sobre o corpo bruto usando o client_secret do app.
export async function verifyWebhookHmac(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET;
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// Identifica de qual loja configurada veio o webhook, pelo store_id do payload.
function storeForPayload(payload: WebhookPayload): StoreCreds | null {
  const id = String(payload.store_id);
  return configuredStores().find((s) => s.storeId === id) ?? null;
}

// Processa um evento de webhook já validado (produto atualizado ou pedido criado).
export async function handleWebhookEvent(payload: WebhookPayload): Promise<void> {
  try {
    const store = storeForPayload(payload);
    if (!store) {
      await logSync("webhook", "error", {
        message: `loja desconhecida para store_id=${payload.store_id}`,
      });
      return;
    }
    if (payload.event.startsWith("product/")) {
      const product = await fetchProduct(store, payload.id);
      if (product) await upsertCatalog(store.key, [product]);
    } else if (payload.event.startsWith("order/")) {
      const res = await nuvemshopFetch(store, `/orders/${payload.id}`);
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
            .eq("store_key", store.key)
            .eq("ns_variant_id", String(variantId))
            .maybeSingle();
          if (current) {
            const novoSaldo = Math.max(0, Number((current as { stock: number }).stock) - qty);
            await supabaseAdmin
              .from("uniform_variants" as never)
              .update({ stock: novoSaldo } as never)
              .eq("store_key", store.key)
              .eq("ns_variant_id", String(variantId));
          }
        }
      }
    }
    await logSync("webhook", "ok", { message: `${store.key}: ${payload.event}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logSync("webhook", "error", { message });
    throw e;
  }
}
