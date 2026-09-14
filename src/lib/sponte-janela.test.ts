import { describe, expect, it } from "vitest";
import { diasNaJanela, janelaDeDias, MAX_DIAS_INADIMPLENCIA } from "./sponte-janela";

function contarDias(inicio: string, fim: string): number {
  return (
    Math.round((Date.parse(fim + "T00:00:00Z") - Date.parse(inicio + "T00:00:00Z")) / 86400000) + 1
  );
}

describe("janelaDeDias", () => {
  it("cobre TODOS os dias de um período maior que 186 dias (01/01 → 14/09 = 257 dias)", () => {
    const { dias, parcialAte } = janelaDeDias("2026-01-01", "2026-09-14", MAX_DIAS_INADIMPLENCIA);
    expect(dias).toHaveLength(257);
    expect(dias).toHaveLength(contarDias("2026-01-01", "2026-09-14"));
    expect(dias[0]).toBe("2026-01-01");
    expect(dias[185]).toBe("2026-07-05");
    expect(dias[186]).toBe("2026-07-06"); // primeiro dia que o teto antigo de 186 descartava
    expect(dias[dias.length - 1]).toBe("2026-09-14");
    expect(new Set(dias).size).toBe(257);
    expect(parcialAte).toBeNull();
  });

  it("um ano inteiro (366 dias) cabe no teto da inadimplência sem corte", () => {
    const { dias, parcialAte } = janelaDeDias("2028-01-01", "2028-12-31", MAX_DIAS_INADIMPLENCIA);
    expect(dias).toHaveLength(366);
    expect(parcialAte).toBeNull();
  });

  it("acima do teto, corta e SINALIZA o último dia coberto (nunca silencioso)", () => {
    const { dias, parcialAte } = janelaDeDias("2026-01-01", "2026-09-14", 186);
    expect(dias).toHaveLength(186);
    expect(dias[dias.length - 1]).toBe("2026-07-05");
    expect(parcialAte).toBe("2026-07-05");
  });

  it("período que cabe exatamente no teto não é marcado como parcial", () => {
    const { dias, parcialAte } = janelaDeDias("2026-01-01", "2026-01-31", 31);
    expect(dias).toHaveLength(31);
    expect(parcialAte).toBeNull();
  });

  it("início após o fim devolve lista vazia sem parcial", () => {
    expect(janelaDeDias("2026-02-01", "2026-01-01", 31)).toEqual({ dias: [], parcialAte: null });
  });

  it("diasNaJanela mantém o padrão mensal de 31 dias para os blocos do mês", () => {
    expect(diasNaJanela("2026-03-01", "2026-03-31")).toHaveLength(31);
    expect(diasNaJanela("2026-02-01", "2026-02-28")).toHaveLength(28);
  });
});
