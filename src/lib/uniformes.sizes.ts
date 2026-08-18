// Ordenação de tamanhos de uniforme, compartilhada pela tabela de estoque e pelo
// relatório de vendas (onde os tamanhos são as colunas da grade).

// Ordem canônica de tamanhos por letra (quando o tamanho não é numérico).
const LETTER_SIZE_ORDER = ["pp", "p", "m", "g", "gg", "xg", "xgg", "exg"];

// Chave de ordenação de tamanho: numéricos primeiro (por valor), depois letras
// na ordem canônica e, por fim, os demais em ordem alfabética.
function sizeKey(size: string): [number, number, string] {
  const s = (size ?? "").trim().toLowerCase();
  const num = s.match(/^\d+(?:[.,]\d+)?/);
  if (num) return [0, parseFloat(num[0].replace(",", ".")), s];
  const idx = LETTER_SIZE_ORDER.indexOf(s);
  if (idx >= 0) return [1, idx, s];
  return [2, 0, s];
}

export function compareSize(a: string, b: string): number {
  const ka = sizeKey(a);
  const kb = sizeKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[0] === 2) return ka[2].localeCompare(kb[2], "pt-BR");
  return ka[1] - kb[1];
}
