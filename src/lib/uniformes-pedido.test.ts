import { describe, it, expect } from "vitest";
import { diasDesdePedido, pedidoEmAtraso, pedidoFoiAtendido } from "./uniformes-pedido";

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
