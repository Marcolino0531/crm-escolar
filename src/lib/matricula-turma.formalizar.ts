import { getResendConfig, sendEmail } from "@/lib/agenda.email";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TAREFAS_INICIAIS } from "@/lib/crm/constants";
import {
  emailBoasVindas,
  montarEmailBoasVindas,
  tarefasOnboardingIniciais,
} from "@/lib/matricula-onboarding";
import { matricularEmTurma, type ResultadoMatriculaTurma } from "@/lib/matricula-turma.sponte";
import type { TurnoTurma } from "@/lib/matricula-turma";

export type StatusBoasVindas = "enviado" | "sem_email" | "nao_configurado" | "falhou";

export interface EntradaOnboarding {
  submissionId: string;
  unidade: string;
  alunoNome: string;
  responsavel: { nome: string; telefone: string; email: string }[];
}

export interface EntradaFormalizacao extends EntradaOnboarding {
  alunoId: number;
  serie: string;
  turno: TurnoTurma | null;
  anoLetivo: number;
  dataMatricula: string;
}

export const TURMA_ONBOARDING_PENDENTE = "Turma a definir";

export interface ResultadoFormalizacao {
  turma: ResultadoMatriculaTurma;
  onboardingId: string | null;
  boasVindas: StatusBoasVindas | null;
}

async function escolaId(unidade: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("name", unidade)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function enviarBoasVindas(
  entrada: EntradaFormalizacao,
  turma: string,
): Promise<StatusBoasVindas> {
  const destino = emailBoasVindas(entrada.responsavel);
  if (destino === null) return "sem_email";

  const cfg = getResendConfig();
  if (cfg === null) {
    console.error("[matrículas] Resend não configurado — boas-vindas não enviadas.");
    return "nao_configurado";
  }

  const { subject, html, text } = montarEmailBoasVindas({
    alunoNome: entrada.alunoNome,
    turma,
    unidade: entrada.unidade,
  });

  try {
    await sendEmail(cfg, { to: [destino], subject, html, text });
    return "enviado";
  } catch (e) {
    console.error(
      "[matrículas] Resend recusou o email de boas-vindas:",
      e instanceof Error ? e.message : String(e),
    );
    return "falhou";
  }
}

/**
 * Onboarding nasce assim que o aluno existe no Sponte, sem depender da turma
 * (vínculo único por submission_id — reenviar não duplica). A turma fica como
 * "Turma a definir" até a formalização gravá-la.
 */
export async function criarOnboardingDaMatricula(
  entrada: EntradaOnboarding,
): Promise<string | null> {
  const schoolId = await escolaId(entrada.unidade);
  if (schoolId === null) {
    console.error(`[matrículas] unidade sem escola cadastrada: ${entrada.unidade}`);
    return null;
  }

  const responsavel = entrada.responsavel[0] ?? { nome: "", telefone: "" };
  const tarefas = tarefasOnboardingIniciais(false);

  const { data, error } = await supabaseAdmin
    .from("onboarding")
    .upsert(
      {
        school_id: schoolId,
        submission_id: entrada.submissionId,
        nome_aluno: entrada.alunoNome,
        turma: TURMA_ONBOARDING_PENDENTE,
        nome_pai_mae: responsavel.nome,
        telefone: responsavel.telefone,
        tarefas,
        concluido: false,
      },
      { onConflict: "submission_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[matrículas] falha ao criar o onboarding:", error.message);
    return null;
  }
  if (data?.id) return data.id;

  const existente = await supabaseAdmin
    .from("onboarding")
    .select("id")
    .eq("submission_id", entrada.submissionId)
    .maybeSingle<{ id: string }>();
  return existente.data?.id ?? null;
}

/**
 * Com a turma formalizada, grava a turma no onboarding e marca as boas-vindas
 * só quando o Resend aceitou o email — sem tocar nas outras tarefas, que a
 * secretaria já pode ter mexido.
 */
async function atualizarOnboardingComTurma(
  submissionId: string,
  turma: string,
  boasVindas: StatusBoasVindas,
): Promise<string | null> {
  const { data: atual } = await supabaseAdmin
    .from("onboarding")
    .select("id, tarefas")
    .eq("submission_id", submissionId)
    .maybeSingle<{ id: string; tarefas: Record<string, boolean> | null }>();
  if (!atual) return null;

  const tarefas = {
    ...tarefasOnboardingIniciais(false),
    ...(atual.tarefas ?? {}),
    "boas-vindas": boasVindas === "enviado" || atual.tarefas?.["boas-vindas"] === true,
  };
  const concluido = Object.keys(TAREFAS_INICIAIS).every(
    (id) => tarefas[id as keyof typeof tarefas],
  );

  const { error } = await supabaseAdmin
    .from("onboarding")
    .update({ turma, tarefas, concluido })
    .eq("id", atual.id);
  if (error) {
    console.error("[matrículas] falha ao atualizar a turma do onboarding:", error.message);
  }
  return atual.id;
}

export async function formalizarMatriculaTurma(
  entrada: EntradaFormalizacao,
): Promise<ResultadoFormalizacao> {
  const turma = await matricularEmTurma({
    unidade: entrada.unidade,
    alunoId: entrada.alunoId,
    serie: entrada.serie,
    turno: entrada.turno,
    anoLetivo: entrada.anoLetivo,
    dataMatricula: entrada.dataMatricula,
    observacao: `Matrícula pelo formulário do site — protocolo ${entrada.submissionId}.`,
  });

  if (turma.status !== "matriculado") {
    return { turma, onboardingId: null, boasVindas: null };
  }

  const nomeTurma = turma.turmaNome ?? "";
  const boasVindas = await enviarBoasVindas(entrada, nomeTurma);
  let onboardingId = await atualizarOnboardingComTurma(entrada.submissionId, nomeTurma, boasVindas);
  if (onboardingId === null) {
    await criarOnboardingDaMatricula(entrada);
    onboardingId = await atualizarOnboardingComTurma(entrada.submissionId, nomeTurma, boasVindas);
  }

  return { turma, onboardingId, boasVindas };
}
