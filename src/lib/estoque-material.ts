// Helpers puros do Estoque de Material Escolar. Sem dependências de rede, para
// serem testáveis isoladamente. A agregação abaixo soma a quantidade de um
// mesmo material entre todas as turmas.

export interface MaterialStockRow {
  material: string;
  quantidade: number;
}

// Garante um inteiro não-negativo a partir de um valor possivelmente sujo
// (string, decimal, negativo). Quantidade de estoque é sempre inteira ≥ 0.
export function normalizarQuantidade(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * Soma a quantidade de cada material somando todas as turmas. A chave preserva
 * o nome do material exatamente como cadastrado; a ordem de inserção reflete a
 * primeira ocorrência de cada material na lista.
 */
export function totalPorMaterial(rows: ReadonlyArray<MaterialStockRow>): Map<string, number> {
  const totais = new Map<string, number>();
  for (const row of rows) {
    const atual = totais.get(row.material) ?? 0;
    totais.set(row.material, atual + normalizarQuantidade(row.quantidade));
  }
  return totais;
}

/** Quantidade total de itens em estoque (todas as turmas e materiais). */
export function quantidadeTotalGeral(rows: ReadonlyArray<MaterialStockRow>): number {
  let total = 0;
  for (const row of rows) total += normalizarQuantidade(row.quantidade);
  return total;
}
