// Cliente compartilhado da API da Nuvemshop + lógica de espelhamento do catálogo
// no Supabase. Usado pelas Edge Functions `nuvemshop-sync` (polling/auditoria) e
// `nuvemshop-webhook` (tempo real).
//
// Variáveis de ambiente esperadas (configurar via `supabase secrets set`):
//   NUVEMSHOP_STORE_ID     — id da loja (user_id do app instalado)
//   NUVEMSHOP_ACCESS_TOKEN — token de acesso permanente do app
//   NUVEMSHOP_CLIENT_SECRET — segredo do app (verificação HMAC dos webhooks)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — injetadas automaticamente
//
// Docs: https://tiendanube.github.io/api-documentation/

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const API_BASE = "https://api.nuvemshop.com.br/v1";

export type NuvemshopVariant = {
  id: number;
  product_id: number;
  stock: number | null;
  sku: string | null;
  price: string | null;
  values?: { pt?: string; es?: string; en?: string }[];
};

export type NuvemshopProduct = {
  id: number;
  name: { pt?: string } | string;
  handle?: { pt?: string } | string;
  published?: boolean;
  categories?: { name?: { pt?: string } | string }[];
  variants?: NuvemshopVariant[];
};

function readLocalized(v: { pt?: string } | string | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.pt ?? Object.values(v)[0] ?? "";
}

function variantSize(v: NuvemshopVariant): string {
  if (!v.values || v.values.length === 0) return "Único";
  return v.values.map((val) => readLocalized(val)).filter(Boolean).join(" / ") || "Único";
}

export function getEnv() {
  const storeId = Deno.env.get("NUVEMSHOP_STORE_ID") ?? "";
  const token = Deno.env.get("NUVEMSHOP_ACCESS_TOKEN") ?? "";
  if (!storeId || !token) {
    throw new Error("NUVEMSHOP_STORE_ID e NUVEMSHOP_ACCESS_TOKEN são obrigatórios.");
  }
  return { storeId, token };
}

export function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function nuvemshopFetch(path: string, init?: RequestInit): Promise<Response> {
  const { storeId, token } = getEnv();
  return fetch(`${API_BASE}/${storeId}${path}`, {
    ...init,
    headers: {
      // A Nuvemshop usa o header "Authentication" (não "Authorization").
      Authentication: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "SchoolHub CRM (suporte@schoolhub.app)",
      ...(init?.headers ?? {}),
    },
  });
}

export async function fetchAllProducts(): Promise<NuvemshopProduct[]> {
  const products: NuvemshopProduct[] = [];
  let page = 1;
  const perPage = 200;
  // Paginação simples até a API retornar uma página vazia.
  for (;;) {
    const res = await nuvemshopFetch(`/products?page=${page}&per_page=${perPage}&fields=id,name,handle,published,categories,variants`);
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Nuvemshop GET /products falhou: ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as NuvemshopProduct[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    products.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return products;
}

export async function fetchProduct(productId: number | string): Promise<NuvemshopProduct | null> {
  const res = await nuvemshopFetch(`/products/${productId}`);
  if (!res.ok) return null;
  return (await res.json()) as NuvemshopProduct;
}

export type SyncResult = { products: number; variants: number; discrepancies: number };

// Espelha (upsert) os produtos + variações da Nuvemshop no Supabase. Conta como
// "discrepância" toda variação cujo estoque local divergia do estoque da API.
export async function upsertCatalog(
  supabase: SupabaseClient,
  products: NuvemshopProduct[],
): Promise<SyncResult> {
  let variantCount = 0;
  let discrepancies = 0;

  // Estoque local atual (para detectar divergências corrigidas na reconciliação).
  const { data: existing } = await supabase
    .from("uniform_variants")
    .select("ns_variant_id, stock");
  const localStock = new Map<string, number>();
  for (const row of existing ?? []) localStock.set(String(row.ns_variant_id), Number(row.stock));

  for (const p of products) {
    const productRow = {
      ns_product_id: String(p.id),
      name: readLocalized(p.name),
      category: p.categories?.[0] ? readLocalized(p.categories[0].name) : null,
      handle: readLocalized(p.handle) || null,
      active: p.published ?? true,
    };
    const { error: pErr } = await supabase
      .from("uniform_products")
      .upsert(productRow, { onConflict: "ns_product_id" });
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
      const { error: vErr } = await supabase
        .from("uniform_variants")
        .upsert(variantRow, { onConflict: "ns_variant_id" });
      if (vErr) throw new Error(`upsert variação ${v.id}: ${vErr.message}`);
      variantCount += 1;
    }
  }

  return { products: products.length, variants: variantCount, discrepancies };
}

// Verifica a assinatura HMAC-SHA256 do webhook (header x-linkedstore-hmac-sha256),
// calculada sobre o corpo bruto usando o client_secret do app.
export async function verifyWebhookHmac(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("NUVEMSHOP_CLIENT_SECRET");
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
  // Comparação em tempo (aproximadamente) constante.
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
