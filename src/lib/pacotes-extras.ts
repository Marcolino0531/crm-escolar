// Valor Pacotes Extras: pacote MENSAL (5 dias por semana) de cada refeição e da
// hora extra, por colégio × ano letivo. Lógica pura, sem rede.
//
// Valor mensal cobrado = pacote ÷ 5 × dias úteis marcados na semana, ao centavo
// (meio para cima). Não depende da data da matrícula nem de feriados/férias.

import type { MealKey } from "@/lib/diario";
import type { CategoriaExtra } from "@/lib/rematricula-extras";

export const ITENS_PACOTE_EXTRAS = [
  "lanche_manha",
  "almoco",
  "lanche_tarde",
  "jantar",
  "hora_extra",
] as const;

export type ItemPacoteExtras = (typeof ITENS_PACOTE_EXTRAS)[number];

export type RefeicaoPacote = Exclude<ItemPacoteExtras, "hora_extra">;

export type PacotesExtras = Record<ItemPacoteExtras, number>;

/** Categoria no Sponte: as mesmas da rematrícula (CATEGORIAS_EXTRAS_REMATRICULA). */
export const CATEGORIA_SPONTE_POR_ITEM: Record<ItemPacoteExtras, CategoriaExtra> = {
  lanche_manha: "Lanche da Manhã",
  almoco: "Almoço",
  lanche_tarde: "Lanche da Tarde",
  jantar: "Jantar",
  hora_extra: "Hora Extra",
};

/** Refeição da rotina (chave do Diário) → item do pacote. */
export const ITEM_POR_REFEICAO: Record<MealKey, RefeicaoPacote> = {
  breakfast: "lanche_manha",
  lunch: "almoco",
  snack: "lanche_tarde",
  dinner: "jantar",
};

export const REFEICOES_PACOTE: readonly MealKey[] = ["breakfast", "lunch", "snack", "dinner"];

export function pacotesVazios(): PacotesExtras {
  return { lanche_manha: 0, almoco: 0, lanche_tarde: 0, jantar: 0, hora_extra: 0 };
}

/** Arredonda ao centavo com meio para cima (evita 0.1+0.2 do float). */
export function arredondarCentavo(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Valor mensal de um item: pacote de 5 dias ÷ 5 × dias marcados, ao centavo.
 * Ex.: R$ 500,00 em 3 dias = R$ 300,00; R$ 100,01 em 3 dias = R$ 60,01.
 */
export function valorMensalPacote(pacoteMensal: number, diasPorSemana: number): number {
  if (diasPorSemana <= 0) return 0;
  return arredondarCentavo((pacoteMensal / 5) * diasPorSemana);
}

export function pacoteSemValor(valor: number | null | undefined): boolean {
  return valor === null || valor === undefined || Math.round(valor * 100) <= 0;
}

export function mensagemPacoteSemValor(item: ItemPacoteExtras, anoLetivo: number): string {
  return `Pacote de ${CATEGORIA_SPONTE_POR_ITEM[item]} ${anoLetivo} sem valor em Cadastros Gerais > Valor Pacotes Extras. Lance na mão.`;
}
