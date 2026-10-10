import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { alunoDaUnidadePorTurma, contaCreditadaDaUnidade } = await import("@/lib/sponte.functions");

describe("alunoDaUnidadePorTurma (CEC × CEC Baby pela TurmaAtual)", () => {
  it("CEC Baby recusa aluno com turma do CEC", () => {
    expect(alunoDaUnidadePorTurma("CEC Baby", "1º Ano A")).toBe(false);
    expect(alunoDaUnidadePorTurma("CEC Baby", "2º Período")).toBe(false);
  });

  it("CEC recusa aluno com turma do CEC Baby", () => {
    expect(alunoDaUnidadePorTurma("CEC", "Berçário II")).toBe(false);
    expect(alunoDaUnidadePorTurma("CEC", "Maternal 3")).toBe(false);
  });

  it("aceita aluno da própria unidade", () => {
    expect(alunoDaUnidadePorTurma("CEC", "5º Ano B")).toBe(true);
    expect(alunoDaUnidadePorTurma("CEC Baby", "Maternal 1")).toBe(true);
  });

  it("sem turma (ex-aluno) fica no CEC, como nas listagens", () => {
    expect(alunoDaUnidadePorTurma("CEC", "")).toBe(true);
    expect(alunoDaUnidadePorTurma("CEC Baby", "")).toBe(false);
  });

  it("Belvedere e Vale do Sereno não mudam", () => {
    expect(alunoDaUnidadePorTurma("Núcleo Belvedere", "Maternal 2")).toBe(true);
    expect(alunoDaUnidadePorTurma("Núcleo Vale do Sereno", "3º Ano")).toBe(true);
  });
});

describe("contaCreditadaDaUnidade (conciliação)", () => {
  it("aceita a conta caixa da própria unidade", () => {
    expect(contaCreditadaDaUnidade("CEC", "489426")).toBe(true);
    expect(contaCreditadaDaUnidade("CEC Baby", "011311")).toBe(true);
  });

  it("recusa a conta de outra unidade", () => {
    expect(contaCreditadaDaUnidade("CEC", "011311")).toBe(false);
    expect(contaCreditadaDaUnidade("CEC Baby", "489426")).toBe(false);
    expect(contaCreditadaDaUnidade("CEC Baby", "11311")).toBe(false);
  });

  it("sem conta informada usa a padrão da unidade", () => {
    expect(contaCreditadaDaUnidade("CEC", undefined)).toBe(true);
  });

  it("Belvedere e Vale do Sereno mantêm as contas alternativas", () => {
    expect(contaCreditadaDaUnidade("Núcleo Belvedere", "1137")).toBe(true);
    expect(contaCreditadaDaUnidade("Núcleo Vale do Sereno", "9295")).toBe(true);
  });
});
