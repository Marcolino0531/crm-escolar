import { describe, it, expect } from "vitest";
import {
  diasDesdePedido,
  pedidoEmAtraso,
  pedidoFoiAtendido,
  pendenteDePedido,
} from "./uniformes-pedido";

const marcado = "2026-07-01T12:00:00.000Z";

describe("pedidoFoiAtendido", () => {
  it("encerra o ciclo quando o saldo volta ao mínimo", () => {
    expect(pedidoFoiAtendido({ orderPlacedAt: marcado, stock: 5, minStock: 5 })).toBe(true);
    expect(pedidoFoiAtendido({ orderPlacedAt: marcado, stock: 12, minStock: 5 })).toBe(true);
  });

  it("mantém a marcação enquanto o estoque continua baixo", () => {
    expect(pedidoFoiAtendido({ orderPlacedAt: marcado, stock: 4, minStock: 5 })).toBe(false);
    expect(pedidoFoiAtendido({ orderPlacedAt: marcado, stock: 0, minStock: 5 })).toBe(false);
  });

  it("ignora peça sem pedido marcado", () => {
    expect(pedidoFoiAtendido({ orderPlacedAt: null, stock: 40, minStock: 5 })).toBe(false);
  });
});

describe("pedidoEmAtraso", () => {
  it("acusa pedido antigo com a peça ainda em falta", () => {
    const estado = { orderPlacedAt: marcado, stock: 2, minStock: 5 };
    expect(diasDesdePedido(marcado, new Date("2026-07-31T12:00:00.000Z"))).toBe(30);
    expect(pedidoEmAtraso(estado, new Date("2026-07-31T12:00:00.000Z"))).toBe(true);
    expect(pedidoEmAtraso(estado, new Date("2026-07-20T12:00:00.000Z"))).toBe(false);
  });

  it("não acusa atraso de pedido já atendido", () => {
    const estado = { orderPlacedAt: marcado, stock: 30, minStock: 5 };
    expect(pedidoEmAtraso(estado, new Date("2026-09-01T12:00:00.000Z"))).toBe(false);
  });
});

describe("pendenteDePedido (alerta do sininho)", () => {
  const belvedere = {
    storeKey: "belvedere" as const,
    produto: "BELVEDERE - COLETE",
    minStock: 5,
  };

  it("notifica a peça em estoque baixo sem pedido marcado", () => {
    expect(pendenteDePedido({ ...belvedere, stock: 2, orderPlacedAt: null })).toBe(true);
  });

  it("não notifica a peça em estoque baixo já com pedido marcado", () => {
    expect(pendenteDePedido({ ...belvedere, stock: 2, orderPlacedAt: marcado })).toBe(false);
  });

  it("não notifica peça fora da reposição, marcada ou não", () => {
    const algodao = { storeKey: "belvedere" as const, produto: "REGATA (ALGODÃO)", minStock: 5 };
    expect(pendenteDePedido({ ...algodao, stock: 0, orderPlacedAt: null })).toBe(false);
    expect(pendenteDePedido({ ...algodao, stock: 0, orderPlacedAt: marcado })).toBe(false);
  });

  it("mantém o alerta da loja enquanto restar uma peça baixa sem pedido", () => {
    const variacoes = [
      { ...belvedere, stock: 1, orderPlacedAt: marcado },
      { ...belvedere, produto: "BELVEDERE - BERMUDA", stock: 3, orderPlacedAt: null },
      { ...belvedere, produto: "BELVEDERE - CAMISA", stock: 40, orderPlacedAt: null },
    ];
    expect(variacoes.filter(pendenteDePedido).map((v) => v.produto)).toEqual([
      "BELVEDERE - BERMUDA",
    ]);
  });

  it("some o alerta da loja quando toda peça baixa está com pedido marcado", () => {
    const variacoes = [
      { ...belvedere, stock: 1, orderPlacedAt: marcado },
      { ...belvedere, produto: "BELVEDERE - BERMUDA", stock: 3, orderPlacedAt: marcado },
      { ...belvedere, produto: "BELVEDERE - CAMISA", stock: 40, orderPlacedAt: null },
    ];
    expect(variacoes.filter(pendenteDePedido)).toEqual([]);
  });

  it("volta a notificar quando a peça atendida cai de novo (marcação encerrada)", () => {
    expect(pendenteDePedido({ ...belvedere, stock: 4, orderPlacedAt: null })).toBe(true);
  });
});
