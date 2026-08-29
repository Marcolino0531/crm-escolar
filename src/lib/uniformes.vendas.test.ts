import { describe, expect, it } from "vitest";
import {
  agregaVendas,
  agregaVendasPorPeriodo,
  anoBRT,
  dataDaVenda,
  vendaDoAno,
  vendaNoPeriodo,
  type CatalogoVariacoes,
  type PedidoVenda,
} from "./uniformes.vendas";

const catalogo: CatalogoVariacoes = {
  tamanhoPorVariacao: new Map([
    ["cec:100", "8"],
    ["cec:101", "10"],
    ["belvedere:200", "M"],
  ]),
  nomePorProduto: new Map([
    ["cec:10", "BERMUDA TACTEL / Azul"],
    ["belvedere:20", "BELVEDERE - COLETE"],
  ]),
};

function pedido(over: Partial<PedidoVenda> = {}): PedidoVenda {
  return {
    status: "closed",
    payment_status: "paid",
    paid_at: "2026-03-10T12:00:00-03:00",
    cancelled_at: null,
    products: [{ product_id: 10, variant_id: 100, name: "Bermuda", quantity: 2, price: "80.00" }],
    ...over,
  };
}

describe("venda contabilizada", () => {
  it("conta o pedido pago no ano, pela data de pagamento", () => {
    expect(vendaDoAno(pedido(), 2026)).toBe(true);
    expect(vendaDoAno(pedido(), 2025)).toBe(false);
  });

  it("conta pelo pagamento, não pela criação: pedido de 2025 pago em 2026 é de 2026", () => {
    expect(vendaDoAno(pedido({ paid_at: "2026-01-05T10:00:00-03:00" }), 2026)).toBe(true);
    expect(vendaDoAno(pedido({ paid_at: "2025-12-28T10:00:00-03:00" }), 2026)).toBe(false);
  });

  it("não conta pedido não pago nem estornado", () => {
    expect(vendaDoAno(pedido({ payment_status: "pending" }), 2026)).toBe(false);
    expect(vendaDoAno(pedido({ payment_status: "refunded" }), 2026)).toBe(false);
    expect(vendaDoAno(pedido({ payment_status: null }), 2026)).toBe(false);
  });

  it("não conta pedido cancelado, mesmo pago", () => {
    expect(vendaDoAno(pedido({ status: "cancelled" }), 2026)).toBe(false);
    expect(vendaDoAno(pedido({ cancelled_at: "2026-04-01T10:00:00-03:00" }), 2026)).toBe(false);
  });

  it("usa a conclusão do pedido quando o gateway não preenche paid_at", () => {
    const pagBank = pedido({
      paid_at: null,
      completed_at: { date: "2026-08-04 19:06:11.000000" },
      created_at: "2026-08-04T19:06:11+0000",
    });
    expect(vendaDoAno(pagBank, 2026)).toBe(true);
    expect(vendaDoAno(pagBank, 2025)).toBe(false);
    expect(dataDaVenda(pagBank)).toBe("2026-08-04 19:06:11.000000");
  });

  it("cai para a criação do pedido quando não há pagamento nem conclusão", () => {
    const sem = pedido({ paid_at: null, created_at: "2026-02-01T10:00:00-03:00" });
    expect(vendaDoAno(sem, 2026)).toBe(true);
    expect(vendaDoAno(pedido({ paid_at: null, created_at: null }), 2026)).toBe(false);
  });

  it("prefere paid_at à conclusão quando os dois existem", () => {
    const pedidoPago = pedido({
      paid_at: "2026-01-05T10:00:00-03:00",
      completed_at: { date: "2025-12-20 10:00:00.000000" },
    });
    expect(vendaDoAno(pedidoPago, 2026)).toBe(true);
    expect(vendaDoAno(pedidoPago, 2025)).toBe(false);
  });

  it("usa o fuso de São Paulo para decidir o ano", () => {
    // 01/01/2027 00:30 UTC ainda é 31/12/2026 21:30 em São Paulo.
    expect(anoBRT("2027-01-01T00:30:00Z")).toBe(2026);
    expect(anoBRT("2026-01-01T02:00:00Z")).toBe(2025);
    expect(anoBRT(null)).toBe(null);
    expect(anoBRT("sem data")).toBe(null);
  });
});

describe("agregação por peça e tamanho", () => {
  it("soma as quantidades da mesma variação em pedidos diferentes", () => {
    const vendas = agregaVendas("cec", [pedido(), pedido()], 2026, catalogo);
    expect(vendas).toEqual([
      {
        storeKey: "cec",
        produto: "BERMUDA TACTEL / Azul",
        tamanho: "8",
        quantidade: 4,
        receita: 320,
      },
    ]);
  });

  it("mantém tamanhos da mesma peça em linhas separadas", () => {
    const vendas = agregaVendas(
      "cec",
      [
        pedido({
          products: [
            { product_id: 10, variant_id: 100, quantity: 1, price: 80 },
            { product_id: 10, variant_id: 101, quantity: 3, price: 80 },
          ],
        }),
      ],
      2026,
      catalogo,
    );
    expect(vendas.map((v) => [v.tamanho, v.quantidade])).toEqual([
      ["10", 3],
      ["8", 1],
    ]);
  });

  it("ignora pedidos fora do critério e itens sem quantidade", () => {
    const vendas = agregaVendas(
      "cec",
      [
        pedido({ payment_status: "pending" }),
        pedido({ status: "cancelled" }),
        pedido({ paid_at: "2025-11-20T10:00:00-03:00" }),
        pedido({ paid_at: null, completed_at: { date: "2025-11-20 10:00:00.000000" } }),
        pedido({ products: [{ product_id: 10, variant_id: 100, quantity: 0, price: 80 }] }),
      ],
      2026,
      catalogo,
    );
    expect(vendas).toEqual([]);
  });

  it("agrupa pelo id, usando o nome atual do catálogo mesmo se a peça foi renomeada", () => {
    const vendas = agregaVendas(
      "cec",
      [
        pedido({
          products: [{ product_id: 10, variant_id: 100, name: "Nome antigo", quantity: 1 }],
        }),
        pedido({ products: [{ product_id: 10, variant_id: 100, name: "Nome novo", quantity: 1 }] }),
      ],
      2026,
      catalogo,
    );
    expect(vendas).toHaveLength(1);
    expect(vendas[0]).toMatchObject({ produto: "BERMUDA TACTEL / Azul", quantidade: 2 });
  });

  it("cai para o nome do pedido quando a peça não está mais no catálogo", () => {
    const vendas = agregaVendas(
      "cec",
      [
        pedido({
          products: [{ product_id: 999, variant_id: 999, name: "Peça extinta", quantity: 1 }],
        }),
      ],
      2026,
      catalogo,
    );
    expect(vendas[0]).toMatchObject({ produto: "Peça extinta", tamanho: "—" });
  });
});

describe("venda em um intervalo de datas", () => {
  it("usa a data efetiva do pagamento no fuso de São Paulo, com limites inclusivos", () => {
    expect(vendaNoPeriodo(pedido(), "2026-03-01", "2026-03-31")).toBe(true);
    expect(vendaNoPeriodo(pedido(), "2026-03-10", "2026-03-10")).toBe(true);
    expect(vendaNoPeriodo(pedido(), "2026-03-11", "2026-03-31")).toBe(false);
    expect(vendaNoPeriodo(pedido(), "2026-02-01", "2026-03-09")).toBe(false);
    // 31/08 às 22h BRT ainda é agosto (em UTC já seria 01/09).
    expect(
      vendaNoPeriodo(pedido({ paid_at: "2026-08-31T22:00:00-03:00" }), "2026-08-01", "2026-08-31"),
    ).toBe(true);
  });

  it("sem paid_at cai para a conclusão do pedido e ignora não pago/cancelado", () => {
    const semPaidAt = pedido({
      paid_at: null,
      completed_at: { date: "2026-08-04 19:06:11.000000" },
    });
    expect(vendaNoPeriodo(semPaidAt, "2026-08-01", "2026-08-31")).toBe(true);
    expect(vendaNoPeriodo(pedido({ payment_status: "pending" }), "2026-01-01", "2026-12-31")).toBe(
      false,
    );
    expect(vendaNoPeriodo(pedido({ status: "cancelled" }), "2026-01-01", "2026-12-31")).toBe(false);
    expect(
      vendaNoPeriodo(
        pedido({ cancelled_at: "2026-03-12T10:00:00-03:00" }),
        "2026-01-01",
        "2026-12-31",
      ),
    ).toBe(false);
  });

  it("agrega por peça e tamanho apenas o que caiu no intervalo", () => {
    const pedidos = [
      pedido({ paid_at: "2026-08-05T10:00:00-03:00" }),
      pedido({
        paid_at: "2026-08-20T10:00:00-03:00",
        products: [{ product_id: 10, variant_id: 101, quantity: 3, price: "90.00" }],
      }),
      pedido({ paid_at: "2026-09-02T10:00:00-03:00" }),
    ];
    const vendas = agregaVendasPorPeriodo("cec", pedidos, "2026-08-01", "2026-08-31", catalogo);
    expect(vendas.map((v) => [v.tamanho, v.quantidade, v.receita])).toEqual([
      ["10", 3, 270],
      ["8", 2, 160],
    ]);
  });
});
