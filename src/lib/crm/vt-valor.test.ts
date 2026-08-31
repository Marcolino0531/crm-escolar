import { describe, expect, it } from "vitest";
import { formatValorVt, parseValorVt, valorVtValido } from "./vt-valor";

describe("valor diário do VT", () => {
  it("grava 16.90 já no primeiro salvamento de '16,90'", () => {
    expect(parseValorVt("16,90")).toBeCloseTo(16.9, 10);
  });

  it("não perde a vírgula ao reabrir e salvar de novo (round-trip)", () => {
    // Regressão: o campo era pré-preenchido com String(16.9) = "16.9" e o
    // parser tratava o ponto como milhar, gravando 169 no salvamento seguinte.
    const gravado = parseValorVt("16,90");
    const reaberto = formatValorVt(gravado);
    expect(reaberto).toBe("16,90");
    expect(parseValorVt(reaberto)).toBeCloseTo(16.9, 10);
    expect(parseValorVt("16.9")).toBeCloseTo(16.9, 10);
  });

  it("aceita milhar com vírgula decimal e recusa valor vazio", () => {
    expect(parseValorVt("1.234,56")).toBeCloseTo(1234.56, 10);
    expect(parseValorVt("R$ 16,90")).toBeCloseTo(16.9, 10);
    expect(valorVtValido("")).toBe(false);
    expect(valorVtValido("16,90")).toBe(true);
    expect(parseValorVt("abc")).toBe(0);
    expect(parseValorVt("-5")).toBe(0);
  });

  it("formata o número gravado com duas casas em pt-BR", () => {
    expect(formatValorVt(16.9)).toBe("16,90");
    expect(formatValorVt(0)).toBe("0,00");
    expect(formatValorVt(null)).toBe("");
  });
});
