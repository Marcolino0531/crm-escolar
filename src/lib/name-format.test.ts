import { describe, expect, it } from "vitest";
import { capitalizarPrimeiraLetra, toTitleCase } from "./name-format";

// Espelho em TypeScript da public.title_case() aplicada pelo trigger de
// public.funcionarios (migration 20260916120000).
describe("toTitleCase — nome de funcionário", () => {
  it("funcionário em CAIXA ALTA sai em Title Case com preposições minúsculas", () => {
    expect(toTitleCase("KARLA REGINA RODRIGUES DE NORONHA DE MORAIS")).toBe(
      "Karla Regina Rodrigues de Noronha de Morais",
    );
    expect(toTitleCase("  JOÃO   DOS SANTOS E SILVA ")).toBe("João dos Santos e Silva");
  });

  it("é idempotente e preserva a preposição quando é a 1ª palavra", () => {
    expect(toTitleCase("Karla Regina Rodrigues de Noronha de Morais")).toBe(
      "Karla Regina Rodrigues de Noronha de Morais",
    );
    expect(toTitleCase("DE PAULA")).toBe("De Paula");
  });
});

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
