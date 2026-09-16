import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("toTitleCase — cargo de funcionário (migration 20260917120000)", () => {
  it("cargo em CAIXA ALTA sai em Title Case, com preposição minúscula no meio", () => {
    expect(toTitleCase("AUXILIAR DE LIMPEZA")).toBe("Auxiliar de Limpeza");
    expect(toTitleCase("ESTAGIÁRIA")).toBe("Estagiária");
    expect(toTitleCase("PROFESSOR(A)")).toBe("Professor(a)");
    expect(toTitleCase("Estagiária de psicologia ")).toBe("Estagiária de Psicologia");
  });

  it("trigger formata nome e cargo no mesmo BEFORE INSERT OR UPDATE", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../supabase/migrations/20260917120000_funcionarios_cargo_title_case.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("NEW.nome_completo := public.title_case(NEW.nome_completo);");
    expect(sql).toContain("NEW.cargo := public.title_case(NEW.cargo);");
    expect(sql).toMatch(/UPDATE public\.funcionarios\s+SET cargo = public\.title_case\(cargo\)/);
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
