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

export interface EntradaFormalizacao {
  submissionId: string;
  unidade: string;
  alunoId: number;
  alunoNome: string;
  serie: string;
  turno: TurnoTurma | null;
  anoLetivo: number;
  dataMatricula: string;
  responsavel: { nome: string; telefone: string; email: string }[];
}

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
 * Onboarding só existe para matrícula formalizada: aluno criado no Sponte e
 * matriculado em turma. O item de boas-vindas só é marcado quando o Resend
 * aceita o email.
 */
async function criarOnboarding(
  entrada: EntradaFormalizacao,
  turma: string,
  boasVindas: StatusBoasVindas,
): Promise<string | null> {
  const schoolId = await escolaId(entrada.unidade);
  if (schoolId === null) {
    console.error(`[matrículas] unidade sem escola cadastrada: ${entrada.unidade}`);
    return null;
  }

  const responsavel = entrada.responsavel[0] ?? { nome: "", telefone: "" };
  const tarefas = tarefasOnboardingIniciais(boasVindas === "enviado");
  const concluido = Object.keys(TAREFAS_INICIAIS).every(
    (id) => tarefas[id as keyof typeof tarefas],
  );

  const { data, error } = await supabaseAdmin
    .from("onboarding")
    .upsert(
      {
        school_id: schoolId,
        submission_id: entrada.submissionId,
        nome_aluno: entrada.alunoNome,
        turma,
        nome_pai_mae: responsavel.nome,
        telefone: responsavel.telefone,
        tarefas,
        concluido,
      },
      { onConflict: "submission_id" },
    )
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("[matrículas] falha ao criar o onboarding:", error.message);
    return null;
  }
  return data?.id ?? null;
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
  const onboardingId = await criarOnboarding(entrada, nomeTurma, boasVindas);

  return { turma, onboardingId, boasVindas };
}
