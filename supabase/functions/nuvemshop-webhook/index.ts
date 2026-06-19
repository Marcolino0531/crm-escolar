// Edge Function: nuvemshop-webhook
//
// Recebe eventos em tempo real da Nuvemshop e atualiza o estoque local na hora.
// Eventos tratados:
//   - product/created, product/updated  -> re-sincroniza aquele produto
//   - order/created, order/paid          -> decrementa o estoque das variações vendidas
//
// Segurança: valida a assinatura HMAC-SHA256 (header x-linkedstore-hmac-sha256)
// usando o NUVEMSHOP_CLIENT_SECRET antes de processar.
//
// Deploy:  supabase functions deploy nuvemshop-webhook --no-verify-jwt
// Registrar o webhook na Nuvemshop apontando para a URL pública desta função.

import {
  fetchProduct,
  getSupabaseAdmin,
  upsertCatalog,
  verifyWebhookHmac,
} from "../_shared/nuvemshop.ts";

const API_BASE = "https://api.nuvemshop.com.br/v1";

type WebhookPayload = { store_id: number; event: string; id: number };

async function nuvemshopGet(path: string): Promise<Response> {
  const storeId = Deno.env.get("NUVEMSHOP_STORE_ID") ?? "";
  const token = Deno.env.get("NUVEMSHOP_ACCESS_TOKEN") ?? "";
  return fetch(`${API_BASE}/${storeId}${path}`, {
    headers: {
      Authentication: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "SchoolHub CRM (suporte@schoolhub.app)",
    },
  });
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get("x-linkedstore-hmac-sha256");
  const valid = await verifyWebhookHmac(raw, signature);
  if (!valid) {
    return new Response(JSON.stringify({ ok: false, error: "assinatura inválida" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = JSON.parse(raw) as WebhookPayload;
  const supabase = getSupabaseAdmin();

  try {
    if (payload.event.startsWith("product/")) {
      const product = await fetchProduct(payload.id);
      if (product) await upsertCatalog(supabase, [product]);
    } else if (payload.event.startsWith("order/")) {
      const res = await nuvemshopGet(`/orders/${payload.id}`);
      if (res.ok) {
        const order = await res.json();
        for (const item of order.products ?? []) {
          const variantId = item.variant_id ?? item.variant?.id;
          const qty = Number(item.quantity ?? 0);
          if (!variantId || qty <= 0) continue;
          // Decremento atômico via RPC seria ideal; aqui lemos e gravamos o saldo.
          const { data: current } = await supabase
            .from("uniform_variants")
            .select("stock")
            .eq("ns_variant_id", String(variantId))
            .maybeSingle();
          if (current) {
            const novoSaldo = Math.max(0, Number(current.stock) - qty);
            await supabase
              .from("uniform_variants")
              .update({ stock: novoSaldo })
              .eq("ns_variant_id", String(variantId));
          }
        }
      }
    }

    await supabase
      .from("uniform_sync_log")
      .insert({ source: "webhook", status: "ok", message: payload.event, finished_at: new Date().toISOString() });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("uniform_sync_log")
      .insert({ source: "webhook", status: "error", message, finished_at: new Date().toISOString() });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
