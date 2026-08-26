// Pausa temporária ("comprovante recebido") do disparo automático de WhatsApp.
//
// Caso de uso: o responsável manda o comprovante pelo Atendimento, mas a baixa
// no Sponte só acontece quando o arquivo retorno do banco é processado. Sem uma
// trava individual, o próximo cron cobra de novo algo já pago.
//
// Diferente do kill switch (`whatsapp_billing_pause`, que trava o dia inteiro
// para TODOS), aqui a pausa é individual e tem prazo: vale até `expiraEm`
// (24h a partir do clique). A retomada é derivada do tempo — nenhum job precisa
// "desligar" a pausa: passado o prazo, o cron simplesmente volta a considerar as
// parcelas. E se a baixa entrou nesse meio tempo, o cron não acha nada em aberto
// no Sponte e nada é disparado.
//
// Escopo: `alunoId` null pausa TODAS as parcelas do telefone (responsável
// inteiro); preenchido pausa só as daquele aluno, para o irmão que continua
// devendo seguir sendo cobrado.

import { chaveTelefone } from "./billing-recurrence";

export const HORAS_PAUSA_COMPROVANTE = 24;

export interface PausaComprovante {
  telefone: string;
  // null/"" = responsável inteiro (todas as parcelas daquele telefone).
  alunoId: string | null;
  expiraEm: string; // ISO
}

// Parcela do ponto de vista da pausa: quem receberia a mensagem e de qual aluno.
export interface AlvoPausavel {
  telefone: string;
  alunoId: string;
}

// Fim da janela de pausa contada a partir de `agora`.
export function expiracaoPausa(agora: Date, horas = HORAS_PAUSA_COMPROVANTE): string {
  return new Date(agora.getTime() + horas * 3600_000).toISOString();
}

export function pausaVigente(pausa: PausaComprovante, agora: Date): boolean {
  const fim = new Date(pausa.expiraEm).getTime();
  if (Number.isNaN(fim)) return false;
  return fim > agora.getTime();
}

export function pausasVigentes(pausas: PausaComprovante[], agora: Date): PausaComprovante[] {
  return pausas.filter((p) => pausaVigente(p, agora));
}

// A parcela está pausada quando existe pausa vigente do mesmo telefone (últimos
// 8 dígitos, a mesma chave do agrupamento) cujo escopo a alcança.
export function alvoPausado(
  alvo: AlvoPausavel,
  pausas: PausaComprovante[],
  agora: Date,
): boolean {
  const chave = chaveTelefone(alvo.telefone);
  if (!chave) return false;
  return pausas.some((p) => {
    if (!pausaVigente(p, agora)) return false;
    if (chaveTelefone(p.telefone) !== chave) return false;
    const escopoAluno = (p.alunoId ?? "").trim();
    return escopoAluno === "" || escopoAluno === alvo.alunoId;
  });
}

// Remove das parcelas do dia tudo que está sob pausa vigente. Aplicado antes do
// agrupamento por responsável, para que a mensagem agrupada do irmão que segue
// devendo continue saindo com o total certo.
export function filtrarPorPausa<T extends AlvoPausavel>(
  parcelas: T[],
  pausas: PausaComprovante[],
  agora: Date,
): T[] {
  if (pausas.length === 0) return parcelas;
  return parcelas.filter((p) => !alvoPausado(p, pausas, agora));
}

// Tempo restante da pausa, para a interface ("expira em 3h20").
export function minutosRestantes(pausa: PausaComprovante, agora: Date): number {
  const fim = new Date(pausa.expiraEm).getTime();
  if (Number.isNaN(fim)) return 0;
  return Math.max(0, Math.ceil((fim - agora.getTime()) / 60_000));
}

export function rotuloRestante(pausa: PausaComprovante, agora: Date): string {
  const min = minutosRestantes(pausa, agora);
  if (min <= 0) return "expirada";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min restantes`;
  return m === 0 ? `${h}h restantes` : `${h}h${String(m).padStart(2, "0")} restantes`;
}
