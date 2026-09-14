import { describe, it, expect } from "vitest";
import {
  idsDePaisDesmembrados,
  saldosDoPeriodo,
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

describe("saldosDoPeriodo (cards do Extrato e do Dashboard)", () => {
  const historico: ExtratoTx[] = [
    tx({ id: "jul-e", date: "2026-07-05", type: "entrada", amount: 1000 }),
    tx({ id: "jul-s", date: "2026-07-20", type: "saida", amount: 300 }),
    tx({ id: "ago-e1", date: "2026-08-02", type: "entrada", amount: 500 }),
    tx({ id: "ago-e2", date: "2026-08-10", type: "entrada", amount: 250.5 }),
    tx({ id: "ago-s", date: "2026-08-15", type: "saida", amount: 100 }),
    tx({ id: "set-e", date: "2026-09-01", type: "entrada", amount: 9999 }),
  ];

  it("soma entradas e saídas só do período e fecha o saldo final", () => {
    const r = saldosDoPeriodo(historico, "2026-08-01", "2026-08-31", 0);
    expect(r.entradas).toBe(750.5);
    expect(r.saidas).toBe(100);
    expect(r.saldoFinal).toBe(r.saldoInicial + 750.5 - 100);
  });

  it("saldo inicial vem das transações anteriores quando existem (ignora o manual)", () => {
    const r = saldosDoPeriodo(historico, "2026-08-01", "2026-08-31", 55555);
    expect(r.saldoInicial).toBe(700);
    expect(r.saldoFinal).toBe(1350.5);
  });

  it("saldo inicial manual (initial_balances) só quando não há transação anterior", () => {
    const r = saldosDoPeriodo(historico, "2026-07-01", "2026-07-31", 2500);
    expect(r.saldoInicial).toBe(2500);
    expect(r.entradas).toBe(1000);
    expect(r.saidas).toBe(300);
    expect(r.saldoFinal).toBe(3200);
    expect(saldosDoPeriodo(historico, "2026-07-01", "2026-07-31", null).saldoInicial).toBe(0);
  });

  it("transação-pai desmembrada não entra nem no período nem no saldo anterior", () => {
    const comSplit: ExtratoTx[] = [
      ...historico,
      tx({ id: "pai-jul", date: "2026-07-25", type: "saida", amount: 200 }),
      tx({
        id: "f1",
        date: "2026-07-25",
        type: "saida",
        amount: 200,
        parent_transaction_id: "pai-jul",
      }),
      tx({ id: "pai-ago", date: "2026-08-20", type: "saida", amount: 80 }),
      tx({
        id: "f2",
        date: "2026-08-20",
        type: "saida",
        amount: 50,
        parent_transaction_id: "pai-ago",
      }),
      tx({
        id: "f3",
        date: "2026-08-20",
        type: "saida",
        amount: 30,
        parent_transaction_id: "pai-ago",
      }),
    ];
    const r = saldosDoPeriodo(comSplit, "2026-08-01", "2026-08-31", 0);
    expect(r.saldoInicial).toBe(500);
    expect(r.saidas).toBe(180);
  });

  it("é a mesma conta do Extrato: replica startingBalance/totalIn/totalOut/finalBalance", () => {
    // Fórmula que o Extrato Bancário exibia antes da extração.
    const start = "2026-08-01";
    const end = "2026-08-31";
    const pais = idsDePaisDesmembrados(historico);
    const filtered = transacoesDoPeriodo(historico, start, end, pais);
    const prior = transacoesAnteriores(historico, start, pais);
    const totalIn = filtered.filter((t) => t.type === "entrada").reduce((s, t) => s + t.amount, 0);
    const totalOut = filtered.filter((t) => t.type === "saida").reduce((s, t) => s + t.amount, 0);
    const carry = prior.reduce((s, t) => s + (t.type === "entrada" ? t.amount : -t.amount), 0);
    const starting = prior.length > 0 ? carry : 0;
    expect(saldosDoPeriodo(historico, start, end, 0)).toEqual({
      saldoInicial: starting,
      entradas: totalIn,
      saidas: totalOut,
      saldoFinal: starting + totalIn - totalOut,
    });
  });
});
