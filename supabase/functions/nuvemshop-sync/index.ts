// Edge Function: nuvemshop-sync
//
// Reconciliação/auditoria do estoque: baixa o catálogo completo da Nuvemshop e
// faz upsert no Supabase, registrando o resultado em uniform_sync_log.
//
// Acionada por:
//   1) pg_cron (madrugada, 03h) — body { "source": "cron" }
//   2) Botão "Sincronizar com Nuvemshop" na UI — body { "source": "manual" }
//
// Deploy:  supabase functions deploy nuvemshop-sync
// Secrets: supabase secrets set NUVEMSHOP_STORE_ID=... NUVEMSHOP_ACCESS_TOKEN=...

import { fetchAllProducts, getSupabaseAdmin, upsertCatalog } from "../_shared/nuvemshop.ts";

Deno.serve(async (req) => {
  const supabase = getSupabaseAdmin();
  let source = "manual";
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.source === "string") source = body.source;
  } catch (_) {
    // body opcional
  }

  const { data: logRow } = await supabase
    .from("uniform_sync_log")
    .insert({ source, status: "running" })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    const products = await fetchAllProducts();
    const result = await upsertCatalog(supabase, products);

    if (logId) {
      await supabase
        .from("uniform_sync_log")
        .update({
          status: "ok",
          products_synced: result.products,
          variants_synced: result.variants,
          discrepancies: result.discrepancies,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (logId) {
      await supabase
        .from("uniform_sync_log")
        .update({ status: "error", message, finished_at: new Date().toISOString() })
        .eq("id", logId);
    }
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
