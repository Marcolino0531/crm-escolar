import { describe, it, expect } from "vitest";
import {
  formatarCompetencia,
  mensagemCategorizacao,
  mensagemConciliacao,
  pendenciasCategorizacao,
  pendenciasConciliacao,
  type TransacaoPendencia,
} from "./financeiro-pendencias";

function tx(over: Partial<TransacaoPendencia> & { id: string }): TransacaoPendencia {
  return {
    school_id: "cec",
    date: "2026-08-05",
    type: "entrada",
    cost_center_id: null,
    revenue_category_id: null,
    parent_transaction_id: null,
    description: "PIX RECEBIDO",
    amount: 1000,
    ...over,
  };
}

describe("pendenciasCategorizacao", () => {
  it("agrupa várias transações sem categoria em um único aviso por colégio/mês", () => {
    const pend = pendenciasCategorizacao([
      tx({ id: "1" }),
      tx({ id: "2", date: "2026-08-20" }),
      tx({ id: "3", type: "saida", date: "2026-08-25" }),
    ]);
    expect(pend).toEqual([{ schoolId: "cec", monthKey: "2026-08" }]);
  });

  it("separa avisos por colégio e por mês", () => {
    const pend = pendenciasCategorizacao([
      tx({ id: "1" }),
      tx({ id: "2", school_id: "cec-baby" }),
      tx({ id: "3", date: "2026-07-10" }),
    ]);
    expect(pend).toEqual([
      { schoolId: "cec", monthKey: "2026-08" },
      { schoolId: "cec-baby", monthKey: "2026-08" },
      { schoolId: "cec", monthKey: "2026-07" },
    ]);
  });

  it("não gera aviso quando tudo está categorizado", () => {
    const pend = pendenciasCategorizacao([
      tx({ id: "1", revenue_category_id: "rc1" }),
      tx({ id: "2", type: "saida", cost_center_id: "cc1" }),
    ]);
    expect(pend).toEqual([]);
  });

  it("categoria de receita não vale para saída (e vice-versa)", () => {
    const pend = pendenciasCategorizacao([
      tx({ id: "1", type: "saida", revenue_category_id: "rc1" }),
    ]);
    expect(pend).toEqual([{ schoolId: "cec", monthKey: "2026-08" }]);
  });

  it("ignora o lançamento-pai desmembrado e cobra apenas as filhas", () => {
    const semPendencia = pendenciasCategorizacao([
      tx({ id: "pai" }),
      tx({ id: "f1", parent_transaction_id: "pai", revenue_category_id: "rc1" }),
      tx({ id: "f2", parent_transaction_id: "pai", revenue_category_id: "rc2" }),
    ]);
    expect(semPendencia).toEqual([]);

    const comPendencia = pendenciasCategorizacao([
      tx({ id: "pai" }),
      tx({ id: "f1", parent_transaction_id: "pai" }),
    ]);
    expect(comPendencia).toEqual([{ schoolId: "cec", monthKey: "2026-08" }]);
  });

  it("o aviso some quando a última transação do mês é categorizada", () => {
    const antes = [tx({ id: "1", revenue_category_id: "rc1" }), tx({ id: "2" })];
    expect(pendenciasCategorizacao(antes)).toHaveLength(1);

    const depois = antes.map((t) => ({ ...t, revenue_category_id: "rc1" }));
    expect(pendenciasCategorizacao(depois)).toEqual([]);
  });
});

describe("pendenciasConciliacao", () => {
  it("agrupa várias linhas pendentes em um único aviso por colégio/mês", () => {
    const pend = pendenciasConciliacao(
      [tx({ id: "1" }), tx({ id: "2", date: "2026-08-18" }), tx({ id: "3", date: "2026-08-30" })],
      [],
    );
    expect(pend).toEqual([{ schoolId: "cec", monthKey: "2026-08" }]);
  });

  it("não gera aviso quando todas as linhas do mês estão conciliadas", () => {
    const pend = pendenciasConciliacao([tx({ id: "1" }), tx({ id: "2" })], ["1", "2"]);
    expect(pend).toEqual([]);
  });

  it("mantém o aviso enquanto sobrar ao menos uma linha pendente", () => {
    const pend = pendenciasConciliacao([tx({ id: "1" }), tx({ id: "2" })], ["1"]);
    expect(pend).toEqual([{ schoolId: "cec", monthKey: "2026-08" }]);
  });

  it("ignora saídas, filhas de desmembramento, SALDO DIA e centavos de controle", () => {
    const pend = pendenciasConciliacao(
      [
        tx({ id: "1", type: "saida" }),
        tx({ id: "2", parent_transaction_id: "1" }),
        tx({ id: "3", description: "SALDO DIA" }),
        tx({ id: "4", amount: 1 }),
      ],
      [],
    );
    expect(pend).toEqual([]);
  });

  it("trata os colégios de forma independente", () => {
    const pend = pendenciasConciliacao(
      [tx({ id: "1" }), tx({ id: "2", school_id: "belvedere" })],
      ["1"],
    );
    expect(pend).toEqual([{ schoolId: "belvedere", monthKey: "2026-08" }]);
  });
});

describe("mensagens", () => {
  it("formata a competência em mês/ano", () => {
    expect(formatarCompetencia("2026-08")).toBe("agosto/2026");
  });

  it("usa o texto pedido para cada tipo de aviso", () => {
    expect(mensagemCategorizacao("CEC Baby", "2026-08")).toBe(
      "Colégio CEC Baby possui transação no extrato bancário do mês agosto/2026 sem categorização.",
    );
    expect(mensagemConciliacao("Núcleo de Ensino Belvedere", "2026-09")).toBe(
      "Colégio Núcleo de Ensino Belvedere possui faturamento do mês setembro/2026 sem conciliação.",
    );
  });
});
