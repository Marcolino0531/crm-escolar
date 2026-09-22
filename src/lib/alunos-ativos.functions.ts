// Alunos Matriculados Ativos — leitura de diario_matriculas_ano (ano vigente,
// ativo=true) por unidade, histórico mensal e cron do último dia do mês.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAll } from "@/lib/supabase-paginate";
import { anoVigenteConfigurado } from "@/lib/rematricula.functions";
import {
  anoMesDe,
  contarAtivosPorUnidade,
  ehUltimoDiaDoMes,
  hojeEmBrasilia,
  linhasHistoricoDoMes,
  somarTotal,
  unidadesSemDados,
  type HistoricoRow,
  type VinculoAtivoRow,
} from "@/lib/alunos-ativos";

type VinculoJoinRow = {
  student_id: string;
  diario_students: { school_id: string } | { school_id: string }[] | null;
};

// Vínculos ativos do ano, com a unidade do aluno (diario_students.school_id).
async function vinculosAtivosDoAno(ano: number): Promise<VinculoAtivoRow[]> {
  const rows = await selectAll<VinculoJoinRow>(() =>
    supabaseAdmin
      .from("diario_matriculas_ano" as never)
      .select("student_id, diario_students!inner(school_id)")
      .eq("ano_letivo", ano)
      .eq("ativo", true)
      .order("id"),
  );
  return rows.map((r) => {
    const ds = Array.isArray(r.diario_students) ? r.diario_students[0] : r.diario_students;
    return { student_id: r.student_id, school_id: ds?.school_id ?? "" };
  });
}

export async function contarAtivosDoAno(ano: number): Promise<Record<string, number>> {
  return contarAtivosPorUnidade(await vinculosAtivosDoAno(ano));
}

// Unidades que o usuário pode ver (null = todas, admin). Espelha allowedSponteUnidades.
async function allowedSchoolIds(userId: string): Promise<string[] | null> {
  const { data: roles } = await supabaseAdmin
    .from("user_roles" as never)
    .select("role")
    .eq("user_id", userId);
  if (((roles ?? []) as { role: string }[]).some((r) => r.role === "admin")) return null;
  const { data: us } = await supabaseAdmin
    .from("user_schools" as never)
    .select("school_id")
    .eq("user_id", userId);
  return ((us ?? []) as { school_id: string }[]).map((r) => r.school_id);
}

export interface AlunosAtivosAnoResult {
  ano: number;
  total: number;
  porUnidade: Record<string, number>;
  // Unidades pedidas sem nenhum vínculo sincronizado no ano.
  semDados: string[];
}

const InputSchema = z.object({
  // Unidades do filtro do topo; ausente = todas as permitidas.
  schoolIds: z.array(z.string().uuid()).optional(),
});

export const fetchAlunosAtivosAno = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AlunosAtivosAnoResult> => {
    const allowed = await allowedSchoolIds(context.userId);
    const { data: schools } = await supabaseAdmin
      .from("schools" as never)
      .select("id")
      .order("name");
    const todas = ((schools ?? []) as { id: string }[]).map((s) => s.id);
    let alvo = allowed === null ? todas : todas.filter((id) => allowed.includes(id));
    if (data.schoolIds) alvo = alvo.filter((id) => data.schoolIds!.includes(id));

    const ano = await anoVigenteConfigurado();
    const contagem = await contarAtivosDoAno(ano);
    const porUnidade: Record<string, number> = {};
    for (const id of alvo) if (id in contagem) porUnidade[id] = contagem[id];
    return {
      ano,
      total: somarTotal(porUnidade),
      porUnidade,
      semDados: unidadesSemDados(alvo, contagem),
    };
  });

export const fetchAlunosAtivosHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HistoricoRow[]> => {
    const allowed = await allowedSchoolIds(context.userId);
    const rows = await selectAll<HistoricoRow>(() => {
      let q = supabaseAdmin
        .from("alunos_ativos_historico" as never)
        .select("school_id, ano_mes, total_alunos")
        .order("ano_mes");
      if (allowed !== null) q = q.in("school_id", allowed);
      return q;
    });
    return rows.map((r) => ({ ...r, total_alunos: Number(r.total_alunos) }));
  });

// ── Cron: fechamento mensal ────────────────────────────────────────────────

export interface FechamentoMensalResult {
  ok: boolean;
  executado: boolean;
  anoMes: string;
  ano?: number;
  linhas?: HistoricoRow[];
  error?: string;
}

// Só grava no ÚLTIMO dia do mês (calendário de Brasília); nos demais dias não
// faz nada. Upsert por school_id + ano_mes: reexecutar no mesmo dia é idempotente.
export async function runFechamentoMensalAlunosAtivos(
  hoje: Date = hojeEmBrasilia(),
  forcar = false,
): Promise<FechamentoMensalResult> {
  const anoMes = anoMesDe(hoje);
  if (!forcar && !ehUltimoDiaDoMes(hoje)) return { ok: true, executado: false, anoMes };
  const ano = await anoVigenteConfigurado();
  const linhas = linhasHistoricoDoMes(await contarAtivosDoAno(ano), anoMes);
  if (linhas.length === 0) {
    return { ok: true, executado: true, anoMes, ano, linhas, error: "sem vínculos sincronizados" };
  }
  const { error } = await supabaseAdmin
    .from("alunos_ativos_historico" as never)
    .upsert(linhas.map((l) => ({ ...l, capturado_em: new Date().toISOString() })) as never, {
      onConflict: "school_id,ano_mes",
    });
  if (error) return { ok: false, executado: true, anoMes, ano, error: error.message };
  return { ok: true, executado: true, anoMes, ano, linhas };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match ? match[1] : null;
}

//   GET /api/alunos-ativos/cron            — Vercel Cron diário (grava só no último dia do mês)
//   GET /api/alunos-ativos/cron?forcar=1   — grava o mês corrente hoje (manual, mesmo CRON_SECRET)
export async function handleAlunosAtivosApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/alunos-ativos/cron" || request.method !== "GET") return null;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearer(request) !== cronSecret) {
    return json({ ok: false, error: "não autorizado" }, 401);
  }
  try {
    const res = await runFechamentoMensalAlunosAtivos(
      hojeEmBrasilia(),
      url.searchParams.get("forcar") === "1",
    );
    if (res.executado)
      console.log(`[alunos-ativos] fechamento ${res.anoMes}:`, res.linhas ?? res.error);
    return json(res, res.ok ? 200 : 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[alunos-ativos] cron falhou:", msg);
    return json({ ok: false, error: msg }, 500);
  }
}
