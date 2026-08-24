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
