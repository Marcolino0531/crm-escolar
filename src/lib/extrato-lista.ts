// Regras de listagem do Extrato Bancário. Ficam fora do componente para que a
// completude da lista (nenhum lançamento do período escondido) seja testável.

export type ExtratoTx = {
  id: string;
  date: string;
  type: string;
  amount: number;
  description?: string | null;
  parent_transaction_id?: string | null;
};

// Lançamentos desmembrados (split): o pai é substituído pelas filhas, e somá-lo
// duplicaria o valor.
export function idsDePaisDesmembrados(txs: readonly ExtratoTx[]): Set<string> {
  const set = new Set<string>();
  for (const t of txs) {
    if (t.parent_transaction_id) set.add(t.parent_transaction_id);
  }
  return set;
}

// Ordenação do extrato: por Data (cronológica); dentro do dia, Entradas antes de
// Saídas; e, dentro de cada grupo, em ordem alfabética pela descrição.
function compararExtrato(a: ExtratoTx, b: ExtratoTx): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.type === "entrada" ? 0 : 1) - (b.type === "entrada" ? 0 : 1) ||
    String(a.description ?? "").localeCompare(String(b.description ?? ""), "pt-BR", {
      sensitivity: "base",
    }) ||
    a.id.localeCompare(b.id)
  );
}

// Todas as transações do período (limites inclusivos), sem teto de linhas.
export function transacoesDoPeriodo<T extends ExtratoTx>(
  txs: readonly T[],
  startDate: string,
  endDate: string,
  paisDesmembrados: Set<string> = idsDePaisDesmembrados(txs),
): T[] {
  return txs
    .filter((t) => t.date >= startDate && t.date <= endDate)
    .filter((t) => !paisDesmembrados.has(t.id))
    .sort(compararExtrato);
}

// Transações anteriores ao período, base do Saldo Inicial dinâmico.
export function transacoesAnteriores<T extends ExtratoTx>(
  txs: readonly T[],
  startDate: string,
  paisDesmembrados: Set<string> = idsDePaisDesmembrados(txs),
): T[] {
  return txs
    .filter((t) => !paisDesmembrados.has(t.id))
    .filter((t) => t.date < startDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export interface SaldosPeriodo {
  saldoInicial: number;
  entradas: number;
  saidas: number;
  saldoFinal: number;
}

/**
 * Cards Saldo Inicial / Entradas / Saídas / Saldo Final do Extrato Bancário.
 * O Saldo Inicial é o acumulado de TODAS as transações anteriores ao período
 * (sem pais desmembrados); só quando não existe nenhuma é que vale o saldo
 * manual (`initial_balances`). `txs` deve conter o histórico completo da(s)
 * unidade(s), não apenas o período.
 */
export function saldosDoPeriodo(
  txs: readonly ExtratoTx[],
  startDate: string,
  endDate: string,
  saldoManual: number | null | undefined,
): SaldosPeriodo {
  const pais = idsDePaisDesmembrados(txs);
  const doPeriodo = transacoesDoPeriodo(txs, startDate, endDate, pais);
  const anteriores = transacoesAnteriores(txs, startDate, pais);
  const entradas = doPeriodo
    .filter((t) => t.type === "entrada")
    .reduce((s, t) => s + Number(t.amount), 0);
  const saidas = doPeriodo
    .filter((t) => t.type === "saida")
    .reduce((s, t) => s + Number(t.amount), 0);
  const acumuladoAnterior = anteriores.reduce(
    (s, t) => s + (t.type === "entrada" ? Number(t.amount) : -Number(t.amount)),
    0,
  );
  const saldoInicial = anteriores.length > 0 ? acumuladoAnterior : Number(saldoManual ?? 0);
  return { saldoInicial, entradas, saidas, saldoFinal: saldoInicial + entradas - saidas };
}
