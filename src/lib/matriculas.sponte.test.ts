import { describe, expect, it } from "vitest";
import { camposAluno, cpfParaSponte } from "@/lib/matriculas.sponte";

const endereco = {
  cep: "30320000",
  logradouro: "Rua das Acácias",
  numero: "120",
  complemento: "Apto 302",
  bairro: "Belvedere",
  cidade: "Belo Horizonte",
};

describe("camposAluno (InsertAlunos3)", () => {
  it("aluno vai sem e-mail, telefone e celular, mesmo que o payload traga contato", () => {
    const t = camposAluno(
      {
        nome: "Aluno De Teste",
        dataNascimento: "2020-03-15",
        cpf: "11122233396",
        rg: "MG1234",
        sexo: "Masculino",
        email: "pai@example.com",
        telefone: "3132000000",
        celular: "31990000000",
      },
      endereco,
      "2020-03-15T00:00:00",
    );
    expect(t.sEmail).toBe("");
    expect(t.sTelefone).toBe("");
    expect(t.sCelular).toBe("");
    expect(t.sCPF).toBe("111.222.333-96");
    expect(t.sCEP).toBe("30320000");
    expect(t.sEndereco).toBe("Rua das Acácias");
    expect(t.sCidade).toBe("Belo Horizonte");
  });
});

describe("cpfParaSponte (sCPF do aluno e sCPFCNPJ do responsável novo)", () => {
  it("CPF com 11 dígitos vai no padrão 000.000.000-00", () => {
    expect(cpfParaSponte("11122233396")).toBe("111.222.333-96");
    expect(cpfParaSponte(" 111.222.333-96 ")).toBe("111.222.333-96");
  });

  it("vazio continua vazio", () => {
    expect(cpfParaSponte(undefined)).toBe("");
    expect(cpfParaSponte("")).toBe("");
    expect(cpfParaSponte("   ")).toBe("");
  });

  it("outra quantidade de dígitos vai como está", () => {
    expect(cpfParaSponte("1112223339")).toBe("1112223339");
    expect(cpfParaSponte("11222333000181")).toBe("11222333000181");
  });
});
