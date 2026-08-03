import { describe, it, expect } from "vitest";
import {
  rentabilidadeRealPct,
  somarPatrimonioPorCompetencia,
  formatMovimentacaoBRL,
} from "./fundos";

describe("rentabilidadeRealPct", () => {
  it("sem movimentação: variação = ganho bruto sobre o saldo anterior", () => {
    // 100.000 → 105.000, nada aportado/resgatado ⇒ +5%
    expect(
      rentabilidadeRealPct({
        valorAtual: 105000,
        valorAnterior: 100000,
        aportes: 0,
        resgates: 0,
      }),
    ).toBeCloseTo(5, 10);
  });

  it("aportes ausentes/undefined equivalem a zero (comportamento atual preservado)", () => {
    expect(rentabilidadeRealPct({ valorAtual: 105000, valorAnterior: 100000 })).toBeCloseTo(5, 10);
  });

  it("só aporte: o dinheiro que entrou não conta como rentabilidade", () => {
    // Aporte de 100.000 num fundo que rendeu 0 ⇒ saldo dobra, mas variação = 0%.
    expect(
      rentabilidadeRealPct({
        valorAtual: 200000,
        valorAnterior: 100000,
        aportes: 100000,
        resgates: 0,
      }),
    ).toBeCloseTo(0, 10);
  });

  it("aporte + pequeno rendimento", () => {
    // 100.000 → 151.000 com aporte de 50.000 ⇒ ganho real 1.000 sobre 100.000 = +1%.
    expect(
      rentabilidadeRealPct({
        valorAtual: 151000,
        valorAnterior: 100000,
        aportes: 50000,
        resgates: 0,
      }),
    ).toBeCloseTo(1, 10);
  });

  it("só resgate: o dinheiro que saiu não conta como perda", () => {
    // Resgate de 100.000 sem rendimento ⇒ saldo cai pela metade, mas variação = 0%.
    expect(
      rentabilidadeRealPct({
        valorAtual: 100000,
        valorAnterior: 200000,
        aportes: 0,
        resgates: 100000,
      }),
    ).toBeCloseTo(0, 10);
  });

  it("resgate mascarando rendimento positivo real", () => {
    // 100.000 → 92.000 após resgatar 10.000 ⇒ ganho real 2.000 sobre 100.000 = +2%
    // (sem a correção apareceria como -8%).
    expect(
      rentabilidadeRealPct({
        valorAtual: 92000,
        valorAnterior: 100000,
        aportes: 0,
        resgates: 10000,
      }),
    ).toBeCloseTo(2, 10);
  });

  it("aporte e resgate no mesmo período", () => {
    // 100.000 → 120.000, aportou 30.000 e resgatou 8.000.
    // ganho real = 120.000 - 100.000 - 30.000 + 8.000 = -2.000 ⇒ -2%.
    expect(
      rentabilidadeRealPct({
        valorAtual: 120000,
        valorAnterior: 100000,
        aportes: 30000,
        resgates: 8000,
      }),
    ).toBeCloseTo(-2, 10);
  });

  it("rendimento real negativo permanece negativo", () => {
    // 100.000 → 95.000 sem movimentação ⇒ -5%.
    expect(
      rentabilidadeRealPct({
        valorAtual: 95000,
        valorAnterior: 100000,
        aportes: 0,
        resgates: 0,
      }),
    ).toBeCloseTo(-5, 10);
  });

  it("valores com centavos não sofrem ruído de ponto flutuante", () => {
    // ganho = 1.010,50 - 1.000,10 - 10,10 + 0 = 0,30 sobre 1.000,10.
    const r = rentabilidadeRealPct({
      valorAtual: 1010.5,
      valorAnterior: 1000.1,
      aportes: 10.1,
      resgates: 0,
    });
    expect(r).toBeCloseTo((0.3 / 1000.1) * 100, 10);
  });

  it("retorna null sem base de comparação", () => {
    expect(rentabilidadeRealPct({ valorAtual: 100, valorAnterior: null })).toBeNull();
    expect(rentabilidadeRealPct({ valorAtual: null, valorAnterior: 100 })).toBeNull();
    expect(rentabilidadeRealPct({ valorAtual: 100, valorAnterior: 0 })).toBeNull();
  });
});

describe("somarPatrimonioPorCompetencia", () => {
  it("agrega o saldo bruto por competência somando todos os fundos", () => {
    const m = somarPatrimonioPorCompetencia([
      { competencia: "2026-05-01", valor_liquido: 100000 },
      { competencia: "2026-05-01", valor_liquido: 50000 },
      { competencia: "2026-06-01", valor_liquido: 120000 },
    ]);
    expect(m.get("2026-05-01")).toBe(150000);
    expect(m.get("2026-06-01")).toBe(120000);
    expect(m.size).toBe(2);
  });

  it("soma valores com centavos sem ruído de ponto flutuante", () => {
    const m = somarPatrimonioPorCompetencia([
      { competencia: "2026-06-01", valor_liquido: 0.1 },
      { competencia: "2026-06-01", valor_liquido: 0.2 },
    ]);
    expect(m.get("2026-06-01")).toBe(0.3);
  });

  it("lista vazia gera mapa vazio", () => {
    expect(somarPatrimonioPorCompetencia([]).size).toBe(0);
  });
});

describe("formatMovimentacaoBRL", () => {
  // Normaliza os espaços do Intl (usa espaço não separável entre R$ e valor).
  const norm = (s: string) => s.replace(/\u00a0/g, " ");

  it("exibe travessão quando não há movimentação", () => {
    expect(formatMovimentacaoBRL(0)).toBe("—");
    expect(formatMovimentacaoBRL(null)).toBe("—");
    expect(formatMovimentacaoBRL(undefined)).toBe("—");
  });

  it("formata valor em reais quando há movimentação", () => {
    expect(norm(formatMovimentacaoBRL(100000))).toBe("R$ 100.000,00");
    expect(norm(formatMovimentacaoBRL(1234.5))).toBe("R$ 1.234,50");
  });

  it("formata centavos corretamente", () => {
    expect(norm(formatMovimentacaoBRL(0.1))).toBe("R$ 0,10");
  });
});
