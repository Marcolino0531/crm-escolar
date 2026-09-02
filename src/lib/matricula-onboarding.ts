// Regras puras do Onboarding criado a partir de uma matrícula formalizada
// (Fase 4): checklist inicial e conteúdo do email de boas-vindas.
//
// O Onboarding deixa de nascer no funil Comercial: ele só existe quando o aluno
// já está criado no Sponte E matriculado na turma, então o nome e a turma daqui
// são sempre os do contrato, não os digitados no lead.

import { TAREFAS_INICIAIS } from "@/lib/crm/constants";
import type { TarefaOnboardingId } from "@/lib/crm/types";

export interface DadosBoasVindas {
  alunoNome: string;
  turma: string;
  unidade: string;
}

/**
 * Checklist inicial. Só "Boas-vindas e informações básicas" pode vir marcado, e
 * apenas quando o Resend ACEITOU o email — falha de envio deixa o item aberto,
 * em vez de dar a tarefa como feita sem ter sido.
 */
export function tarefasOnboardingIniciais(
  boasVindasEnviada: boolean,
): Record<TarefaOnboardingId, boolean> {
  return { ...TAREFAS_INICIAIS, "boas-vindas": boasVindasEnviada };
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function montarEmailBoasVindas(dados: DadosBoasVindas): {
  subject: string;
  html: string;
  text: string;
} {
  const aluno = dados.alunoNome.trim();
  const turma = dados.turma.trim();
  const unidade = dados.unidade.trim();

  const linhas = [
    `Olá! A matrícula de ${aluno} está confirmada no ${unidade}.`,
    `Turma: ${turma}.`,
    "Nos próximos dias a secretaria entra em contato com o contrato, os materiais pedagógicos e a inclusão no grupo de WhatsApp da turma.",
    "Qualquer dúvida, é só responder a este email ou falar com a secretaria.",
  ];

  return {
    subject: `Boas-vindas — matrícula de ${aluno} confirmada`,
    html: linhas.map((l) => `<p>${escaparHtml(l)}</p>`).join(""),
    text: linhas.join("\n\n"),
  };
}

/** Email do responsável usado nas boas-vindas: o financeiro tem preferência. */
export function emailBoasVindas(responsaveis: readonly { email: string }[]): string | null {
  for (const r of responsaveis) {
    const email = r.email.trim();
    if (email.includes("@")) return email;
  }
  return null;
}
