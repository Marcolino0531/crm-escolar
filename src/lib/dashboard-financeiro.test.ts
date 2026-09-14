import { describe, it, expect } from "vitest";
import {
  despesaPorCentroCusto,
  fechamentoMensal,
  fechamentoPorUnidade,
  resolverIdsFinanceiros,
  serieAnualInvestimentos,
  SEM_CENTRO_CUSTO,
  type IdsFinanceiros,
  type TransacaoFinanceira,
} from "./dashboard-financeiro";

const IDS: IdsFinanceiros = {
  resgateInvestimento: "rc-resgate",
  aporteInvestimento: "cc-aporte-inv",
  transferenciaRecebida: "rc-aporte-fin",
  transferenciaEnviada: "cc-aporte-fin",
};

const CC_PESSOAL = "cc-pessoal";
const CC_OPERACIONAL = "cc-operacional";
const RC_FATURAMENTO = "rc-faturamento";

let seq = 0;
function tx(over: Partial<TransacaoFinanceira>): TransacaoFinanceira {
  seq += 1;
  return {
    id: `t${seq}`,
    school_id: "cec",
    date: "2026-09-10",
    type: "entrada",
    amount: 100,
    cost_center_id: null,
    revenue_category_id: RC_FATURAMENTO,
    parent_transaction_id: null,
    ...over,
  };
}
function saida(over: Partial<TransacaoFinanceira>): TransacaoFinanceira {
  return tx({ type: "saida", revenue_category_id: null, cost_center_id: CC_PESSOAL, ...over });
}

describe("resolverIdsFinanceiros", () => {
  it("resolve pelos nomes exatos de produção (receita e centro de custo separados)", () => {
    const ids = resolverIdsFinanceiros(
      [
        { id: "r1", name: "Faturamento" },
        { id: "r2", name: "Aporte Financeiro" },
        { id: "r3", name: "Resgate Fundo de Investimento" },
      ],
      [
        { id: "c1", name: "Aporte Financeiro" },
        { id: "c2", name: "Aporte em Investimento" },
        { id: "c3", name: "Pessoal" },
      ],
    );
    expect(ids).toEqual({
      resgateInvestimento: "r3",
      aporteInvestimento: "c2",
      transferenciaRecebida: "r2",
      transferenciaEnviada: "c1",
    });
  });

  it("devolve null quando o registro não existe (nunca casa por aproximação)", () => {
    const ids = resolverIdsFinanceiros([{ id: "r1", name: "Faturamento" }], []);
    expect(ids.resgateInvestimento).toBeNull();
    expect(ids.aporteInvestimento).toBeNull();
  });
});

describe("fechamentoMensal — Receita e Despesa", () => {
  it("Receita exclui Resgate de Investimento e Aporte Recebido de Outra Unidade", () => {
    const r = fechamentoMensal(
      [
        tx({ amount: 1000 }),
        tx({ amount: 500 }),
        tx({ amount: 80000, revenue_category_id: IDS.resgateInvestimento }),
        tx({ amount: 40000, revenue_category_id: IDS.transferenciaRecebida }),
      ],
      IDS,
    );
    expect(r.receita).toBe(1500);
    expect(r.resgatadoFundo).toBe(80000);
    expect(r.recebidoOutras).toBe(40000);
  });

  it("Despesa exclui Aporte em Investimento e Aporte Enviado a Outra Unidade", () => {
    const r = fechamentoMensal(
      [
        saida({ amount: 300 }),
        saida({ amount: 200, cost_center_id: CC_OPERACIONAL }),
        saida({ amount: 25000, cost_center_id: IDS.aporteInvestimento }),
        saida({ amount: 38533.34, cost_center_id: IDS.transferenciaEnviada }),
      ],
      IDS,
    );
    expect(r.despesa).toBe(500);
    expect(r.aportadoFundo).toBe(25000);
    expect(r.enviadoOutras).toBeCloseTo(38533.34, 2);
  });

  it("transação-pai desmembrada não entra em nenhum total (só as filhas)", () => {
    const r = fechamentoMensal(
      [
        saida({ id: "pai", amount: 1000, cost_center_id: null }),
        saida({ amount: 600, parent_transaction_id: "pai" }),
        saida({ amount: 400, parent_transaction_id: "pai", cost_center_id: CC_OPERACIONAL }),
        tx({ id: "pai-e", amount: 300, revenue_category_id: null }),
        tx({ amount: 300, parent_transaction_id: "pai-e" }),
      ],
      IDS,
    );
    expect(r.despesa).toBe(1000);
    expect(r.receita).toBe(300);
    // pais sem categoria não contam como pendência: quem categoriza são as filhas
    expect(r.semCategoria).toBe(0);
  });

  it("Resultado = Receita − Despesa, positivo e negativo", () => {
    expect(fechamentoMensal([tx({ amount: 900 }), saida({ amount: 400 })], IDS).resultado).toBe(
      500,
    );
    expect(fechamentoMensal([tx({ amount: 100 }), saida({ amount: 250 })], IDS).resultado).toBe(
      -150,
    );
  });

  it("conta transações sem categoria (entrada sem receita, saída sem centro)", () => {
    const r = fechamentoMensal(
      [tx({ revenue_category_id: null }), saida({ cost_center_id: null }), tx({}), saida({})],
      IDS,
    );
    expect(r.semCategoria).toBe(2);
    // sem categoria ainda é receita/despesa operacional (não é fundo nem transferência)
    expect(r.receita).toBe(200);
    expect(r.despesa).toBe(200);
  });

  it("investimentos e transferências somam à parte e não vazam para Receita/Despesa", () => {
    const r = fechamentoMensal(
      [
        tx({ amount: 5000 }),
        saida({ amount: 2000 }),
        saida({ amount: 10000, cost_center_id: IDS.aporteInvestimento }),
        tx({ amount: 7000, revenue_category_id: IDS.resgateInvestimento }),
        saida({ amount: 3000, cost_center_id: IDS.transferenciaEnviada }),
        tx({ amount: 1200, revenue_category_id: IDS.transferenciaRecebida }),
      ],
      IDS,
    );
    expect(r).toMatchObject({
      receita: 5000,
      despesa: 2000,
      resultado: 3000,
      aportadoFundo: 10000,
      resgatadoFundo: 7000,
      enviadoOutras: 3000,
      recebidoOutras: 1200,
      saldoTransferencias: -1800,
    });
  });

  it("sem o centro 'Aporte em Investimento' cadastrado (id null), nenhuma saída é tratada como aporte", () => {
    const r = fechamentoMensal([saida({ amount: 100, cost_center_id: null })], {
      ...IDS,
      aporteInvestimento: null,
    });
    expect(r.aportadoFundo).toBe(0);
    expect(r.despesa).toBe(100);
  });
});

describe("despesaPorCentroCusto", () => {
  it("agrupa a despesa operacional por centro, excluindo aporte, transferência e pai desmembrado", () => {
    const nomes = new Map([
      [CC_PESSOAL, "Pessoal"],
      [CC_OPERACIONAL, "Operacional"],
    ]);
    const fatias = despesaPorCentroCusto(
      [
        saida({ amount: 300 }),
        saida({ amount: 200 }),
        saida({ amount: 100, cost_center_id: CC_OPERACIONAL }),
        saida({ amount: 50, cost_center_id: null }),
        saida({ amount: 9999, cost_center_id: IDS.aporteInvestimento }),
        saida({ amount: 9999, cost_center_id: IDS.transferenciaEnviada }),
        saida({ id: "pai", amount: 9999 }),
        saida({ amount: 10, parent_transaction_id: "pai", cost_center_id: CC_OPERACIONAL }),
        tx({ amount: 9999 }),
      ],
      IDS,
      nomes,
    );
    expect(fatias).toEqual([
      { id: CC_PESSOAL, name: "Pessoal", value: 500 },
      { id: CC_OPERACIONAL, name: "Operacional", value: 110 },
      { id: null, name: SEM_CENTRO_CUSTO, value: 50 },
    ]);
  });
});

describe("fechamentoPorUnidade", () => {
  const UNIDADES = [
    { id: "cec", name: "CEC" },
    { id: "baby", name: "CEC Baby" },
    { id: "vale", name: "Núcleo Vale do Sereno" },
    { id: "belv", name: "Núcleo Belvedere" },
  ];

  it("soma por unidade e mostra zero (não erro) para unidade sem transações", () => {
    const linhas = fechamentoPorUnidade(
      [
        tx({ school_id: "cec", amount: 1000 }),
        saida({ school_id: "cec", amount: 400 }),
        tx({ school_id: "vale", amount: 200 }),
        tx({ school_id: "vale", amount: 5000, revenue_category_id: IDS.transferenciaRecebida }),
        saida({ school_id: "belv", amount: 5000, cost_center_id: IDS.transferenciaEnviada }),
        saida({ school_id: "belv", amount: 300 }),
      ],
      IDS,
      UNIDADES,
    );
    expect(linhas.map((l) => l.schoolName)).toEqual([
      "CEC",
      "CEC Baby",
      "Núcleo Vale do Sereno",
      "Núcleo Belvedere",
    ]);
    expect(linhas[0]).toMatchObject({ receita: 1000, despesa: 400, resultado: 600 });
    expect(linhas[1]).toMatchObject({
      receita: 0,
      despesa: 0,
      resultado: 0,
      enviadoOutras: 0,
      recebidoOutras: 0,
    });
    expect(linhas[2]).toMatchObject({ receita: 200, resultado: 200, recebidoOutras: 5000 });
    expect(linhas[3]).toMatchObject({ despesa: 300, resultado: -300, enviadoOutras: 5000 });
  });
});

describe("serieAnualInvestimentos", () => {
  const FUNDOS = [
    { id: "f-cec-1", school_id: "cec" },
    { id: "f-cec-2", school_id: "cec" },
    { id: "f-belv", school_id: "belv" },
  ];
  const ENTRADAS = [
    { fund_id: "f-cec-1", competencia: "2026-07-01", aportes: 1000, resgates: 500 },
    { fund_id: "f-cec-2", competencia: "2026-07-01", aportes: 250, resgates: 100 },
    { fund_id: "f-belv", competencia: "2026-07-01", aportes: 0, resgates: 100000 },
    { fund_id: "f-cec-1", competencia: "2026-08-01", aportes: null, resgates: 118665.66 },
    { fund_id: "f-cec-1", competencia: "2025-12-01", aportes: 9999, resgates: 9999 },
  ];

  it("soma mais de um fundo da mesma unidade na mesma competência", () => {
    const serie = serieAnualInvestimentos(ENTRADAS, FUNDOS, ["cec"], 2026);
    expect(serie).toHaveLength(12);
    expect(serie[6]).toMatchObject({ mes: "jul", aportes: 1250, resgates: 600 });
    expect(serie[7]).toMatchObject({ mes: "ago", aportes: 0, resgates: 118665.66 });
    expect(serie[0]).toMatchObject({ mes: "jan", aportes: 0, resgates: 0 });
  });

  it("'Todas as Unidades' soma todos os fundos; ano diferente fica fora", () => {
    const serie = serieAnualInvestimentos(ENTRADAS, FUNDOS, null, 2026);
    expect(serie[6]).toMatchObject({ aportes: 1250, resgates: 100600 });
    expect(serie[11]).toMatchObject({ mes: "dez", aportes: 0, resgates: 0 });
  });

  it("unidade sem fundo cadastrado sai zerada nos 12 meses", () => {
    const serie = serieAnualInvestimentos(ENTRADAS, FUNDOS, ["baby"], 2026);
    expect(serie.every((p) => p.aportes === 0 && p.resgates === 0)).toBe(true);
  });
});
