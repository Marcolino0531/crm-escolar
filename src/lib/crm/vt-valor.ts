// Valor diário do Vale-Transporte: o campo é texto para aceitar a vírgula
// decimal, então entrada (digitada ou vinda do banco) e saída passam pelo mesmo
// par de funções — o valor gravado não depende de reabrir o modal.
import { formatBRLInput, parseBRLNumber } from "@/lib/currency";

/** Texto do campo -> número gravado. Ex.: "16,90" -> 16.9 ; "16.90" -> 16.9. */
export function parseValorVt(texto: string): number {
  const n = parseBRLNumber(texto);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Número gravado -> texto do campo. Ex.: 16.9 -> "16,90". */
export function formatValorVt(valor: number | null | undefined): string {
  if (valor == null) return "";
  return formatBRLInput(valor);
}

export function valorVtValido(texto: string): boolean {
  if (!texto.trim()) return false;
  const n = parseBRLNumber(texto);
  return Number.isFinite(n) && n >= 0;
}
