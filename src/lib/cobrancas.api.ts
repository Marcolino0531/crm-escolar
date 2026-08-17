// Endpoint nativo do Histórico de Envios de WhatsApp da Cobrança.
// Montado a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/cobrancas/logs       — lista paginada dos disparos (filtros + resumo)
//   GET /api/cobrancas/cron-runs  — últimas execuções do cron
//
// Filtros (query string): unidade, status ('sucesso'|'erro'), date (YYYY-MM-DD),
// page (1-based), per_page. Resposta inclui `summary` (envios de hoje, falhas,
// total do mês) calculado globalmente, independente dos filtros/paginação.
//
// `tipo` ('cobranca' | 'lembrete', default 'cobranca') separa as duas réguas:
// Cobranças Automáticas (após o vencimento) e Lembretes Automáticos (D-5/D-3/D-0).
// Enquanto a migration dos lembretes não estiver aplicada, a coluna `tipo` não
// existe e a consulta cai para o comportamento antigo (sem filtro), para o
// histórico de cobrança não parar de abrir por causa disso.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PREFIXO_SLOT_LEMBRETE } from "@/lib/billing-cron-runs";

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
  prazo_lembrete?: string | null;
};

type TipoDisparo = "cobranca" | "lembrete";

function tipoDaQuery(params: URLSearchParams): TipoDisparo {
  return params.get("tipo")?.trim() === "lembrete" ? "lembrete" : "cobranca";
}

function erroColunaInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

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

  if (pathname === "/api/cobrancas/cron-runs" && request.method === "GET") {
    if (!(await isAuthenticated(request))) {
      return json({ ok: false, error: "Sessão inválida — faça login novamente." }, 401);
    }
    try {
      return await listCronRuns(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[cobrancas] /cron-runs falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}

const MAX_CRON_RUNS = 60;

// Execuções do cron de cobrança, da mais recente para a mais antiga. Inclui as
// que não geraram envio — é justamente a ausência de execução que precisa ficar
// visível quando um disparo se perde.
async function listCronRuns(url: URL): Promise<Response> {
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(MAX_CRON_RUNS, Math.max(1, limitRaw || 20));
  const tipo = tipoDaQuery(url.searchParams);

  let query = supabaseAdmin
    .from("whatsapp_cron_runs" as never)
    .select(
      "id, data_ref, slot, iniciado_em, finalizado_em, status, responsaveis, enviados, falhas, pulados, motivo, erro, duracao_ms",
    )
    .order("iniciado_em", { ascending: false })
    .limit(limit);

  // As execuções das duas réguas dividem a tabela; o slot as distingue
  // ("lembretes-10h" vs. "09h").
  query =
    tipo === "lembrete"
      ? query.like("slot", `${PREFIXO_SLOT_LEMBRETE}%`)
      : query.not("slot", "like", `${PREFIXO_SLOT_LEMBRETE}%`);

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return json({ ok: true, data: data ?? [] });
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
  const tipo = tipoDaQuery(params);

  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const perPageRaw = Number.parseInt(params.get("per_page") ?? String(DEFAULT_PER_PAGE), 10);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, perPageRaw || DEFAULT_PER_PAGE));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const montarQuery = (comTipo: boolean) => {
    let q0 = supabaseAdmin
      .from("whatsapp_billing_logs" as never)
      .select(
        "id, data_envio, responsavel_name, aluno_name, telefone, unidade, valor, vencimento, status, erro_mensagem, fatura_id, message_body" +
          (comTipo ? ", prazo_lembrete" : ""),
        { count: "exact" },
      )
      .order("data_envio", { ascending: false })
      .range(from, to);
    if (comTipo) q0 = q0.eq("tipo", tipo);

    if (unidade) q0 = q0.eq("unidade", unidade);
    if (status && STATUS_VALIDOS.includes(status as BillingStatus)) {
      q0 = q0.eq("status", status);
    }
    if (q) {
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      q0 = q0.or(`responsavel_name.ilike.${like},aluno_name.ilike.${like}`);
    }
    if (date) {
      // Janela [date 00:00, próximo dia 00:00).
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      q0 = q0.gte("data_envio", start.toISOString()).lt("data_envio", end.toISOString());
    } else {
      // Filtro por período (data de envio): [date_start 00:00, date_end +1 00:00).
      if (dateStart) q0 = q0.gte("data_envio", new Date(`${dateStart}T00:00:00`).toISOString());
      if (dateEnd) {
        const end = new Date(`${dateEnd}T00:00:00`);
        end.setDate(end.getDate() + 1);
        q0 = q0.lt("data_envio", end.toISOString());
      }
    }
    return q0;
  };

  let { data, error, count } = await montarQuery(true);
  if (error && erroColunaInexistente(error)) {
    // Migration dos lembretes pendente: histórico único, sem separação por régua.
    ({ data, error, count } = await montarQuery(false));
  }
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as BillingLog[];

  const summary = await buildSummary(tipo);

  return json({
    ok: true,
    data: rows,
    page,
    per_page: perPage,
    total: count ?? 0,
    summary,
  });
}

async function buildSummary(
  tipo: TipoDisparo,
): Promise<{ hoje: number; falhas: number; mes: number }> {
  const base = (comTipo: boolean) => {
    const q0 = supabaseAdmin.from("whatsapp_billing_logs" as never).select("id", {
      count: "exact",
      head: true,
    });
    return comTipo ? q0.eq("tipo", tipo) : q0;
  };

  const contar = async (comTipo: boolean) =>
    Promise.all([
      base(comTipo).gte("data_envio", startOfTodayISO()),
      base(comTipo).eq("status", "erro").gte("data_envio", startOfMonthISO()),
      base(comTipo).gte("data_envio", startOfMonthISO()),
    ]);

  let [hoje, falhas, mes] = await contar(true);
  if (erroColunaInexistente(hoje.error)) [hoje, falhas, mes] = await contar(false);

  return {
    hoje: hoje.count ?? 0,
    falhas: falhas.count ?? 0,
    mes: mes.count ?? 0,
  };
}
