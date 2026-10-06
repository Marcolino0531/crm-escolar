import { toTitleCase } from "@/lib/name-format";
import { toWhatsAppNumber } from "@/lib/phone";

// Mensagem do link de assinatura do contrato, aberta no WhatsApp do computador
// (wa.me): quem envia é a pessoa; nada passa pela Cloud API nem é gravado.

const NOME_COLEGIO: Record<string, string> = {
  CEC: "Colégio CEC",
  "CEC Baby": "CEC Baby",
  "Núcleo Belvedere": "Núcleo de Ensino Belvedere",
  "Núcleo Vale do Sereno": "Núcleo de Ensino Vale do Sereno",
};

export function nomeColegioContrato(unidade: string): string {
  const u = unidade.trim();
  return NOME_COLEGIO[u] ?? u;
}

/** "Bom dia" até 11h59, "Boa tarde" de 12h00 a 17h59, "Boa noite" a partir de 18h00 (São Paulo). */
export function saudacaoPorHorario(agora: Date): string {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hourCycle: "h23",
    }).format(agora),
  );
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export interface MensagemContratoInput {
  responsavelNome: string;
  alunoNome: string;
  anoLetivo: number;
  unidade: string;
  signUrl: string;
  agora: Date;
}

export function mensagemContratoWhatsApp(input: MensagemContratoInput): string {
  const primeiroNome = toTitleCase(input.responsavelNome.trim().split(/\s+/)[0] ?? "");
  const saudacao = saudacaoPorHorario(input.agora);
  return [
    `${saudacao}${primeiroNome ? `, ${primeiroNome}` : ""}! Aqui é da secretaria do ${nomeColegioContrato(input.unidade)}.`,
    "",
    `O contrato de matrícula ${input.anoLetivo} do(a) aluno(a) ${toTitleCase(input.alunoNome)} já está disponível para assinatura digital. Para assinar, acesse:`,
    input.signUrl,
    "",
    "O boleto da matrícula será enviado após a assinatura.",
    "",
    "Qualquer dúvida, estamos à disposição.",
  ].join("\n");
}

export function linkWhatsAppContrato(telefone: string, input: MensagemContratoInput): string {
  const numero = toWhatsAppNumber(telefone);
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagemContratoWhatsApp(input))}`;
}
