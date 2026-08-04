import { describe, it, expect } from "vitest";
import { normalizarQuantidade, totalPorMaterial, quantidadeTotalGeral } from "./estoque-material";

describe("normalizarQuantidade", () => {
  it("mantém inteiros não-negativos", () => {
    expect(normalizarQuantidade(0)).toBe(0);
    expect(normalizarQuantidade(12)).toBe(12);
  });

  it("trunca decimais e zera negativos/inválidos", () => {
    expect(normalizarQuantidade(3.9)).toBe(3);
    expect(normalizarQuantidade(-5)).toBe(0);
    expect(normalizarQuantidade("7")).toBe(7);
    expect(normalizarQuantidade("abc")).toBe(0);
    expect(normalizarQuantidade(null)).toBe(0);
    expect(normalizarQuantidade(undefined)).toBe(0);
  });
});

describe("totalPorMaterial", () => {
  it("soma a quantidade de um material somando todas as turmas", () => {
    const total = totalPorMaterial([
      { material: "Lápis de cor", quantidade: 10 },
      { material: "Lápis de cor", quantidade: 5 },
      { material: "Caderno", quantidade: 8 },
      { material: "Lápis de cor", quantidade: 2 },
    ]);
    expect(total.get("Lápis de cor")).toBe(17);
    expect(total.get("Caderno")).toBe(8);
    expect(total.size).toBe(2);
  });

  it("preserva a ordem da primeira ocorrência de cada material", () => {
    const total = totalPorMaterial([
      { material: "Cola", quantidade: 1 },
      { material: "Tesoura", quantidade: 2 },
      { material: "Cola", quantidade: 3 },
    ]);
    expect([...total.keys()]).toEqual(["Cola", "Tesoura"]);
  });

  it("normaliza quantidades sujas ao somar", () => {
    const total = totalPorMaterial([
      { material: "Tinta", quantidade: 2.7 },
      { material: "Tinta", quantidade: -4 },
      { material: "Tinta", quantidade: 3 },
    ]);
    expect(total.get("Tinta")).toBe(5);
  });

  it("lista vazia retorna mapa vazio", () => {
    expect(totalPorMaterial([]).size).toBe(0);
  });
});

describe("quantidadeTotalGeral", () => {
  it("soma todas as quantidades de todos os materiais e turmas", () => {
    expect(
      quantidadeTotalGeral([
        { material: "Lápis", quantidade: 10 },
        { material: "Caderno", quantidade: 5 },
        { material: "Cola", quantidade: 3 },
      ]),
    ).toBe(18);
  });

  it("lista vazia soma zero", () => {
    expect(quantidadeTotalGeral([])).toBe(0);
  });
});
