import { describe, expect, it } from "vitest";
import { nomeAtualizado, nomeInformadoDiferente } from "@/lib/matriculas-nome";

describe("nomeAtualizado", () => {
  it("devolve o nome do Sponte quando difere do gravado", () => {
    expect(nomeAtualizado("Stella", "Stella Vieira Silva Araújo")).toBe(
      "Stella Vieira Silva Araújo",
    );
  });

  it("não muda quando só o espaçamento difere ou o Sponte não traz nome", () => {
    expect(nomeAtualizado("Stella  Vieira", " Stella Vieira ")).toBeNull();
    expect(nomeAtualizado("Stella", "")).toBeNull();
    expect(nomeAtualizado("Stella", null)).toBeNull();
  });
});

describe("nomeInformadoDiferente", () => {
  it("mostra o nome digitado só quando difere do atual", () => {
    expect(nomeInformadoDiferente("Stella Vieira Silva Araújo", "Stella")).toBe("Stella");
    expect(nomeInformadoDiferente("Stella", "Stella")).toBeNull();
    expect(nomeInformadoDiferente("Stella", null)).toBeNull();
  });
});
