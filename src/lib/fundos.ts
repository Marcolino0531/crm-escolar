// Cálculo de rentabilidade dos Fundos de Investimento.
//
// A variação percentual mensal deve refletir apenas o ganho/perda real do
// fundo, isolando as movimentações de caixa do período (aportes e resgates).
// Sem isso, um resgate aparece como queda de rentabilidade e um aporte como
// alta artificial.

export interface RentabilidadeInput {
  /** Saldo líquido no fim do mês corrente (competência atual). */
  valorAtual: number | null;
  /** Saldo líquido no fim do mês anterior (base da comparação). */
  valorAnterior: number | null;
  /** Total aportado (dinheiro que entrou) no período. Ausente ⇒ 0. */
  aportes?: number | null;
  /** Total resgatado (dinheiro que saiu) no período. Ausente ⇒ 0. */
  resgates?: number | null;
}

// Arredonda um valor monetário para 2 casas (centavos inteiros), evitando que
// dízimas de ponto flutuante contaminem o cálculo do percentual.
function arredondaCentavos(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Rentabilidade real do período, em pontos percentuais.
 *
 *   (saldoAtual − saldoAnterior − aportes + resgates) / saldoAnterior × 100
 *
 * Retorna `null` quando não há base de comparação — saldo atual ou anterior
 * ausente, ou saldo anterior igual a zero (divisão indefinida).
 */
export function rentabilidadeRealPct(input: RentabilidadeInput): number | null {
  const { valorAtual, valorAnterior } = input;
  const aportes = input.aportes ?? 0;
  const resgates = input.resgates ?? 0;

  if (valorAtual == null || valorAnterior == null || valorAnterior === 0) {
    return null;
  }

  const ganho = arredondaCentavos(valorAtual - valorAnterior - aportes + resgates);
  return (ganho / valorAnterior) * 100;
}

export interface PatrimonioEntry {
  competencia: string;
  valor_liquido: number;
}

/**
 * Soma o patrimônio líquido por competência (mês), agregando todos os fundos.
 * Usada no gráfico de Evolução do Patrimônio, que continua mostrando o saldo
 * bruto (sem descontar movimentações).
 */
export function somarPatrimonioPorCompetencia(entries: PatrimonioEntry[]): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const e of entries) {
    byMonth.set(
      e.competencia,
      arredondaCentavos((byMonth.get(e.competencia) ?? 0) + Number(e.valor_liquido)),
    );
  }
  return byMonth;
}
