import { describe, it, expect } from "vitest";
import {
  idsDePaisDesmembrados,
  transacoesAnteriores,
  transacoesDoPeriodo,
  type ExtratoTx,
} from "./extrato-lista";

function tx(over: Partial<ExtratoTx> & { id: string }): ExtratoTx {
  return {
    date: "2026-08-24",
    type: "entrada",
    amount: 100,
    description: "Lançamento",
    parent_transaction_id: null,
    ...over,
  };
}

describe("transacoesDoPeriodo", () => {
  it("mostra todas as transações do mesmo dia, sem teto de linhas", () => {
    // Caso real: 24/08/2026 tinha 21 lançamentos no CEC e a tela exibia 1.
    const doDia = Array.from({ length: 21 }, (_, i) =>
      tx({ id: `dia-${String(i).padStart(2, "0")}`, description: `Boleto ${i}` }),
    );
    const lista = transacoesDoPeriodo(doDia, "2026-08-01", "2026-08-31");
    expect(lista).toHaveLength(21);
    expect(new Set(lista.map((t) => t.id)).size).toBe(21);
  });

  it("não perde nenhum lançamento de um mês com volume alto", () => {
    const mes = Array.from({ length: 1500 }, (_, i) =>
      tx({
        id: `tx-${String(i).padStart(5, "0")}`,
        date: `2026-08-${String((i % 31) + 1).padStart(2, "0")}`,
      }),
    );
    expect(transacoesDoPeriodo(mes, "2026-08-01", "2026-08-31")).toHaveLength(1500);
  });

  it("inclui os lançamentos do primeiro e do último dia do período", () => {
    const txs = [
      tx({ id: "a", date: "2026-08-01" }),
      tx({ id: "b", date: "2026-08-31" }),
      tx({ id: "c", date: "2026-07-31" }),
      tx({ id: "d", date: "2026-09-01" }),
    ];
    expect(transacoesDoPeriodo(txs, "2026-08-01", "2026-08-31").map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("oculta apenas o lançamento-pai desmembrado, mantendo as filhas", () => {
    const txs = [
      tx({ id: "pai", amount: 300 }),
      tx({ id: "filha-1", amount: 200, parent_transaction_id: "pai" }),
      tx({ id: "filha-2", amount: 100, parent_transaction_id: "pai" }),
      tx({ id: "solto", amount: 50 }),
    ];
    const ids = transacoesDoPeriodo(txs, "2026-08-01", "2026-08-31").map((t) => t.id);
    expect(ids).not.toContain("pai");
    expect(ids).toEqual(expect.arrayContaining(["filha-1", "filha-2", "solto"]));
    expect(idsDePaisDesmembrados(txs)).toEqual(new Set(["pai"]));
  });

  it("ordena por data, entradas antes de saídas e depois pela descrição", () => {
    const txs = [
      tx({ id: "1", date: "2026-08-25", type: "saida", description: "Zebra" }),
      tx({ id: "2", date: "2026-08-24", type: "saida", description: "Aluguel" }),
      tx({ id: "3", date: "2026-08-24", type: "entrada", description: "Boleto B" }),
      tx({ id: "4", date: "2026-08-24", type: "entrada", description: "Boleto A" }),
    ];
    expect(transacoesDoPeriodo(txs, "2026-08-01", "2026-08-31").map((t) => t.id)).toEqual([
      "4",
      "3",
      "2",
      "1",
    ]);
  });
});

describe("transacoesAnteriores", () => {
  it("pega todos os lançamentos antes do período (base do saldo inicial)", () => {
    const txs = [
      tx({ id: "antes-1", date: "2026-07-30" }),
      tx({ id: "antes-2", date: "2026-06-01" }),
      tx({ id: "no-periodo", date: "2026-08-05" }),
      tx({ id: "pai", date: "2026-07-01" }),
      tx({ id: "filha", date: "2026-07-01", parent_transaction_id: "pai" }),
    ];
    const ids = transacoesAnteriores(txs, "2026-08-01").map((t) => t.id);
    expect(ids).toEqual(["antes-2", "filha", "antes-1"]);
  });
});
