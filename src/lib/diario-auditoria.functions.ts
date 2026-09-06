// Auditoria Plano do Diário do Aluno × Sponte — servidor.
//
// Para cada aluno da unidade com plano ativo no ano vigente, compara as
// refeições contratadas e o horário (Diário) com as categorias de parcela
// ativas no Sponte (GetParcelas). Grava só as inconsistências; a execução
// anterior da mesma unidade/ano é substituída.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/supabase-paginate";
import {
  groupMealPlans,
  groupSchedules,
  emptyPlan,
  emptySchedule,
  type MealPlanRow,
  type ScheduleRow,
} from "@/lib/diario";
import {
  categoriasAtivas,
  itensSemLancamento,
  ordenarInconsistencias,
  segmentoDaTurma,
  temPlanoAtivo,
  type InconsistenciaAluno,
} from "@/lib/diario-auditoria";
import { coletarTitulosAluno } from "@/lib/sponte.functions";
import { anoVigenteConfigurado } from "@/lib/rematricula.functions";

const CONCORRENCIA_SPONTE = 4;

export interface ExecucaoAuditoria {
  unidade: string;
  anoLetivo: number;
  executadaEm: string;
  origem: string;
  alunosAuditados: number;
  alunosComInconsistencia: number;
  alunosComErro: number;
  erro: string | null;
}

export interface LinhaAuditoria extends InconsistenciaAluno {
  sponteAlunoId: string;
  erro: string | null;
}

export interface ResultadoAuditoria {
  execucao: ExecucaoAuditoria | null;
  linhas: LinhaAuditoria[];
}

type StudentRow = {
  id: string;
  name: string;
  class_name: string;
  sponte_aluno_id: string | null;
};

type ExecucaoRow = {
  id: string;
  ano_letivo: number;
  executada_em: string;
  origem: string;
  alunos_auditados: number;
  alunos_com_inconsistencia: number;
  alunos_com_erro: number;
  erro: string | null;
};

type InconsistenciaRow = {
  student_id: string;
  sponte_aluno_id: string;
  aluno_nome: string;
  turma: string;
  itens: string[];
  erro: string | null;
};

async function exigirPermissaoDiario(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "diario" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para executar a auditoria do Diário."
        : "Você não tem permissão para ver a auditoria do Diário.",
    );
  }
}

async function schoolIdDaUnidade(unidade: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("name", unidade)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Unidade "${unidade}" não encontrada.`);
  return data.id;
}

async function emLotes<T, R>(
  itens: readonly T[],
  tamanho: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return saida;
}

// Núcleo sem autenticação: reutilizado pelo botão (server fn) e pelo cron.
export async function runAuditoriaDiarioSponte(
  unidade: string,
  origem: "manual" | "cron",
): Promise<ExecucaoAuditoria> {
  const schoolId = await schoolIdDaUnidade(unidade);
  const anoLetivo = await anoVigenteConfigurado();

  const [alunos, planos, horarios] = await Promise.all([
    selectAll<StudentRow>(() =>
      supabaseAdmin
        .from("diario_students" as never)
        .select("id, name, class_name, sponte_aluno_id")
        .eq("school_id", schoolId)
        .order("id"),
    ),
    selectAll<MealPlanRow>(() =>
      supabaseAdmin
        .from("diario_meal_plans" as never)
        .select("student_id, meal, weekday, ano_letivo")
        .eq("ano_letivo", anoLetivo)
        .order("student_id")
        .order("meal")
        .order("weekday"),
    ),
    selectAll<ScheduleRow>(() =>
      supabaseAdmin
        .from("diario_schedules" as never)
        .select("student_id, weekday, entry, exit, ano_letivo")
        .eq("ano_letivo", anoLetivo)
        .order("student_id")
        .order("weekday"),
    ),
  ]);

  const planoPorAluno = groupMealPlans(planos, anoLetivo);
  const horarioPorAluno = groupSchedules(horarios, anoLetivo);

  const auditaveis = alunos.filter((a) => {
    if (!a.sponte_aluno_id) return false;
    return temPlanoAtivo(
      planoPorAluno.get(a.id) ?? emptyPlan(),
      horarioPorAluno.get(a.id) ?? emptySchedule(),
    );
  });

  const linhas = (
    await emLotes(auditaveis, CONCORRENCIA_SPONTE, async (a): Promise<LinhaAuditoria | null> => {
      const sponteId = a.sponte_aluno_id as string;
      const res = await coletarTitulosAluno(unidade, sponteId);
      const base = {
        studentId: a.id,
        aluno: a.name,
        turma: a.class_name,
        unidade,
        sponteAlunoId: sponteId,
      };
      if (res.error || res.indisponivel) {
        return {
          ...base,
          itens: [],
          erro: res.error ?? "Sponte indisponível para a unidade.",
        };
      }
      const itens = itensSemLancamento({
        plan: planoPorAluno.get(a.id) ?? emptyPlan(),
        schedule: horarioPorAluno.get(a.id) ?? emptySchedule(),
        segmento: segmentoDaTurma(a.class_name),
        categoriasAtivas: categoriasAtivas(res.titulos, anoLetivo),
      });
      return itens.length > 0 ? { ...base, itens, erro: null } : null;
    })
  ).filter((l): l is LinhaAuditoria => l !== null);

  const comErro = linhas.filter((l) => l.erro).length;
  const execucao = {
    school_id: schoolId,
    ano_letivo: anoLetivo,
    executada_em: new Date().toISOString(),
    origem,
    alunos_auditados: auditaveis.length,
    alunos_com_inconsistencia: linhas.length - comErro,
    alunos_com_erro: comErro,
    erro: null,
  };

  const { data: exec, error: eErr } = await supabaseAdmin
    .from("diario_auditoria_execucoes" as never)
    .upsert(execucao as never, { onConflict: "school_id,ano_letivo" })
    .select("id")
    .single<{ id: string }>();
  if (eErr) throw new Error(eErr.message);

  const { error: dErr } = await supabaseAdmin
    .from("diario_auditoria_inconsistencias" as never)
    .delete()
    .eq("execucao_id", exec.id);
  if (dErr) throw new Error(dErr.message);

  if (linhas.length > 0) {
    const { error: iErr } = await supabaseAdmin
      .from("diario_auditoria_inconsistencias" as never)
      .insert(
        linhas.map((l) => ({
          execucao_id: exec.id,
          school_id: schoolId,
          ano_letivo: anoLetivo,
          student_id: l.studentId,
          sponte_aluno_id: l.sponteAlunoId,
          aluno_nome: l.aluno,
          turma: l.turma,
          itens: l.itens,
          erro: l.erro,
        })) as never,
      );
    if (iErr) throw new Error(iErr.message);
  }

  return {
    unidade,
    anoLetivo,
    executadaEm: execucao.executada_em,
    origem,
    alunosAuditados: execucao.alunos_auditados,
    alunosComInconsistencia: execucao.alunos_com_inconsistencia,
    alunosComErro: execucao.alunos_com_erro,
    erro: null,
  };
}

const UnidadeSchema = z.object({ unidade: z.string().trim().min(1) });

export const executarAuditoriaDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<ExecucaoAuditoria> => {
    await exigirPermissaoDiario(context.userId, true);
    return runAuditoriaDiarioSponte(data.unidade, "manual");
  });

export const listarAuditoriaDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoAuditoria> => {
    await exigirPermissaoDiario(context.userId, false);
    const schoolId = await schoolIdDaUnidade(data.unidade);
    const anoLetivo = await anoVigenteConfigurado();

    const { data: exec, error } = await supabaseAdmin
      .from("diario_auditoria_execucoes" as never)
      .select(
        "id, ano_letivo, executada_em, origem, alunos_auditados, alunos_com_inconsistencia, alunos_com_erro, erro",
      )
      .eq("school_id", schoolId)
      .eq("ano_letivo", anoLetivo)
      .maybeSingle<ExecucaoRow>();
    if (error) throw new Error(error.message);
    if (!exec) return { execucao: null, linhas: [] };

    const rows = await selectAll<InconsistenciaRow>(() =>
      supabaseAdmin
        .from("diario_auditoria_inconsistencias" as never)
        .select("student_id, sponte_aluno_id, aluno_nome, turma, itens, erro")
        .eq("execucao_id", exec.id)
        .order("turma")
        .order("aluno_nome")
        .order("student_id"),
    );

    return {
      execucao: {
        unidade: data.unidade,
        anoLetivo: exec.ano_letivo,
        executadaEm: exec.executada_em,
        origem: exec.origem,
        alunosAuditados: exec.alunos_auditados,
        alunosComInconsistencia: exec.alunos_com_inconsistencia,
        alunosComErro: exec.alunos_com_erro,
        erro: exec.erro,
      },
      linhas: ordenarInconsistencias(
        rows.map((r) => ({
          studentId: r.student_id,
          aluno: r.aluno_nome,
          turma: r.turma,
          unidade: data.unidade,
          itens: r.itens,
          sponteAlunoId: r.sponte_aluno_id,
          erro: r.erro,
        })),
      ) as LinhaAuditoria[],
    };
  });
