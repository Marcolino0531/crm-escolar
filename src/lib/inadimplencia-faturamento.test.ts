import { describe, expect, it } from "vitest";
import { IDS_VAZIOS, type IdsFinanceiros } from "./dashboard-financeiro";
import {
  anosDisponiveis,
  faturamentoRecebido,
  indiceInadimplencia,
  janelaAnual,
  type ReceitaExtrato,
} from "./inadimplencia-faturamento";

const ids: IdsFinanceiros = {
  ...IDS_VAZIOS,
  resgateInvestimento: "cat-resgate",
  transferenciaRecebida: "cat-aporte",
};

const rows: ReceitaExtrato[] = [
  { amount: 1000, description: "PIX RECEBIDO MENSALIDADE", revenue_category_id: "cat-mensal" },
  { amount: 500, description: "COB COMPE", revenue_category_id: null },
  { amount: 1, description: "PLACEHOLDER", revenue_category_id: "cat-mensal" },
  { amount: 9999, description: "SALDO DIA", revenue_category_id: null },
  { amount: 3000, description: "RESGATE FUNDO", revenue_category_id: "cat-resgate" },
  { amount: 2000, description: "PIX RECEBIDO BELVEDERE", revenue_category_id: "cat-aporte" },
];

describe("faturamentoRecebido", () => {
  it("mantém os filtros antigos (SALDO DIA e valor 1)", () => {
    expect(faturamentoRecebido(rows, IDS_VAZIOS)).toBe(1000 + 500 + 3000 + 2000);
  });

  it("exclui resgate de fundo e aporte recebido de outra unidade", () => {
    expect(faturamentoRecebido(rows, ids)).toBe(1500);
  });

  it("a exclusão aumenta o índice de inadimplência (mensal e anual)", () => {
    const inadimplente = 500;
    const antes = faturamentoRecebido(rows, IDS_VAZIOS);
    const depois = faturamentoRecebido(rows, ids);
    // Mensal: inadimplente ÷ (recebido + inadimplente)
    const mensalAntes = indiceInadimplencia(inadimplente, antes + inadimplente);
    const mensalDepois = indiceInadimplencia(inadimplente, depois + inadimplente);
    expect(mensalDepois).toBeGreaterThan(mensalAntes);
    expect(mensalDepois).toBeCloseTo(25, 5);
    // Anual: inadimplente ÷ (retroativo + receitas)
    const retro = 1000;
    expect(indiceInadimplencia(inadimplente, retro + depois)).toBeGreaterThan(
      indiceInadimplencia(inadimplente, retro + antes),
    );
  });

  it("aceita amount como string (numeric do Postgres)", () => {
    expect(
      faturamentoRecebido([{ amount: "10.50", description: "X", revenue_category_id: null }], ids),
    ).toBeCloseTo(10.5);
  });
});

describe("janelaAnual", () => {
  const hoje = "2026-09-14";

  it("ano corrente (2026): 01/01 → hoje, receitas desde junho, com retroativo", () => {
    expect(janelaAnual(2026, hoje)).toEqual({
      inicioYMD: "2026-01-01",
      fimYMD: "2026-09-14",
      receitasDesdeYMD: "2026-06-01",
      usaRetroativo: true,
      semDados: false,
    });
  });

  it("2026 visto de 2027: fim em 31/12 e ainda usa retroativo", () => {
    const j = janelaAnual(2026, "2027-03-10");
    expect(j.fimYMD).toBe("2026-12-31");
    expect(j.receitasDesdeYMD).toBe("2026-06-01");
    expect(j.usaRetroativo).toBe(true);
  });

  it("2027 (corrente): receitas desde 01/01, sem retroativo, fim hoje", () => {
    expect(janelaAnual(2027, "2027-03-10")).toEqual({
      inicioYMD: "2027-01-01",
      fimYMD: "2027-03-10",
      receitasDesdeYMD: "2027-01-01",
      usaRetroativo: false,
      semDados: false,
    });
  });

  it("antes de 2026: sem dados", () => {
    expect(janelaAnual(2025, hoje).semDados).toBe(true);
  });
});

describe("anosDisponiveis / indiceInadimplencia", () => {
  it("lista do ano corrente até 2026, mais recente primeiro", () => {
    expect(anosDisponiveis(2026)).toEqual([2026]);
    expect(anosDisponiveis(2028)).toEqual([2028, 2027, 2026]);
  });

  it("índice zero sem faturamento", () => {
    expect(indiceInadimplencia(100, 0)).toBe(0);
  });
});
