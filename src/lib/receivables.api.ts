// Endpoint nativo do Controle de Recebíveis (Cartão de Crédito).
// Montado a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/receivables/cron  — verificação diária (Vercel Cron; CRON_SECRET)
//
// Flip automático: todo recebível ainda não transferido cuja data de
// disponibilidade já chegou (data_disponibilidade <= hoje) passa de
// 'aguardando' para 'disponivel'. O alerta no sininho é derivado ao vivo da
// mesma condição, então aparece mesmo antes do cron rodar.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function handleReceivablesApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/receivables/")) return null;

  if (pathname === "/api/receivables/cron" && request.method === "GET") {
    // A Vercel envia "Authorization: Bearer <CRON_SECRET>" quando a env existe.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    try {
      const today = todayISO();
      const { data, error } = await supabaseAdmin
        .from("credit_card_receivables" as never)
        .update({ status: "disponivel" } as never)
        .eq("status", "aguardando")
        .lte("data_disponibilidade", today)
        .select("id");
      if (error) throw new Error(error.message);
      const liberados = (data ?? []).length;
      console.log(`[receivables] cron: ${liberados} recebível(is) liberado(s) em ${today}`);
      return json({ ok: true, liberados });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[receivables] cron falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}
