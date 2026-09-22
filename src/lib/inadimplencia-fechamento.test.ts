import { describe, expect, it } from "vitest";
import { IDS_VAZIOS, type IdsFinanceiros } from "./dashboard-financeiro";
import { faturamentoRecebido, type ReceitaExtrato } from "./inadimplencia-faturamento";
import {
  arredondarReais,
  avisosFechamentoPendente,
  deveAvisarFechamento,
  faturamentoAcumulado,
  formatarPercentual,
  inadimplenteLiquido,
  janelaAcumulada,
  janelaMes,
  mesesFechaveis,
  mesesPendentes,
  percentualInadimplencia,
  podeFecharMes,
  resumoMesPorUnidade,
  serieInadimplencia,
  textoAvisoFechamento,
  ultimoFechamento,
  type FechamentoRow,
} from "./inadimplencia-fechamento";

const ids: IdsFinanceiros = {
  ...IDS_VAZIOS,
  resgateInvestimento: "cat-resgate",
  transferenciaRecebida: "cat-aporte",
};

describe("desconto de Acordo (item a item)", () => {
  it("boleto misto soma só a parte fora do Acordo; boleto 100% Acordo contribui zero", () => {
    const r = inadimplenteLiquido([
      { valorTotalBoleto: 1500, valorAcordo: 500 }, // Mensalidade 1000 + Acordo 500
      { valorTotalBoleto: 800, valorAcordo: 800 }, // só Acordo
      { valorTotalBoleto: 1200.5, valorAcordo: 0 },
    ]);
    expect(r.total).toBe(2200.5);
    expect(r.boletos).toBe(2);
  });

  it("paridade: mesmo valor que o reduce de fetchSponteInadimplenciaAnual", () => {
    const pend = [
      { valorTotalBoleto: 1234.56, valorAcordo: 234.56 },
      { valorTotalBoleto: 999.99, valorAcordo: 0 },
      { valorTotalBoleto: 300, valorAcordo: 300 },
    ];
    // Cópia literal da regra do card atual (sponte.functions.ts).
    const totalCard =
      Math.round(pend.reduce((sum, p) => sum + (p.valorTotalBoleto - p.valorAcordo), 0) * 100) /
      100;
    const boletosCard = pend.filter((p) => p.valorTotalBoleto - p.valorAcordo > 0.005).length;
    const r = inadimplenteLiquido(pend);
    expect(r.total).toBe(totalCard);
    expect(r.boletos).toBe(boletosCard);
  });
});

describe("percentuais", () => {
  it("mensal e acumulado com valores conhecidos, 1 casa decimal na exibição", () => {
    const p = percentualInadimplencia(12345.67, 308641.75);
    expect(p).toBeCloseTo(4.0, 1);
    expect(formatarPercentual(p)).toBe("4,0%");
    expect(formatarPercentual(percentualInadimplencia(25000, 400000))).toBe("6,3%");
  });

  it("faturamento zero retorna null, sem divisão", () => {
    expect(percentualInadimplencia(1000, 0)).toBeNull();
    expect(formatarPercentual(null)).toBe("sem faturamento");
  });

  it("paridade com a fórmula do card atual quando há faturamento", () => {
    const inad = 54321.09;
    const fat = 987654.32;
    const card = fat > 0 ? (inad / fat) * 100 : 0;
    expect(percentualInadimplencia(inad, fat)).toBe(card);
  });
});

describe("arredondamento em R$", () => {
  it("2 casas antes de gravar", () => {
    expect(arredondarReais(0.1 + 0.2)).toBe(0.3);
    expect(arredondarReais(1234.5678)).toBe(1234.57);
    expect(arredondarReais(10.005)).toBe(10.01);
  });
});

describe("janelas", () => {
  it("mês: 01 → último dia (inclusive fevereiro bissexto)", () => {
    expect(janelaMes("2026-09")).toEqual({ inicioYMD: "2026-09-01", fimYMD: "2026-09-30" });
    expect(janelaMes("2028-02").fimYMD).toBe("2028-02-29");
  });

  it("acumulada em 2026: 01/01 → fim do mês, extrato desde 01/06 com retroativo", () => {
    const j = janelaAcumulada("2026-09");
    expect(j).toMatchObject({
      inicioYMD: "2026-01-01",
      fimYMD: "2026-09-30",
      receitasDesdeYMD: "2026-06-01",
      usaRetroativo: true,
    });
  });

  it("acumulada em 2027: extrato do ano inteiro, sem retroativo", () => {
    const j = janelaAcumulada("2027-03");
    expect(j).toMatchObject({
      inicioYMD: "2027-01-01",
      fimYMD: "2027-03-31",
      receitasDesdeYMD: "2027-01-01",
      usaRetroativo: false,
    });
  });
});

describe("faturamento acumulado", () => {
  const receitasDesdeJunho: ReceitaExtrato[] = [
    { amount: 100000, description: "COB COMPE", revenue_category_id: "cat-mensal" },
    { amount: 50000, description: "PIX RECEBIDO", revenue_category_id: null },
    { amount: 1, description: "PLACEHOLDER", revenue_category_id: "cat-mensal" },
    { amount: 77777, description: "SALDO DIA", revenue_category_id: null },
    { amount: 30000, description: "RESGATE FUNDO", revenue_category_id: "cat-resgate" },
    { amount: 20000, description: "APORTE CEC BABY", revenue_category_id: "cat-aporte" },
  ];

  it("= retroativo Jan–Mai + receitas de 01/06 ao fim do mês, com as exclusões", () => {
    expect(faturamentoAcumulado(158641.75, true, receitasDesdeJunho, ids)).toBe(158641.75 + 150000);
    // Mesmo denominador do card atual: retroativo + faturamentoRecebido.
    expect(faturamentoAcumulado(158641.75, true, receitasDesdeJunho, ids)).toBe(
      158641.75 + faturamentoRecebido(receitasDesdeJunho, ids),
    );
  });

  it("ano sem retroativo ignora o valor configurado", () => {
    expect(faturamentoAcumulado(158641.75, false, receitasDesdeJunho, ids)).toBe(150000);
  });
});

// ── Consolidado ─────────────────────────────────────────────────────────────

const U = ["cec", "baby", "belv", "vale"];

function row(school_id: string, ano_mes: string, v: Partial<FechamentoRow> = {}): FechamentoRow {
  return {
    school_id,
    ano_mes,
    inadimplente_mes: 0,
    faturamento_mes: 0,
    inadimplente_acumulado: 0,
    faturamento_acumulado: 0,
    boletos_mes: 0,
    boletos_acumulado: 0,
    fechado_por: "u1",
    fechado_em: "2026-10-02T12:00:00.000Z",
    ...v,
  };
}

describe("consolidado com as 4 unidades", () => {
  const rows = [
    row("cec", "2026-09", { inadimplente_mes: 10000, faturamento_mes: 100000 }), // 10%
    row("baby", "2026-09", { inadimplente_mes: 1000, faturamento_mes: 50000 }), // 2%
    row("belv", "2026-09", { inadimplente_mes: 3000, faturamento_mes: 30000 }), // 10%
    row("vale", "2026-09", { inadimplente_mes: 400, faturamento_mes: 20000 }), // 2%
  ];

  it("soma os R$ e calcula o % sobre as somas (≠ média simples dos %)", () => {
    const { pontos, parciais } = serieInadimplencia(rows, U);
    expect(parciais).toEqual([]);
    expect(pontos).toHaveLength(1);
    expect(pontos[0].inadimplenteMes).toBe(14400);
    expect(pontos[0].faturamentoMes).toBe(200000);
    expect(pontos[0].mensal).toBeCloseTo(7.2, 6);
    const mediaSimples = (10 + 2 + 10 + 2) / 4; // 6%
    expect(pontos[0].mensal).not.toBeCloseTo(mediaSimples, 6);
    expect(pontos[0].month).toBe("09/26");
  });

  it("acumulado com faturamento zero vira null, sem quebrar", () => {
    const { pontos } = serieInadimplencia(rows, U);
    expect(pontos[0].acumulada).toBeNull();
  });
});

describe("consolidado incompleto", () => {
  it("2 ou 3 unidades fechadas: sem ponto, mês vai para parcial com as faltantes", () => {
    const rows = [
      row("cec", "2026-09", { inadimplente_mes: 1, faturamento_mes: 10 }),
      row("baby", "2026-09", { inadimplente_mes: 1, faturamento_mes: 10 }),
      row("cec", "2026-10", { inadimplente_mes: 1, faturamento_mes: 10 }),
      row("baby", "2026-10", { inadimplente_mes: 1, faturamento_mes: 10 }),
      row("belv", "2026-10", { inadimplente_mes: 1, faturamento_mes: 10 }),
    ];
    const s = serieInadimplencia(rows, U);
    expect(s.pontos).toEqual([]);
    expect(s.parciais).toEqual([
      { anoMes: "2026-09", faltam: ["belv", "vale"] },
      { anoMes: "2026-10", faltam: ["vale"] },
    ]);
    expect(ultimoFechamento(s)).toBeNull();
  });

  it("visão de uma unidade plota os meses dela, ignorando as demais", () => {
    const rows = [
      row("belv", "2026-09", { inadimplente_mes: 5, faturamento_mes: 100 }),
      row("belv", "2026-10", { inadimplente_mes: 8, faturamento_mes: 100 }),
      row("cec", "2026-10", { inadimplente_mes: 99, faturamento_mes: 100 }),
    ];
    const s = serieInadimplencia(rows, ["belv"]);
    expect(s.pontos.map((p) => [p.anoMes, p.mensal])).toEqual([
      ["2026-09", 5],
      ["2026-10", 8],
    ]);
    expect(ultimoFechamento(s)?.anoMes).toBe("2026-10");
  });

  it("resumo do mês por unidade", () => {
    const rows = [row("cec", "2026-09"), row("baby", "2026-09")];
    const unidades = [
      { id: "cec", name: "CEC" },
      { id: "baby", name: "CEC Baby" },
      { id: "belv", name: "Núcleo Belvedere" },
      { id: "vale", name: "Núcleo Vale do Sereno" },
    ];
    expect(resumoMesPorUnidade(rows, "2026-09", unidades)).toBe(
      "Setembro/2026: CEC fechado em 02/10, CEC Baby fechado em 02/10, Núcleo Belvedere pendente, Núcleo Vale do Sereno pendente",
    );
  });
});

// ── Calendário e meses pendentes ────────────────────────────────────────────

describe("meses fecháveis e pendentes", () => {
  it("de 2026-09 até o mês anterior; nada antes de 2026-09", () => {
    expect(mesesFechaveis(new Date(2026, 9, 15))).toEqual(["2026-09"]);
    expect(mesesFechaveis(new Date(2027, 0, 1))).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(mesesFechaveis(new Date(2026, 8, 30))).toEqual([]);
  });

  it("trava: mês atual, futuro e anterior a 2026-09 não fecham", () => {
    const hoje = new Date(2026, 9, 2);
    expect(podeFecharMes("2026-09", hoje)).toEqual({ ok: true });
    expect(podeFecharMes("2026-10", hoje).ok).toBe(false);
    expect(podeFecharMes("2026-08", hoje).ok).toBe(false);
    expect(podeFecharMes("2026-13", hoje).ok).toBe(false);
  });

  it("pendentes: por unidade, excluindo os já fechados", () => {
    const hoje = new Date(2026, 10, 5); // novembro → set e out fecháveis
    const p = mesesPendentes([row("cec", "2026-09"), row("cec", "2026-10")], ["cec", "belv"], hoje);
    expect(p).toEqual([
      { school_id: "belv", ano_mes: "2026-09" },
      { school_id: "belv", ano_mes: "2026-10" },
    ]);
  });

  it("regra do dia 02: dia 01 sem aviso, dia 02 com aviso", () => {
    expect(deveAvisarFechamento(new Date(2026, 9, 1))).toBe(false);
    expect(deveAvisarFechamento(new Date(2026, 9, 2))).toBe(true);
    const pend = [{ school_id: "belv", ano_mes: "2026-09" }];
    const nome = () => "Núcleo Belvedere";
    expect(avisosFechamentoPendente(pend, nome, new Date(2026, 9, 1))).toEqual([]);
    expect(avisosFechamentoPendente(pend, nome, new Date(2026, 9, 2))).toEqual([
      {
        school_id: "belv",
        ano_mes: "2026-09",
        texto: "Inadimplência de Setembro/2026 ainda não fechada: Núcleo Belvedere",
      },
    ]);
  });

  it("texto do aviso", () => {
    expect(textoAvisoFechamento("2026-12", "CEC")).toBe(
      "Inadimplência de Dezembro/2026 ainda não fechada: CEC",
    );
  });
});
