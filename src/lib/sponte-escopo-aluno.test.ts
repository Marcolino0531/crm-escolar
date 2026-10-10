import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { alunoDaUnidadePorTurma, contaCreditadaDaUnidade, exigeChecagemDeTurma } =
  await import("@/lib/sponte.functions");

const ANO = 2026;

describe("exigeChecagemDeTurma (quem precisa da checagem por aluno)", () => {
  it("admin e usuário com os dois colégios passam sem checagem", () => {
    expect(exigeChecagemDeTurma(null, "CEC Baby")).toBe(false);
    expect(exigeChecagemDeTurma(null, "CEC")).toBe(false);
    expect(exigeChecagemDeTurma(["CEC", "CEC Baby"], "CEC Baby")).toBe(false);
    expect(exigeChecagemDeTurma(["CEC Baby", "CEC", "Núcleo Belvedere"], "CEC")).toBe(false);
  });

  it("usuário com só um dos dois colégios passa pela checagem", () => {
    expect(exigeChecagemDeTurma(["CEC Baby"], "CEC Baby")).toBe(true);
    expect(exigeChecagemDeTurma(["CEC", "Núcleo Belvedere"], "CEC")).toBe(true);
  });

  it("Belvedere e Vale do Sereno não são afetados", () => {
    expect(exigeChecagemDeTurma(["Núcleo Belvedere"], "Núcleo Belvedere")).toBe(false);
    expect(exigeChecagemDeTurma(["CEC", "Núcleo Vale do Sereno"], "Núcleo Vale do Sereno")).toBe(
      false,
    );
  });
});

describe("alunoDaUnidadePorTurma (mesma regra da busca: turma + vínculo do ano)", () => {
  it("só CEC Baby aceita aluno com TurmaAtual do CEC e vínculo do ano corrente no CEC Baby", () => {
    expect(
      alunoDaUnidadePorTurma(
        "CEC Baby",
        "1º Ano A",
        [{ anoLetivo: ANO, turmaNome: "Maternal 3" }],
        ANO,
      ),
    ).toBe(true);
  });

  it("só CEC Baby recusa aluno só do CEC", () => {
    expect(alunoDaUnidadePorTurma("CEC Baby", "1º Ano A", [], ANO)).toBe(false);
    expect(
      alunoDaUnidadePorTurma("CEC Baby", "2º Ano", [{ anoLetivo: ANO, turmaNome: "1º Ano" }], ANO),
    ).toBe(false);
  });

  it("vínculo de ano anterior não conta", () => {
    expect(
      alunoDaUnidadePorTurma(
        "CEC Baby",
        "1º Ano",
        [{ anoLetivo: ANO - 1, turmaNome: "Maternal 3" }],
        ANO,
      ),
    ).toBe(false);
  });

  it("só CEC recusa aluno só do CEC Baby e aceita o do CEC", () => {
    expect(alunoDaUnidadePorTurma("CEC", "Berçário II", [], ANO)).toBe(false);
    expect(alunoDaUnidadePorTurma("CEC", "5º Ano B", [], ANO)).toBe(true);
  });

  it("Belvedere e Vale do Sereno não são afetados", () => {
    expect(alunoDaUnidadePorTurma("Núcleo Belvedere", "Maternal 2", [], ANO)).toBe(true);
    expect(alunoDaUnidadePorTurma("Núcleo Vale do Sereno", "3º Ano", [], ANO)).toBe(true);
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
