import { describe, expect, it } from "vitest";
import { code128Modules, code128Symbols, code128TotalWidth } from "./code128";

describe("code128", () => {
  it("12 dígitos usam o conjunto C com checksum correto", () => {
    // Start C=105, pares 00 00 00 00 00 42, check = (105 + 42*6) % 103 = 357 % 103 = 48.
    expect(code128Symbols("000000000042")).toEqual([105, 0, 0, 0, 0, 0, 42, 48]);
  });

  it("texto alfanumérico usa o conjunto B", () => {
    // Exemplo clássico: "ABC" → 104, 33, 34, 35, check (104 + 33 + 68 + 105) % 103 = 310 % 103 = 1.
    expect(code128Symbols("ABC")).toEqual([104, 33, 34, 35, 1]);
  });

  it("módulos: 11 por símbolo + stop de 13, começando e terminando em barra", () => {
    const mods = code128Modules("000000000042");
    // 8 símbolos × 6 elementos + 7 do stop.
    expect(mods).toHaveLength(8 * 6 + 7);
    expect(code128TotalWidth("000000000042")).toBe(8 * 11 + 13);
    expect(mods.every((w) => w >= 1 && w <= 4)).toBe(true);
  });

  it("rejeita vazio e caracteres fora do ASCII", () => {
    expect(() => code128Symbols("")).toThrow();
    expect(() => code128Symbols("çã")).toThrow();
  });
});
