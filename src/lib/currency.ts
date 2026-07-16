// Utilidades de moeda no padrão brasileiro (BRL).
//
// Regra pt-BR: ponto (.) = separador de milhares, vírgula (,) = separador
// decimal. Também toleramos entradas no padrão americano (12,731.17) e valores
// simples digitados manualmente (1234.56 / 12,5), inferindo o separador decimal
// pelo último símbolo presente.

/**
 * Converte um texto de valor monetário para número.
 * Ex.: "12.731,17" -> 12731.17 ; "1.234" -> 1234 ; "1234.56" -> 1234.56.
 * Retorna NaN quando não há dígitos.
 */
export function parseBRLNumber(input: string | number): number {
  if (typeof input === "number") return input;
  let s = (input ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!s) return NaN;

  const negativo = s.startsWith("-");
  s = s.replace(/-/g, "");

  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");

  if (temVirgula && temPonto) {
    // O último separador é o decimal (BR: 12.731,17 | US: 12,731.17).
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (temVirgula) {
    // Só vírgula: é o decimal. Ex.: "12731,17".
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (temPonto) {
    // Só ponto: pode ser milhar (12.731 / 1.234.567) ou decimal (1234.56 / 12.5).
    const partes = s.split(".");
    const ultima = partes[partes.length - 1];
    if (partes.length > 2 || ultima.length === 3) {
      s = s.replace(/\./g, ""); // agrupamento de milhares
    }
    // caso contrário mantém como decimal
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return negativo ? -n : n;
}

/**
 * Formata um número para exibição amigável em pt-BR com 2 casas (sem "R$").
 * Ex.: 12731.17 -> "12.731,17".
 */
export function formatBRLInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
