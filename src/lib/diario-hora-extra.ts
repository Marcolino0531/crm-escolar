import type { DaySchedule, SchedulePlan, Weekday } from "@/lib/diario";

// Entrada e Saída são registradas separadamente e só quando acontecem fora do
// combinado. O que não for registrado vale como "no horário contratado".
export type DirecaoRegistro = "entrada" | "saida";

export const TOLERANCIA_ENTRADA_MIN = 15;
export const TOLERANCIA_SAIDA_MIN = 30;

export const ROTULO_DIRECAO: Record<DirecaoRegistro, string> = {
  entrada: "Entrada",
  saida: "Saída",
};

export function hhmmParaMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutosDoDia(data: Date): number {
  return data.getHours() * 60 + data.getMinutes();
}

// Minutos de hora extra de uma ponta do dia. A tolerância é um limiar, não um
// desconto: dentro dela não cobra nada; fora dela cobra o tempo total até o
// horário contratado (15 min antes na entrada, 30 min depois na saída).
export function minutosHoraExtra(
  direcao: DirecaoRegistro,
  horarioRegistradoMin: number,
  dia: NonNullable<DaySchedule>,
): number {
  if (direcao === "entrada") {
    const contratado = hhmmParaMinutos(dia.entry);
    if (horarioRegistradoMin >= contratado - TOLERANCIA_ENTRADA_MIN) return 0;
    return contratado - horarioRegistradoMin;
  }
  const contratado = hhmmParaMinutos(dia.exit);
  if (horarioRegistradoMin <= contratado + TOLERANCIA_SAIDA_MIN) return 0;
  return horarioRegistradoMin - contratado;
}

export type AvaliacaoRegistro = {
  temHorario: boolean;
  // null quando não há horário contratado no dia (não dá para medir).
  minutos: number | null;
  cobra: boolean;
  motivo: string | null;
};

export function avaliarRegistro(
  schedule: SchedulePlan,
  direcao: DirecaoRegistro,
  agora: Date,
): AvaliacaoRegistro {
  const dia = schedule[agora.getDay() as Weekday];
  if (!dia) {
    return {
      temHorario: false,
      minutos: null,
      cobra: true,
      motivo: "Sem horário contratado hoje — conferir a duração manualmente",
    };
  }
  const minutos = minutosHoraExtra(direcao, minutosDoDia(agora), dia);
  if (minutos === 0) return { temHorario: true, minutos: 0, cobra: false, motivo: null };
  const tolerancia = direcao === "entrada" ? TOLERANCIA_ENTRADA_MIN : TOLERANCIA_SAIDA_MIN;
  const referencia = direcao === "entrada" ? `antes das ${dia.entry}` : `depois das ${dia.exit}`;
  return {
    temHorario: true,
    minutos,
    cobra: true,
    motivo: `${formatarMinutos(minutos)} ${referencia} (tolerância de ${tolerancia} min)`,
  };
}

// Na portaria (QR) não há botão separado: a ponta é deduzida pela proximidade
// do horário contratado; sem horário, manhã é entrada e tarde é saída.
export function inferirDirecao(dia: DaySchedule, horarioRegistradoMin: number): DirecaoRegistro {
  if (!dia) return horarioRegistradoMin < 12 * 60 ? "entrada" : "saida";
  const meio = (hhmmParaMinutos(dia.entry) + hhmmParaMinutos(dia.exit)) / 2;
  return horarioRegistradoMin < meio ? "entrada" : "saida";
}

export function formatarMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}
