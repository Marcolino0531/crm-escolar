// Datas do apontamento de faltas de terceirizados: dia da semana derivado da
// data e conferência da falta contra a grade semanal. Lógica pura, sem React.

import type { DiaSemana, GradeTurnos, Turno, TurnoFalta } from "./types";

// Dias úteis da grade (a grade só tem seg–sex).
const DIA_POR_GETDAY: Record<number, DiaSemana | undefined> = {
  1: "seg",
  2: "ter",
  3: "qua",
  4: "qui",
  5: "sex",
};

export const DIA_SEMANA_LABEL: Record<DiaSemana, string> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
};

const FIM_DE_SEMANA_LABEL: Record<number, string> = { 0: "Domingo", 6: "Sábado" };

export const DIAS_SEMANA: { id: DiaSemana; label: string }[] = (
  ["seg", "ter", "qua", "qui", "sex"] as const
).map((id) => ({ id, label: DIA_SEMANA_LABEL[id] }));

export const TURNOS: { id: Turno; label: string }[] = [
  { id: "manha", label: "Manhã" },
  { id: "tarde", label: "Tarde" },
];

export function gradeVazia(): GradeTurnos {
  return DIAS_SEMANA.reduce((acc, d) => {
    acc[d.id] = { manha: false, tarde: false };
    return acc;
  }, {} as GradeTurnos);
}

// A data é lida como local (`T00:00:00`) e não como UTC: `new Date("2026-08-17")`
// seria meia-noite UTC, ou seja, 16/08 21h no Brasil — um dia a menos.
function dataLocal(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Dia da grade correspondente à data; `null` no fim de semana ou data inválida.
export function diaSemanaDaISO(iso: string): DiaSemana | null {
  const d = dataLocal(iso);
  if (!d) return null;
  return DIA_POR_GETDAY[d.getDay()] ?? null;
}

// Nome do dia da semana, inclusive sábado e domingo (que não existem na grade).
export function rotuloDiaSemana(iso: string): string {
  const d = dataLocal(iso);
  if (!d) return "";
  const dia = DIA_POR_GETDAY[d.getDay()];
  return dia ? DIA_SEMANA_LABEL[dia] : (FIM_DE_SEMANA_LABEL[d.getDay()] ?? "");
}

function paraBR(iso: string): string {
  const [ano, mes, dia] = (iso ?? "").split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
}

// "17/08/2026, Segunda" — usado em toda exibição de data do módulo.
export function dataComDiaSemana(iso: string): string {
  const br = paraBR(iso);
  if (!br) return "";
  const dia = rotuloDiaSemana(iso);
  return dia ? `${br}, ${dia}` : br;
}

// Turnos que a grade prevê no dia da semana daquela data. Só existe "dia
// completo" quando o terceirizado trabalha nos dois turnos naquele dia.
export function turnosDaGradeNaData(grade: GradeTurnos, iso: string): TurnoFalta[] {
  const dia = diaSemanaDaISO(iso);
  if (!dia) return [];
  const doDia = grade[dia];
  if (!doDia) return [];
  const turnos: TurnoFalta[] = [];
  if (doDia.manha) turnos.push("manha");
  if (doDia.tarde) turnos.push("tarde");
  if (doDia.manha && doDia.tarde) turnos.push("dia");
  return turnos;
}

export type ConferenciaFalta =
  | { ok: true }
  | {
      ok: false;
      motivo: "data_invalida" | "fim_de_semana" | "dia_sem_turno" | "turno_fora_da_grade";
      mensagem: string;
    };

const TURNO_LABEL: Record<TurnoFalta, string> = {
  manha: "manhã",
  tarde: "tarde",
  dia: "dia completo",
};

// Confere a falta contra a grade do terceirizado, para não lançar falta em dia
// ou turno em que ele não estava escalado.
export function conferirFalta(
  grade: GradeTurnos,
  iso: string,
  turno: TurnoFalta,
): ConferenciaFalta {
  if (!dataLocal(iso)) {
    return {
      ok: false,
      motivo: "data_invalida",
      mensagem: "Informe uma data válida (dd/mm/aaaa).",
    };
  }

  const dia = diaSemanaDaISO(iso);
  if (!dia) {
    return {
      ok: false,
      motivo: "fim_de_semana",
      mensagem: `${paraBR(iso)} é ${rotuloDiaSemana(iso).toLowerCase()} — a grade vai de segunda a sexta.`,
    };
  }

  const disponiveis = turnosDaGradeNaData(grade, iso);
  const rotuloDia = DIA_SEMANA_LABEL[dia].toLowerCase();
  if (disponiveis.length === 0) {
    return {
      ok: false,
      motivo: "dia_sem_turno",
      mensagem: `A grade não tem nenhum turno na ${rotuloDia}: ${paraBR(iso)} não é dia de trabalho.`,
    };
  }

  if (!disponiveis.includes(turno)) {
    const grafia = disponiveis
      .filter((t) => t !== "dia")
      .map((t) => TURNO_LABEL[t])
      .join(" e ");
    return {
      ok: false,
      motivo: "turno_fora_da_grade",
      mensagem: `Na ${rotuloDia} a grade prevê só ${grafia} — não há ${TURNO_LABEL[turno]} para faltar.`,
    };
  }

  return { ok: true };
}
