import { describe, it, expect } from "vitest";
import { extrairDadosBasicos, resumirSubmissoes, STATUS_ERRO } from "./matriculas.audit";

describe("extrairDadosBasicos", () => {
  it("extrai nome/CPF do aluno, unidade e submissionId de um payload válido", () => {
    expect(
      extrairDadosBasicos({
        submissionId: "resp-123",
        unidade: "CEC",
        aluno: { nome: "Maria Silva", cpf: "123.456.789-00" },
      }),
    ).toEqual({
      submissionId: "resp-123",
      unidade: "CEC",
      alunoNome: "Maria Silva",
      alunoCpf: "123.456.789-00",
    });
  });

  it("extrai o que dá de um payload inválido (sem endereço) sem lançar", () => {
    expect(
      extrairDadosBasicos({
        submissionId: "resp-999",
        unidade: "Núcleo Belvedere",
        aluno: { nome: "João Sem CEP" },
        endereco: { numero: "10" },
      }),
    ).toEqual({
      submissionId: "resp-999",
      unidade: "Núcleo Belvedere",
      alunoNome: "João Sem CEP",
      alunoCpf: null,
    });
  });

  it("trata strings vazias/espaços como ausência de dado", () => {
    expect(extrairDadosBasicos({ unidade: "   ", aluno: { nome: "", cpf: "  " } })).toEqual({
      submissionId: null,
      unidade: null,
      alunoNome: null,
      alunoCpf: null,
    });
  });

  it("é tolerante a bruto não-objeto ou aluno ausente", () => {
    const vazio = { submissionId: null, unidade: null, alunoNome: null, alunoCpf: null };
    expect(extrairDadosBasicos(null)).toEqual(vazio);
    expect(extrairDadosBasicos(undefined)).toEqual(vazio);
    expect(extrairDadosBasicos("texto solto")).toEqual(vazio);
    expect(extrairDadosBasicos(42)).toEqual(vazio);
    expect(extrairDadosBasicos({})).toEqual(vazio);
    expect(extrairDadosBasicos({ aluno: null })).toEqual(vazio);
  });
});

describe("resumirSubmissoes", () => {
  it("conta o total incluindo submissões com erro de validação", () => {
    const resumo = resumirSubmissoes([
      { status: "sucesso" },
      { status: "sucesso" },
      { status: "duplicado" },
      { status: "erro_aluno" },
      { status: "erro_validacao" },
    ]);
    expect(resumo.total).toBe(5);
    expect(resumo.porStatus).toEqual({
      sucesso: 2,
      duplicado: 1,
      erro_aluno: 1,
      erro_validacao: 1,
    });
  });

  it("soma erro_validacao no agregado de erros", () => {
    const resumo = resumirSubmissoes([
      { status: "sucesso" },
      { status: "erro_aluno" },
      { status: "erro_responsavel" },
      { status: "erro_validacao" },
      { status: "erro_validacao" },
    ]);
    expect(resumo.erros).toBe(4);
  });

  it("uma submissão com erro de validação entra na contagem e no status correto", () => {
    const resumo = resumirSubmissoes([{ status: "erro_validacao" }]);
    expect(resumo.total).toBe(1);
    expect(resumo.erros).toBe(1);
    expect(resumo.porStatus.erro_validacao).toBe(1);
  });

  it("lista vazia zera todos os agregados", () => {
    expect(resumirSubmissoes([])).toEqual({ total: 0, porStatus: {}, erros: 0 });
  });

  it("não conta sucesso/duplicado como erro", () => {
    const resumo = resumirSubmissoes([{ status: "sucesso" }, { status: "duplicado" }]);
    expect(resumo.erros).toBe(0);
  });
});

describe("STATUS_ERRO", () => {
  it("inclui erro_validacao junto dos erros de envio ao Sponte", () => {
    expect(STATUS_ERRO).toContain("erro_validacao");
    expect(STATUS_ERRO).toContain("erro_aluno");
    expect(STATUS_ERRO).toContain("erro_responsavel");
    expect(STATUS_ERRO).not.toContain("sucesso");
  });
});
