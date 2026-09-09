import { parseISODateLocal, todayISOLocal } from "@/lib/date-utils";
import type { Weekday } from "@/lib/diario";

// Registro retroativo no Diário: o modal tem uma "Data do registro" (padrão
// hoje) e todo evento é gravado nessa data, não em "agora".

export function dataInicialDoModal(): string {
  return todayISOLocal();
}

export function ehHoje(ymd: string, agora = new Date()): boolean {
  return ymd === ymdLocal(agora);
}

export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Dia da semana da data escolhida, no fuso local (não em UTC).
export function diaDaSemana(ymd: string): Weekday {
  const d = parseISODateLocal(ymd);
  return (d ?? new Date()).getDay() as Weekday;
}

// Instante da data escolhida com a hora HH:MM informada (fuso local).
export function instanteEm(ymd: string, hhmm: string): Date {
  const d = parseISODateLocal(ymd) ?? new Date();
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

// Refeição não tem hora exata: em data passada grava ao meio-dia da data
// (mesmo padrão da Colônia); hoje grava o momento atual.
export function instanteDaRefeicao(ymd: string, agora = new Date()): Date {
  return ehHoje(ymd, agora) ? agora : instanteEm(ymd, "12:00");
}

// Entrada/Saída precisam de hora para calcular a hora extra: hoje sem hora
// informada usa o momento atual; em data passada a hora é obrigatória.
export function instanteDaPonta(ymd: string, hhmm: string | null, agora = new Date()): Date | null {
  if (hhmm) return horaValida(hhmm) ? instanteEm(ymd, hhmm) : null;
  return ehHoje(ymd, agora) ? agora : null;
}

export function horaValida(hhmm: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

// Intervalo ISO [00:00, 23:59:59.999] da data escolhida, para o histórico do dia.
export function intervaloDoDia(ymd: string): { inicio: string; fim: string } {
  const inicio = parseISODateLocal(ymd) ?? new Date();
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setHours(23, 59, 59, 999);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

// Hora sugerida no formulário de Entrada/Saída: o momento atual (HH:MM). É só
// uma sugestão — a hora gravada é a que o usuário confirmar, em qualquer data.
export function horaSugerida(agora = new Date()): string {
  return `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
}

// Só um registro ainda não faturado pode ser excluído pelo modal. Se já entrou
// num faturamento (em qualquer status), o diretor cancela o faturamento antes.
export function podeExcluirRegistro(ev: {
  faturamento_id: string | null;
}): { ok: true } | { ok: false; erro: string } {
  if (ev.faturamento_id) {
    return {
      ok: false,
      erro: "Este registro já entrou em um faturamento. Cancele o faturamento na aba Faturamento antes de excluí-lo.",
    };
  }
  return { ok: true };
}
