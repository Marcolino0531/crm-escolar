// Server functions da folha de ponto (RH).
//
// A leitura e o cálculo acontecem no navegador (o PDF não passa por storage);
// aqui o servidor valida a permissão, confere os funcionários informados contra
// o cadastro e grava o resultado agregado da competência. Reprocessar o mesmo
// mês substitui o resultado anterior, em vez de duplicar o ranking.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertCanEditRh(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "rh" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para processar a folha de ponto.");
}

async function nomeDoUsuario(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  return nome || (data?.user?.email ?? "");
}

const FalhaPontoSchema = z.object({
  etapa: z.enum(["leitura", "calculo", "gravacao"]),
  erroName: z.string().max(200),
  erroMessage: z.string().max(2000),
  stack: z.string().max(4000).optional(),
  userAgent: z.string().max(500).optional(),
  arquivoNome: z.string().max(300).optional(),
  arquivoTamanho: z.number().nonnegative().optional(),
  paginas: z.number().int().nonnegative().optional(),
});

// O processamento roda no navegador, então erro técnico do cliente não aparece
// em log nenhum. Isto leva o detalhe para o log do servidor (Vercel).
export const registrarFalhaPonto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FalhaPontoSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    console.error(
      "[folha-ponto] falha no processamento do PDF",
      JSON.stringify({ ...data, userId: context.userId, at: new Date().toISOString() }),
    );
    return { ok: true };
  });

const LinhaSchema = z.object({
  employeeId: z.string().uuid(),
  horarioEntrada: z.string().max(10),
  horarioSaida: z.string().max(10),
  diasAtraso: z.number().int().min(0),
  minutosAtraso: z.number().int().min(0),
  diasSaidaAntecipada: z.number().int().min(0),
  minutosSaidaAntecipada: z.number().int().min(0),
  diasAvaliados: z.number().int().min(0),
  diasInconsistentes: z.number().int().min(0),
  horarioDesatualizado: z.boolean().default(false),
  entradaSugerida: z.string().max(10).default(""),
  saidaSugerida: z.string().max(10).default(""),
});

const DiaSchema = z.object({
  employeeId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  entrada: z.string().max(10).default(""),
  saida: z.string().max(10).default(""),
  atrasoMin: z.number().int().min(0),
  antecipacaoMin: z.number().int().min(0),
  situacao: z.enum(["avaliado", "ignorado", "inconsistente"]),
});

const SalvarSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida."),
  arquivoNome: z.string().max(300).default(""),
  layout: z.enum(["cartao_ponto", "iponto"]),
  toleranciaMin: z.number().int().min(0).max(120),
  totalPaginas: z.number().int().min(0),
  paginasSemCorrespondencia: z.number().int().min(0),
  linhas: z.array(LinhaSchema).min(1).max(500),
  // Batidas dia a dia das páginas identificadas (até ~500 funcionários × 31
  // dias). Ficam guardadas para reconferir o período sem reimportar o PDF.
  dias: z.array(DiaSchema).max(20000).default([]),
});

export interface SalvarFolhaPontoResult {
  ok: boolean;
  timesheetId?: string;
  substituiu?: boolean;
  error?: string;
}

type FuncionarioRow = { id: string; school_id: string | null; nome_completo: string };

// Unidade da folha: a que aparece na maioria das páginas casadas. O arquivo é
// sempre de uma unidade só, e derivar do cadastro evita confiar no cliente.
function schoolPredominante(rows: readonly FuncionarioRow[]): string | null {
  const contagem = new Map<string, number>();
  for (const r of rows) {
    if (!r.school_id) continue;
    contagem.set(r.school_id, (contagem.get(r.school_id) ?? 0) + 1);
  }
  let melhor: { id: string; n: number } | null = null;
  for (const [id, n] of contagem) if (!melhor || n > melhor.n) melhor = { id, n };
  return melhor?.id ?? null;
}

export const salvarFolhaPonto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarSchema.parse(input))
  .handler(async ({ data, context }): Promise<SalvarFolhaPontoResult> => {
    await assertCanEditRh(context.userId);

    const ids = [...new Set(data.linhas.map((l) => l.employeeId))];
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("funcionarios")
      .select("id, school_id, nome_completo")
      .in("id", ids);
    if (rowsErr) return { ok: false, error: rowsErr.message };

    const funcionarios = (rows ?? []) as unknown as FuncionarioRow[];
    const porId = new Map(funcionarios.map((f) => [f.id, f]));
    const desconhecidos = ids.filter((id) => !porId.has(id));
    if (desconhecidos.length > 0) {
      return { ok: false, error: "Há funcionários no arquivo que não existem mais no cadastro." };
    }

    const schoolId = schoolPredominante(funcionarios);

    // Reprocessamento: a competência da unidade é substituída por inteiro. As
    // linhas caem junto pelo ON DELETE CASCADE.
    const consulta = supabaseAdmin
      .from("hr_timesheets" as never)
      .select("id")
      .eq("competencia", data.competencia);
    const { data: anterior } = await (
      schoolId ? consulta.eq("school_id", schoolId) : consulta.is("school_id", null)
    ).maybeSingle();

    const anteriorId = (anterior as unknown as { id?: string } | null)?.id ?? null;
    if (anteriorId) {
      const { error } = await supabaseAdmin
        .from("hr_timesheets" as never)
        .delete()
        .eq("id", anteriorId);
      if (error) return { ok: false, error: error.message };
    }

    const { data: criada, error: criarErr } = await supabaseAdmin
      .from("hr_timesheets" as never)
      .insert({
        school_id: schoolId,
        competencia: data.competencia,
        arquivo_nome: data.arquivoNome,
        layout: data.layout,
        tolerancia_min: data.toleranciaMin,
        total_paginas: data.totalPaginas,
        paginas_processadas: data.linhas.length,
        paginas_sem_correspondencia: data.paginasSemCorrespondencia,
        processado_por: context.userId,
        processado_por_nome: await nomeDoUsuario(context.userId),
      } as never)
      .select("id")
      .single();
    if (criarErr) return { ok: false, error: criarErr.message };

    const timesheetId = (criada as unknown as { id: string }).id;

    const { error: linhasErr } = await supabaseAdmin.from("hr_timesheet_entries" as never).insert(
      data.linhas.map((l) => ({
        timesheet_id: timesheetId,
        employee_id: l.employeeId,
        employee_nome: porId.get(l.employeeId)?.nome_completo ?? "",
        horario_entrada: l.horarioEntrada,
        horario_saida: l.horarioSaida,
        dias_atraso: l.diasAtraso,
        minutos_atraso: l.minutosAtraso,
        dias_saida_antecipada: l.diasSaidaAntecipada,
        minutos_saida_antecipada: l.minutosSaidaAntecipada,
        dias_avaliados: l.diasAvaliados,
        dias_inconsistentes: l.diasInconsistentes,
        horario_desatualizado: l.horarioDesatualizado,
        entrada_sugerida: l.entradaSugerida,
        saida_sugerida: l.saidaSugerida,
      })) as never,
    );
    if (linhasErr) return { ok: false, error: linhasErr.message };

    const diasValidos = data.dias.filter((d) => porId.has(d.employeeId));
    for (let i = 0; i < diasValidos.length; i += 1000) {
      const { error: diasErr } = await supabaseAdmin.from("hr_timesheet_days" as never).insert(
        diasValidos.slice(i, i + 1000).map((d) => ({
          timesheet_id: timesheetId,
          employee_id: d.employeeId,
          dia: d.data,
          entrada: d.entrada,
          saida: d.saida,
          atraso_min: d.atrasoMin,
          antecipacao_min: d.antecipacaoMin,
          situacao: d.situacao,
        })) as never,
      );
      if (diasErr) return { ok: false, error: diasErr.message };
    }

    return { ok: true, timesheetId, substituiu: Boolean(anteriorId) };
  });
