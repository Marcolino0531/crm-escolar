// Seção "Extras" da Rematrícula — servidor (sem server fns próprias: usado por
// dadosRematricula/finalizarRematricula e pela tela de divergências).
//
// Nada aqui escreve no Sponte nem no Diário do Aluno: só lê, grava a escolha do
// responsável e persiste os alertas para a secretaria tratar manualmente.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/supabase-paginate";
import { groupMealPlans, groupSchedules, emptyPlan, emptySchedule } from "@/lib/diario";
import type { MealPlanRow, ScheduleRow } from "@/lib/diario";
import { segmentoDaSerie } from "@/lib/matricula-form";
import { coletarTitulosAluno } from "@/lib/sponte.functions";
import {
  categoriasDoDiario,
  divergenciasExtras,
  extrasDoSponteNoAno,
  normalizarSelecaoExtras,
  type CategoriaExtra,
  type DivergenciaExtra,
  type ExtraSponte,
  type TipoDivergenciaExtra,
} from "@/lib/rematricula-extras";

const LOG_TAG = "[rematricula-extras]";

export interface ExtrasRematricula {
  anoLetivo: number;
  /** Retrato do Sponte usado no pré-preenchimento (gravado uma vez). */
  sponte: ExtraSponte[];
  /** Seleção atual do responsável (ou o próprio Sponte no primeiro acesso). */
  selecionadas: CategoriaExtra[];
  /** Sponte não respondeu no primeiro acesso: a seção segue sem pré-preenchimento. */
  indisponivel: boolean;
}

type EscolhaRow = {
  sponte_snapshot: ExtraSponte[];
  selecionadas: string[];
};

/**
 * Carrega os extras do formulário. Na primeira abertura lê o contas a receber
 * do aluno no Sponte e grava o retrato; nas seguintes reaproveita o retrato
 * salvo — é ele que a comparação pós-rematrícula usa, mesmo que o Sponte mude
 * depois.
 */
export async function carregarExtrasRematricula(
  unidade: string,
  alunoId: string,
  alunoNome: string,
  anoLetivo: number,
): Promise<ExtrasRematricula> {
  const { data: existente } = await supabaseAdmin
    .from("rematricula_extras_escolhas" as never)
    .select("sponte_snapshot, selecionadas")
    .eq("unidade", unidade)
    .eq("aluno_id", alunoId)
    .eq("ano_letivo", anoLetivo)
    .maybeSingle<EscolhaRow>();

  if (existente) {
    return {
      anoLetivo,
      sponte: existente.sponte_snapshot ?? [],
      selecionadas: normalizarSelecaoExtras(existente.selecionadas ?? []),
      indisponivel: false,
    };
  }

  const r = await coletarTitulosAluno(unidade, alunoId);
  if (r.error || r.indisponivel) {
    console.error(`${LOG_TAG} Sponte indisponível para ${unidade}/${alunoId}: ${r.error ?? ""}`);
    return { anoLetivo, sponte: [], selecionadas: [], indisponivel: true };
  }

  const sponte = extrasDoSponteNoAno(r.titulos, anoLetivo);
  const selecionadas = sponte.map((e) => e.categoria);
  const { error } = await supabaseAdmin.from("rematricula_extras_escolhas" as never).insert({
    unidade,
    aluno_id: alunoId,
    aluno_nome: alunoNome,
    ano_letivo: anoLetivo,
    sponte_snapshot: sponte,
    sponte_lido_em: new Date().toISOString(),
    selecionadas,
  } as never);
  if (error) console.error(`${LOG_TAG} falha ao gravar o retrato do Sponte: ${error.message}`);

  return { anoLetivo, sponte, selecionadas, indisponivel: false };
}

async function categoriasDoDiarioDoAluno(
  unidade: string,
  alunoId: string,
  anoLetivo: number,
  serie: string,
): Promise<Set<CategoriaExtra> | null> {
  const { data: escola } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("name", unidade)
    .maybeSingle<{ id: string }>();
  if (!escola) return null;
  const { data: aluno } = await supabaseAdmin
    .from("diario_students" as never)
    .select("id")
    .eq("school_id", escola.id)
    .eq("sponte_aluno_id", alunoId)
    .maybeSingle<{ id: string }>();
  if (!aluno) return null;

  const [planos, horarios] = await Promise.all([
    selectAll<MealPlanRow>(() =>
      supabaseAdmin
        .from("diario_meal_plans" as never)
        .select("student_id, meal, weekday, ano_letivo")
        .eq("student_id", aluno.id)
        .eq("ano_letivo", anoLetivo)
        .order("meal")
        .order("weekday"),
    ),
    selectAll<ScheduleRow>(() =>
      supabaseAdmin
        .from("diario_schedules" as never)
        .select("student_id, weekday, entry, exit, ano_letivo")
        .eq("student_id", aluno.id)
        .eq("ano_letivo", anoLetivo)
        .order("weekday"),
    ),
  ]);
  if (planos.length === 0 && horarios.length === 0) return null;

  return categoriasDoDiario({
    plan: groupMealPlans(planos, anoLetivo).get(aluno.id) ?? emptyPlan(),
    schedule: groupSchedules(horarios, anoLetivo).get(aluno.id) ?? emptySchedule(),
    segmento: segmentoDaSerie(serie),
  });
}

/**
 * Chamado pelo "Finalizar Matrícula": grava a seleção final e substitui as
 * divergências do aluno/ano. Sem retrato do Sponte (primeiro acesso com o
 * Sponte fora), tudo que foi marcado vira "lançamento pendente".
 */
export async function registrarExtrasFinalizacao(entrada: {
  unidade: string;
  alunoId: string;
  alunoNome: string;
  anoLetivo: number;
  serie: string;
  selecionadas: readonly string[];
}): Promise<DivergenciaExtra[]> {
  const selecionadas = normalizarSelecaoExtras(entrada.selecionadas);
  const agora = new Date().toISOString();

  const { data: existente } = await supabaseAdmin
    .from("rematricula_extras_escolhas" as never)
    .select("sponte_snapshot, selecionadas")
    .eq("unidade", entrada.unidade)
    .eq("aluno_id", entrada.alunoId)
    .eq("ano_letivo", entrada.anoLetivo)
    .maybeSingle<EscolhaRow>();
  const sponte: ExtraSponte[] = existente?.sponte_snapshot ?? [];

  const { error: eErr } = await supabaseAdmin.from("rematricula_extras_escolhas" as never).upsert(
    {
      unidade: entrada.unidade,
      aluno_id: entrada.alunoId,
      aluno_nome: entrada.alunoNome,
      ano_letivo: entrada.anoLetivo,
      sponte_snapshot: sponte,
      selecionadas,
      finalizada_em: agora,
      updated_at: agora,
    } as never,
    { onConflict: "unidade,aluno_id,ano_letivo" },
  );
  if (eErr) throw new Error(eErr.message);

  const diario = await categoriasDoDiarioDoAluno(
    entrada.unidade,
    entrada.alunoId,
    entrada.anoLetivo,
    entrada.serie,
  );
  const divergencias = divergenciasExtras({
    aluno: entrada.alunoNome,
    sponte,
    selecionadas,
    diario,
  });

  const { error: dErr } = await supabaseAdmin
    .from("rematricula_extras_divergencias" as never)
    .delete()
    .eq("unidade", entrada.unidade)
    .eq("aluno_id", entrada.alunoId)
    .eq("ano_letivo", entrada.anoLetivo);
  if (dErr) throw new Error(dErr.message);

  if (divergencias.length > 0) {
    const { error: iErr } = await supabaseAdmin
      .from("rematricula_extras_divergencias" as never)
      .insert(
        divergencias.map((d) => ({
          unidade: entrada.unidade,
          aluno_id: entrada.alunoId,
          aluno_nome: entrada.alunoNome,
          ano_letivo: entrada.anoLetivo,
          categoria: d.categoria,
          tipo: d.tipo,
          valor: d.valor,
          mensagem: d.mensagem,
          created_at: agora,
        })) as never,
      );
    if (iErr) throw new Error(iErr.message);
  }
  return divergencias;
}

// ─── Tela "Divergências pós-rematrícula" (aba Auditoria Sponte do Diário) ──

export interface LinhaDivergenciaExtra {
  id: string;
  aluno: string;
  alunoId: string;
  unidade: string;
  anoLetivo: number;
  categoria: string;
  tipo: TipoDivergenciaExtra;
  valor: number | null;
  mensagem: string;
  registradaEm: string;
}

type DivergenciaRow = {
  id: string;
  aluno_id: string;
  aluno_nome: string;
  ano_letivo: number;
  categoria: string;
  tipo: TipoDivergenciaExtra;
  valor: number | string | null;
  mensagem: string;
  created_at: string;
};

async function exigirPermissaoDiario(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "can_view_module" as never,
    { _user_id: userId, _module: "diario" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para ver as divergências da rematrícula.");
}

export const listarDivergenciasExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ unidade: z.string().trim().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<LinhaDivergenciaExtra[]> => {
    await exigirPermissaoDiario(context.userId);
    const rows = await selectAll<DivergenciaRow>(() =>
      supabaseAdmin
        .from("rematricula_extras_divergencias" as never)
        .select(
          "id, aluno_id, aluno_nome, ano_letivo, categoria, tipo, valor, mensagem, created_at",
        )
        .eq("unidade", data.unidade)
        .order("ano_letivo", { ascending: false })
        .order("aluno_nome")
        .order("created_at"),
    );
    return rows.map((r) => ({
      id: r.id,
      aluno: r.aluno_nome,
      alunoId: r.aluno_id,
      unidade: data.unidade,
      anoLetivo: r.ano_letivo,
      categoria: r.categoria,
      tipo: r.tipo,
      valor: r.valor === null ? null : Number(r.valor),
      mensagem: r.mensagem,
      registradaEm: r.created_at,
    }));
  });
