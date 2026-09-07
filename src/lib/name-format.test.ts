import { describe, expect, it } from "vitest";
import { capitalizarPrimeiraLetra, toTitleCase } from "./name-format";

describe("capitalizarPrimeiraLetra", () => {
  it("maiúscula só na primeira letra, preservando o resto", () => {
    expect(capitalizarPrimeiraLetra("apto 302")).toBe("Apto 302");
    expect(capitalizarPrimeiraLetra("casa")).toBe("Casa");
    expect(capitalizarPrimeiraLetra("  bloco B apto 12 ")).toBe("Bloco B apto 12");
    expect(capitalizarPrimeiraLetra("")).toBe("");
    expect(capitalizarPrimeiraLetra(null)).toBe("");
  });

  it("difere do Title Case, que maiusculiza cada palavra", () => {
    expect(toTitleCase("bloco b apto 12")).toBe("Bloco B Apto 12");
  });
});
