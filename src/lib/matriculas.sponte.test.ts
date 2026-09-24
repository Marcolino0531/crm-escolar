import { describe, expect, it } from "vitest";
import { camposAluno } from "@/lib/matriculas.sponte";

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
    expect(t.sCPF).toBe("11122233396");
    expect(t.sCEP).toBe("30320000");
    expect(t.sEndereco).toBe("Rua das Acácias");
    expect(t.sCidade).toBe("Belo Horizonte");
  });
});
