// Tabela de Preços dos Extras do Diário do Aluno — lógica pura.
//
// Preço por unidade × categoria × ano letivo. Refeições são cobradas por
// ocorrência (uma refeição fora do plano = 1 × preço); Hora Extra é cobrada
// por hora ou fração, proporcional aos minutos fora do horário contratado.

import { MEAL_LABEL, type MealKey } from "@/lib/diario";

export type CategoriaExtra = MealKey | "hora_extra";

export const CATEGORIAS_EXTRA: readonly CategoriaExtra[] = [
  "breakfast",
  "lunch",
  "snack",
  "dinner",
  "hora_extra",
];

export const ROTULO_CATEGORIA_EXTRA: Record<CategoriaExtra, string> = {
  ...MEAL_LABEL,
  hora_extra: "Hora Extra",
};

export function isCategoriaExtra(valor: string): valor is CategoriaExtra {
  return (CATEGORIAS_EXTRA as readonly string[]).includes(valor);
}

// Unidade de cobrança exibida na tela.
export function unidadeCobranca(categoria: CategoriaExtra): string {
  return categoria === "hora_extra" ? "por hora" : "por refeição";
}

export interface PrecoExtra {
  unidade: string;
  categoria: CategoriaExtra;
  anoLetivo: number;
  valor: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

// Preços de um ano/unidade indexados por categoria.
export type TabelaPrecos = Partial<Record<CategoriaExtra, number>>;

export function tabelaDoAno(
  precos: readonly PrecoExtra[],
  unidade: string,
  anoLetivo: number,
): TabelaPrecos {
  const tabela: TabelaPrecos = {};
  for (const p of precos) {
    if (p.unidade === unidade && p.anoLetivo === anoLetivo) tabela[p.categoria] = p.valor;
  }
  return tabela;
}

export function categoriasSemPreco(tabela: TabelaPrecos): CategoriaExtra[] {
  return CATEGORIAS_EXTRA.filter((c) => tabela[c] === undefined);
}

function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// Refeição fora do plano: ocorrências × preço da categoria.
export function valorRefeicoes(ocorrencias: number, precoUnitario: number): number {
  if (ocorrencias <= 0 || precoUnitario <= 0) return 0;
  return centavos(ocorrencias * precoUnitario);
}

// Hora Extra: minutos convertidos em fração de hora × preço da hora.
export function valorHoraExtra(minutos: number, precoHora: number): number {
  if (minutos <= 0 || precoHora <= 0) return 0;
  return centavos((minutos / 60) * precoHora);
}

// Anos oferecidos no cadastro: os já cadastrados mais o vigente e o seguinte.
export function anosDaTabela(precos: readonly PrecoExtra[], anoVigente: number): number[] {
  const anos = new Set<number>([anoVigente, anoVigente + 1]);
  for (const p of precos) anos.add(p.anoLetivo);
  return [...anos].sort((a, b) => b - a);
}
