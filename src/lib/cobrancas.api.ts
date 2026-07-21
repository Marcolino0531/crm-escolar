// Endpoint nativo do Histórico de Envios de WhatsApp da Cobrança.
// Montado a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/cobrancas/logs  — lista paginada dos disparos (filtros + resumo)
//
// Filtros (query string): unidade, status ('sucesso'|'erro'), date (YYYY-MM-DD),
// page (1-based), per_page. Resposta inclui `summary` (envios de hoje, falhas,
// total do mês) calculado globalmente, independente dos filtros/paginação.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

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

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = bearer(request);
  if (!token) return false;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data?.user;
}

type BillingStatus = "sucesso" | "erro" | "pendente" | "enviado" | "entregue" | "lido" | "falha";

type BillingLog = {
  id: string;
  data_envio: string;
  responsavel_name: string;
  aluno_name: string;
  telefone: string;
  unidade: string;
  valor: number;
  vencimento: string | null;
  status: BillingStatus;
  erro_mensagem: string | null;
  fatura_id: string | null;
  message_body: string | null;
};

const STATUS_VALIDOS: BillingStatus[] = [
  "sucesso",
  "erro",
  "pendente",
  "enviado",
  "entregue",
  "lido",
  "falha",
];

export async function handleCobrancasApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/cobrancas/")) return null;

  if (pathname === "/api/cobrancas/logs" && request.method === "GET") {
    if (!(await isAuthenticated(request))) {
      return json({ ok: false, error: "Sessão inválida — faça login novamente." }, 401);
    }
    try {
      return await listLogs(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cobrancas] /logs falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

async function listLogs(url: URL): Promise<Response> {
  const params = url.searchParams;
  const unidade = params.get("unidade")?.trim() || null;
  const status = params.get("status")?.trim() || null;
  const date = params.get("date")?.trim() || null;
  const dateStart = params.get("date_start")?.trim() || null;
  const dateEnd = params.get("date_end")?.trim() || null;
  const q = params.get("q")?.trim() || null;

  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const perPageRaw = Number.parseInt(params.get("per_page") ?? String(DEFAULT_PER_PAGE), 10);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, perPageRaw || DEFAULT_PER_PAGE));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .select(
      "id, data_envio, responsavel_name, aluno_name, telefone, unidade, valor, vencimento, status, erro_mensagem, fatura_id, message_body",
      {
        count: "exact",
      },
    )
    .order("data_envio", { ascending: false })
    .range(from, to);

  if (unidade) query = query.eq("unidade", unidade);
  if (status && STATUS_VALIDOS.includes(status as BillingStatus)) {
    query = query.eq("status", status);
  }
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    query = query.or(`responsavel_name.ilike.${like},aluno_name.ilike.${like}`);
  }
  if (date) {
    // Janela [date 00:00, próximo dia 00:00).
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    query = query.gte("data_envio", start.toISOString()).lt("data_envio", end.toISOString());
  } else {
    // Filtro por período (data de envio): [date_start 00:00, date_end +1 00:00).
    if (dateStart) query = query.gte("data_envio", new Date(`${dateStart}T00:00:00`).toISOString());
    if (dateEnd) {
      const end = new Date(`${dateEnd}T00:00:00`);
      end.setDate(end.getDate() + 1);
      query = query.lt("data_envio", end.toISOString());
    }
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as BillingLog[];

  const summary = await buildSummary();

  return json({
    ok: true,
    data: rows,
    page,
    per_page: perPage,
    total: count ?? 0,
    summary,
  });
}

async function buildSummary(): Promise<{ hoje: number; falhas: number; mes: number }> {
  const base = () =>
    supabaseAdmin.from("whatsapp_billing_logs" as never).select("id", {
      count: "exact",
      head: true,
    });

  const [hoje, falhas, mes] = await Promise.all([
    base().gte("data_envio", startOfTodayISO()),
    base().eq("status", "erro").gte("data_envio", startOfMonthISO()),
    base().gte("data_envio", startOfMonthISO()),
  ]);

  return {
    hoje: hoje.count ?? 0,
    falhas: falhas.count ?? 0,
    mes: mes.count ?? 0,
  };
}
