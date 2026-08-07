import { describe, it, expect } from "vitest";
import {
  parcelasVencidas,
  calcularTotalVencido,
  valorAtualizadoParcela,
  type ParcelaAberta,
} from "./billing-debt";

const HOJE = "2026-08-07";

describe("parcelasVencidas", () => {
  it("mantém apenas parcelas com vencimento <= hoje e saldo > 0", () => {
    const boletos: ParcelaAberta[] = [
      { vencimento: "2026-07-05", saldo: 100 }, // vencida
      { vencimento: "2026-08-07", saldo: 200 }, // vence hoje → conta
      { vencimento: "2026-09-05", saldo: 300 }, // futura → fora
      { vencimento: "2026-06-05", saldo: 0 }, // paga (saldo 0) → fora
      { vencimento: "", saldo: 50 }, // sem vencimento → fora
    ];
    expect(parcelasVencidas(boletos, HOJE).map((b) => b.vencimento)).toEqual([
      "2026-07-05",
      "2026-08-07",
    ]);
  });

  it("nunca inclui parcelas com vencimento futuro", () => {
    const boletos: ParcelaAberta[] = [
      { vencimento: "2026-09-01", saldo: 100 },
      { vencimento: "2026-12-31", saldo: 200 },
    ];
    expect(parcelasVencidas(boletos, HOJE)).toEqual([]);
  });

  it("nunca inclui parcelas já pagas (saldo <= 0), mesmo se vencidas", () => {
    const boletos: ParcelaAberta[] = [
      { vencimento: "2026-01-05", saldo: 0 },
      { vencimento: "2026-02-05", saldo: -10 },
      { vencimento: "2026-03-05", saldo: 500 },
    ];
    expect(parcelasVencidas(boletos, HOJE).map((b) => b.saldo)).toEqual([500]);
  });
});

describe("valorAtualizadoParcela", () => {
  it("sem atraso devolve o valor original", () => {
    expect(valorAtualizadoParcela(1000, "2026-08-07", HOJE)).toBe(1000);
    expect(valorAtualizadoParcela(1000, "2026-09-01", HOJE)).toBe(1000);
  });

  it("vencida aplica 2% de multa + 1%/mês pró rata die", () => {
    // 30 dias de atraso: multa 2% + juros 1% (30/30) = +3% → 1030
    expect(valorAtualizadoParcela(1000, "2026-07-08", HOJE)).toBeCloseTo(1030, 2);
  });
});

describe("calcularTotalVencido — cenários de categorias", () => {
  it("uma única categoria vencida", () => {
    const boletos: ParcelaAberta[] = [{ vencimento: "2026-08-05", saldo: 1775.95 }];
    // 2 dias de atraso.
    const esperado = valorAtualizadoParcela(1775.95, "2026-08-05", HOJE);
    expect(calcularTotalVencido(boletos, HOJE)).toBeCloseTo(Math.round(esperado * 100) / 100, 2);
  });

  it("múltiplas categorias vencidas no mesmo mês somam todas", () => {
    const boletos: ParcelaAberta[] = [
      { vencimento: "2026-08-05", saldo: 1775.95 }, // mensalidade
      { vencimento: "2026-08-05", saldo: 206.4 }, // material
      { vencimento: "2026-08-05", saldo: 550 }, // hora extra
      { vencimento: "2026-08-05", saldo: 220 }, // almoço
      { vencimento: "2026-08-05", saldo: 220 }, // jantar
    ];
    const bruto = 1775.95 + 206.4 + 550 + 220 + 220;
    // Todas com o mesmo atraso; total atualizado > bruto por causa de multa/juros.
    const total = calcularTotalVencido(boletos, HOJE);
    expect(total).toBeGreaterThan(bruto);
    expect(total).toBeLessThan(bruto * 1.05);
  });

  it("parcelas futuras no plano NÃO entram no total (bug corrigido)", () => {
    const soVencidas: ParcelaAberta[] = [{ vencimento: "2026-08-05", saldo: 1000 }];
    const comFuturas: ParcelaAberta[] = [
      ...soVencidas,
      { vencimento: "2026-09-05", saldo: 1000 },
      { vencimento: "2026-10-05", saldo: 1000 },
    ];
    expect(calcularTotalVencido(comFuturas, HOJE)).toBeCloseTo(
      calcularTotalVencido(soVencidas, HOJE),
      2,
    );
  });

  it("parcelas pagas não entram no total", () => {
    const boletos: ParcelaAberta[] = [
      { vencimento: "2026-08-05", saldo: 1000 },
      { vencimento: "2026-07-05", saldo: 0 },
      { vencimento: "2026-06-05", saldo: -50 },
    ];
    const soAberta: ParcelaAberta[] = [{ vencimento: "2026-08-05", saldo: 1000 }];
    expect(calcularTotalVencido(boletos, HOJE)).toBeCloseTo(
      calcularTotalVencido(soAberta, HOJE),
      2,
    );
  });
});

// Dados reais do Sponte (GetParcelas Situacao=Aberta) na data 2026-08-07,
// capturados via scripts/probe-divida-alunos.cjs. Servem de teste de borda:
// o total corrigido deve considerar só as vencidas, batendo com o Sponte.

describe("cenário aluno Anthony Castilho Marques (AlunoID 883)", () => {
  const planoCompleto: ParcelaAberta[] = [
    { vencimento: "2026-07-17", saldo: 924.0 }, // Matrícula (vencida)
    { vencimento: "2026-08-05", saldo: 1775.95 }, // Mensalidade ago (vencida)
    { vencimento: "2026-08-05", saldo: 70.0 }, // Material ago (vencida)
    { vencimento: "2026-09-07", saldo: 1775.95 }, // futuras...
    { vencimento: "2026-09-07", saldo: 70.0 },
    { vencimento: "2026-10-05", saldo: 1775.95 },
    { vencimento: "2026-10-05", saldo: 70.0 },
    { vencimento: "2026-11-05", saldo: 1775.95 },
    { vencimento: "2026-12-07", saldo: 1775.95 },
  ];

  it("considera apenas as 3 parcelas vencidas", () => {
    const v = parcelasVencidas(planoCompleto, HOJE);
    expect(v).toHaveLength(3);
    expect(v.reduce((s, b) => s + b.saldo, 0)).toBeCloseTo(2769.95, 2);
  });

  it("total corrigido (com juros) ≈ R$ 2.833,05, não R$ 10.076,85", () => {
    expect(calcularTotalVencido(planoCompleto, HOJE)).toBeCloseTo(2833.05, 2);
  });
});

describe("cenário aluna Giovanna Gomes Oliveira Maron (AlunoID 554)", () => {
  const vencidas: ParcelaAberta[] = [
    { vencimento: "2026-01-05", saldo: 1473.36 },
    { vencimento: "2026-04-06", saldo: 1775.95 },
    { vencimento: "2026-04-06", saldo: 206.4 },
    { vencimento: "2026-04-06", saldo: 550.0 },
    { vencimento: "2026-04-06", saldo: 220.0 },
    { vencimento: "2026-04-06", saldo: 220.0 },
    { vencimento: "2026-05-05", saldo: 1775.95 },
    { vencimento: "2026-05-05", saldo: 550.0 },
    { vencimento: "2026-05-05", saldo: 220.0 },
    { vencimento: "2026-05-05", saldo: 220.0 },
    { vencimento: "2026-05-05", saldo: 180.0 },
    { vencimento: "2026-06-05", saldo: 1775.95 },
    { vencimento: "2026-06-05", saldo: 550.0 },
    { vencimento: "2026-06-05", saldo: 220.0 },
    { vencimento: "2026-06-05", saldo: 220.0 },
    { vencimento: "2026-07-06", saldo: 1775.95 },
    { vencimento: "2026-07-06", saldo: 206.4 },
    { vencimento: "2026-07-06", saldo: 550.0 },
    { vencimento: "2026-07-06", saldo: 220.0 },
    { vencimento: "2026-07-06", saldo: 220.0 },
    { vencimento: "2026-08-05", saldo: 1775.95 },
    { vencimento: "2026-08-05", saldo: 206.4 },
    { vencimento: "2026-08-05", saldo: 550.0 },
    { vencimento: "2026-08-05", saldo: 220.0 },
    { vencimento: "2026-08-05", saldo: 220.0 },
  ];
  const futuras: ParcelaAberta[] = [
    { vencimento: "2026-09-07", saldo: 1775.95 },
    { vencimento: "2026-09-07", saldo: 206.4 },
    { vencimento: "2026-09-07", saldo: 550.0 },
    { vencimento: "2026-09-07", saldo: 220.0 },
    { vencimento: "2026-09-07", saldo: 220.0 },
    { vencimento: "2026-10-05", saldo: 1775.95 },
    { vencimento: "2026-10-05", saldo: 550.0 },
    { vencimento: "2026-10-05", saldo: 220.0 },
    { vencimento: "2026-10-05", saldo: 220.0 },
    { vencimento: "2026-11-05", saldo: 1775.95 },
    { vencimento: "2026-11-05", saldo: 550.0 },
    { vencimento: "2026-11-05", saldo: 220.0 },
    { vencimento: "2026-11-05", saldo: 220.0 },
    { vencimento: "2026-12-07", saldo: 1775.95 },
    { vencimento: "2026-12-07", saldo: 550.0 },
    { vencimento: "2026-12-07", saldo: 220.0 },
    { vencimento: "2026-12-07", saldo: 220.0 },
  ];
  const planoCompleto = [...vencidas, ...futuras];

  it("soma bruta das vencidas ≈ R$ 16.102,31 (bate com o relatório Contas a Receber do Sponte)", () => {
    const v = parcelasVencidas(planoCompleto, HOJE);
    expect(v).toHaveLength(25);
    expect(v.reduce((s, b) => s + b.saldo, 0)).toBeCloseTo(16102.31, 2);
  });

  it("total corrigido descarta as 17 futuras (não é R$ 28.105,60)", () => {
    // Só vencidas == plano completo, provando que as futuras não entram.
    expect(calcularTotalVencido(planoCompleto, HOJE)).toBeCloseTo(
      calcularTotalVencido(vencidas, HOJE),
      2,
    );
    // E o total (com juros) fica bem abaixo do valor errado que somava tudo.
    expect(calcularTotalVencido(planoCompleto, HOJE)).toBeLessThan(28105.6);
  });
});
