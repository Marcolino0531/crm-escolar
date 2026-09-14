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

/**
 * Formata um valor de movimentação (aporte/resgate) para exibição na tabela.
 * Retorna um travessão ("—") quando não houve movimentação — valor ausente ou
 * zero — seguindo o mesmo padrão visual das demais colunas sem dado.
 */
export function formatMovimentacaoBRL(valor: number | null | undefined): string {
  if (valor == null || valor === 0) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

/** "2026-03-01" → "março de 2026" (rótulo do eixo X do gráfico de patrimônio). */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export interface PatrimonioEntryPorFundo extends PatrimonioEntry {
  fund_id: string;
}

export interface PontoPatrimonioTotal {
  month: string;
  total: number;
}

/** Série do total (todos os fundos somados) por competência, em ordem cronológica. */
export function serieTotalPatrimonio(entries: PatrimonioEntry[]): PontoPatrimonioTotal[] {
  const byMonth = somarPatrimonioPorCompetencia(entries);
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([comp, total]) => ({ month: monthLabel(comp), total }));
}

/**
 * Série multi-linha: um ponto por competência com uma chave por fundo
 * (`chave(f)`, ex.: nome ou id). Fundo sem lançamento no mês sai como 0.
 */
export function seriePatrimonioPorFundo<F extends { id: string }>(
  entries: PatrimonioEntryPorFundo[],
  funds: F[],
  chave: (f: F) => string,
): Array<Record<string, number | string>> {
  const months = [...new Set(entries.map((e) => e.competencia))].sort();
  return months.map((m) => {
    const point: Record<string, number | string> = { month: monthLabel(m) };
    for (const f of funds) {
      const e = entries.find((x) => x.fund_id === f.id && x.competencia === m);
      point[chave(f)] = e ? Number(e.valor_liquido) : 0;
    }
    return point;
  });
}
