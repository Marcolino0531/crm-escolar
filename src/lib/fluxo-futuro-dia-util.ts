// Ajuste de vencimento das Despesas Previstas (Fluxo Futuro) para dia útil.
//
// A partir de outubro/2026, o vencimento calculado de um lançamento RECORRENTE
// (gerado a partir de uma série: fixa, sazonal ou parcelada) que caia em
// sábado, domingo ou feriado é movido para o próximo dia útil. "Salário" não usa
// dia fixo: vence sempre no 5º dia útil do mês.
//
// Feriados: reaproveita a base de feriados NACIONAIS da cobrança automática
// (`billing-schedule`) e acrescenta os feriados MUNICIPAIS de Belo Horizonte,
// pois os pagamentos saem de contas bancárias da cidade (agências fechadas).
//
// Lançamentos avulsos (sem série) mantêm a data informada manualmente.
// Lançamentos de setembro/2026 ou anteriores nunca são alterados.

import { addDaysYMD, isFeriadoNacional, isFimDeSemana } from "./billing-schedule";

// Primeiro mês (YYYY-MM-01) em que a regra de dia útil passa a valer.
export const MES_INICIO_DIA_UTIL = "2026-10-01";

// Feriados municipais de Belo Horizonte (MM-DD).
export const FERIADOS_BH: readonly string[] = [
  "08-15", // Assunção de Nossa Senhora
  "12-08", // Imaculada Conceição
];

export function isFeriadoBH(ymd: string): boolean {
  return FERIADOS_BH.includes(ymd.slice(5));
}

// Dia útil para pagamentos: não é fim de semana, feriado nacional nem feriado
// municipal de BH.
export function isDiaUtilDespesa(ymd: string): boolean {
  return !isFimDeSemana(ymd) && !isFeriadoNacional(ymd) && !isFeriadoBH(ymd);
}

export function proximoDiaUtilDespesa(ymd: string): string {
  let d = ymd;
  while (!isDiaUtilDespesa(d)) d = addDaysYMD(d, 1);
  return d;
}

// N-ésimo dia útil do mês (`monthIso` = "YYYY-MM-01"), contando a partir do dia 1.
export function enesimoDiaUtil(monthIso: string, n: number): string {
  let d = `${monthIso.slice(0, 7)}-01`;
  let contados = 0;
  for (;;) {
    if (isDiaUtilDespesa(d)) {
      contados++;
      if (contados === n) return d;
    }
    d = addDaysYMD(d, 1);
  }
}

// Vencimento "cru" da série no mês: dia fixo limitado ao último dia do mês.
export function vencimentoDiaFixo(monthIso: string, day: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function ehSalario(descricao: string): boolean {
  return (
    descricao
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase() === "salario"
  );
}

export function regraDiaUtilAtiva(monthIso: string): boolean {
  return monthIso >= MES_INICIO_DIA_UTIL;
}

// Vencimento de um lançamento recorrente no mês informado:
// - antes de outubro/2026: dia fixo, sem ajuste (comportamento anterior);
// - a partir de outubro/2026: "Salário" → 5º dia útil; demais → dia fixo movido
//   para o próximo dia útil quando cair em dia não útil.
export function vencimentoRecorrente(monthIso: string, dueDay: number, descricao: string): string {
  const fixo = vencimentoDiaFixo(monthIso, dueDay);
  if (!regraDiaUtilAtiva(monthIso)) return fixo;
  if (ehSalario(descricao)) return enesimoDiaUtil(monthIso, 5);
  return proximoDiaUtilDespesa(fixo);
}
