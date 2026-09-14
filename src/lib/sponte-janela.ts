// Enumeração dos dias de uma janela [inicioYMD, fimYMD] (inclusiva) em
// "YYYY-MM-DD", com teto de segurança EXPLÍCITO: quando o período pedido excede
// `maxDias`, a lista é cortada e `parcialAte` informa o último dia coberto —
// nunca truncamos em silêncio.

// Teto da varredura dia a dia da inadimplência (anual e por período customizado).
// Cobre com folga um ano letivo inteiro (366 dias); medido em produção, o ano
// inteiro (~257 dias, lotes de 10) leva 10–15s por unidade.
export const MAX_DIAS_INADIMPLENCIA = 400;

export interface JanelaDeDias {
  dias: string[];
  /** Último dia efetivamente coberto quando a janela foi cortada pelo teto; null = completa. */
  parcialAte: string | null;
}

export function janelaDeDias(inicioYMD: string, fimYMD: string, maxDias: number): JanelaDeDias {
  const dias: string[] = [];
  const [yi, mi, di] = inicioYMD.split("-").map(Number);
  const [yf, mf, df] = fimYMD.split("-").map(Number);
  let cur = Date.UTC(yi, mi - 1, di);
  const end = Date.UTC(yf, mf - 1, df);
  while (cur <= end && dias.length < maxDias) {
    const dt = new Date(cur);
    dias.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
    cur += 86400000;
  }
  const parcialAte = cur <= end && dias.length > 0 ? dias[dias.length - 1] : null;
  return { dias, parcialAte };
}

export function diasNaJanela(inicioYMD: string, fimYMD: string, maxDias = 31): string[] {
  return janelaDeDias(inicioYMD, fimYMD, maxDias).dias;
}
