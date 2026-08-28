import { describe, expect, it } from "vitest";
import {
  CAMPOS_EDITAVEIS_ALUNO,
  aplicarEdicao,
  camposAlterados,
  camposEsvaziados,
  dataParaSponte,
  divergenciasForaDaEdicao,
  montarParametrosUpdateAlunos3,
  montarParametrosUpdateResponsaveis2,
  type FichaAlunoSponte,
  type FichaResponsavelSponte,
} from "@/lib/sponte-cadastro";

const ALUNO: FichaAlunoSponte = {
  alunoId: "12345",
  nome: "Aluno Teste Homologação",
  midia: "Indicação",
  dataNascimento: "2018-04-03",
  cidade: "Belo Horizonte",
  bairro: "Savassi",
  cep: "30140071",
  endereco: "Rua Antônio de Albuquerque",
  numeroEndereco: "100",
  complementoEndereco: "Apto 401",
  cpf: "11122233344",
  rg: "MG1234567",
  responsavelFinanceiroId: "777",
  responsavelDidaticoId: "888",
  email: "responsavel@example.com",
  telefone: "3132223344",
  celular: "31988887777",
  observacao: "Alergia a lactose",
  sexo: "M",
  profissao: "",
  cidadeNatal: "Belo Horizonte",
  ra: "RA-9",
  numeroMatricula: "20240765",
  situacao: "Ativo",
  cursoInteresse: "Ensino Fundamental",
  infoBloqueada: "0",
  origemNome: "Site",
  origemId: "5",
};

const RESPONSAVEL: FichaResponsavelSponte = {
  responsavelId: "777",
  nome: "Maria de Teste",
  dataNascimento: "1986-09-12",
  parentesco: "Mãe",
  cep: "30140071",
  endereco: "Rua Antônio de Albuquerque",
  numeroEndereco: "100",
  complementoEndereco: "Apto 401",
  rg: "MG7654321",
  cpfCnpj: "55566677788",
  cidade: "Belo Horizonte",
  bairro: "Savassi",
  email: "maria@example.com",
  telefone: "3132223344",
  celular: "31988887777",
  alunoId: "12345",
  responsavelFinanceiro: true,
  responsavelDidatico: false,
  observacao: "Prefere contato por WhatsApp",
  sexo: "F",
  profissao: "Arquiteta",
  tipoPessoa: "1",
};

function tags(payload: string): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const [, nome, valor] of payload.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
    mapa[nome] = valor;
  }
  return mapa;
}

describe("edição cadastral do portal", () => {
  it("troca só os campos editados e preserva o resto da ficha lida", () => {
    const atualizada = aplicarEdicao(
      ALUNO,
      { cep: "30190002", telefone: "3133334444" },
      CAMPOS_EDITAVEIS_ALUNO,
    );
    expect(atualizada.cep).toBe("30190002");
    expect(atualizada.telefone).toBe("3133334444");
    expect({ ...atualizada, cep: ALUNO.cep, telefone: ALUNO.telefone }).toEqual(ALUNO);
  });

  it("descarta valor em branco em vez de apagar o dado do Sponte", () => {
    const atualizada = aplicarEdicao(ALUNO, { cep: "   ", email: "" }, CAMPOS_EDITAVEIS_ALUNO);
    expect(atualizada.cep).toBe(ALUNO.cep);
    expect(atualizada.email).toBe(ALUNO.email);
  });

  it("ignora campo que não é editável pelo portal", () => {
    const atualizada = aplicarEdicao(
      ALUNO,
      { cpf: "99988877766", nome: "Outro Nome" } as Record<string, string>,
      CAMPOS_EDITAVEIS_ALUNO,
    );
    expect(atualizada.cpf).toBe(ALUNO.cpf);
    expect(atualizada.nome).toBe(ALUNO.nome);
  });

  it("não deixa vínculo financeiro/didático entrar na edição", () => {
    const atualizada = aplicarEdicao(
      ALUNO,
      { responsavelFinanceiroId: "1", responsavelDidaticoId: "2" } as Record<string, string>,
      CAMPOS_EDITAVEIS_ALUNO,
    );
    expect(atualizada.responsavelFinanceiroId).toBe("777");
    expect(atualizada.responsavelDidaticoId).toBe("888");
  });

  it("lista para auditoria só o que mudou (campo, antes, depois)", () => {
    const atualizada = aplicarEdicao(ALUNO, { cep: "30190002" }, CAMPOS_EDITAVEIS_ALUNO);
    expect(camposAlterados(ALUNO, atualizada)).toEqual([
      { campo: "cep", de: "30140071", para: "30190002" },
    ]);
  });

  it("acusa qualquer campo preenchido que iria vazio no payload", () => {
    const quebrada = { ...ALUNO, cpf: "", observacao: "  " };
    expect(camposEsvaziados(ALUNO, quebrada).sort()).toEqual(["cpf", "observacao"]);
    expect(camposEsvaziados(ALUNO, ALUNO)).toEqual([]);
  });

  it("acusa na releitura campo fora da edição que o Sponte sobrescreveu", () => {
    const relida = { ...ALUNO, cep: "30190002", email: "" };
    expect(divergenciasForaDaEdicao(ALUNO, relida, ["cep"])).toEqual([
      { campo: "email", esperado: "responsavel@example.com", encontrado: "" },
    ]);
  });

  it("releitura idêntica fora dos campos editados não gera divergência", () => {
    const relida = { ...ALUNO, cep: "30190002", telefone: "3133334444" };
    expect(divergenciasForaDaEdicao(ALUNO, relida, ["cep", "telefone"])).toEqual([]);
  });
});

describe("payload de UpdateAlunos3", () => {
  const payload = montarParametrosUpdateAlunos3(
    aplicarEdicao(ALUNO, { cep: "30190002", telefone: "3133334444" }, CAMPOS_EDITAVEIS_ALUNO),
  );
  const t = tags(payload);

  it("reenvia todos os campos da ficha com o valor original", () => {
    expect(t.sNome).toBe(ALUNO.nome);
    expect(t.sCPF).toBe(ALUNO.cpf);
    expect(t.sRG).toBe(ALUNO.rg);
    expect(t.sEmail).toBe(ALUNO.email);
    expect(t.sEndereco).toBe("Rua Antônio de Albuquerque");
    expect(t.sObservacao).toBe(ALUNO.observacao);
    expect(t.sSituacao).toBe(ALUNO.situacao);
    expect(t.sNumeroMatricula).toBe(ALUNO.numeroMatricula);
    expect(t.dDataNascimento).toBe("2018-04-03T00:00:00");
  });

  it("manda os IDs de responsável exatamente como lidos", () => {
    expect(t.nResponsavelFinanceiroID).toBe("777");
    expect(t.nResponsavelDidaticoID).toBe("888");
  });

  it("aplica a edição do portal", () => {
    expect(t.sCEP).toBe("30190002");
    expect(t.sTelefone).toBe("3133334444");
    expect(t.sCelular).toBe(ALUNO.celular);
  });

  it("não inventa campo fora do contrato de UpdateAlunos3", () => {
    expect(Object.keys(t).sort()).toEqual(
      [
        "nAlunoID",
        "sNome",
        "sMidia",
        "dDataNascimento",
        "sCidade",
        "sBairro",
        "sCEP",
        "sEndereco",
        "nNumeroEndereco",
        "sComplementoEndereco",
        "sCPF",
        "sRG",
        "nResponsavelFinanceiroID",
        "nResponsavelDidaticoID",
        "sEmail",
        "sTelefone",
        "sCelular",
        "sObservacao",
        "sSexo",
        "sProfissao",
        "sCidadeNatal",
        "sRa",
        "sNumeroMatricula",
        "sSituacao",
        "sCursoInteresse",
        "sInfoBloqueada",
        "sOrigemNome",
        "nOrigemID",
      ].sort(),
    );
  });

  it("escapa caractere especial em vez de quebrar o envelope", () => {
    const p = tags(montarParametrosUpdateAlunos3({ ...ALUNO, observacao: "Mãe & pai <ver>" }));
    expect(p.sObservacao).toBe("Mãe &amp; pai &lt;ver&gt;");
  });

  it("data ilegível vai vazia (o Sponte rejeita formato inválido)", () => {
    expect(dataParaSponte("03/04/2018")).toBe("");
    expect(
      tags(montarParametrosUpdateAlunos3({ ...ALUNO, dataNascimento: "" })).dDataNascimento,
    ).toBe("");
  });
});

describe("payload de UpdateResponsaveis2", () => {
  const payload = montarParametrosUpdateResponsaveis2(
    aplicarEdicao(RESPONSAVEL, { cep: "30190002", telefone: "3133334444" }, CAMPOS_EDITAVEIS_ALUNO),
  );
  const t = tags(payload);

  it("reenvia a ficha completa do responsável", () => {
    expect(t.sNome).toBe(RESPONSAVEL.nome);
    expect(t.sCPFCNPJ).toBe(RESPONSAVEL.cpfCnpj);
    expect(t.sRG).toBe(RESPONSAVEL.rg);
    expect(t.sEmail).toBe(RESPONSAVEL.email);
    expect(t.nParentesco).toBe("Mãe");
    expect(t.nTipoPessoa).toBe("1");
    expect(t.dDataNascimento).toBe("1986-09-12T00:00:00");
  });

  it("repassa os papéis do responsável como foram lidos", () => {
    expect(t.lResponsavelFinanceiro).toBe("1");
    expect(t.lResponsavelDidatico).toBe("0");
    expect(t.nAlunoID).toBe("12345");

    const invertido = tags(
      montarParametrosUpdateResponsaveis2({
        ...RESPONSAVEL,
        responsavelFinanceiro: false,
        responsavelDidatico: true,
      }),
    );
    expect(invertido.lResponsavelFinanceiro).toBe("0");
    expect(invertido.lResponsavelDidatico).toBe("1");
  });

  it("aplica só CEP e telefone editados", () => {
    expect(t.sCEP).toBe("30190002");
    expect(t.sTelefone).toBe("3133334444");
    expect(t.sCelular).toBe(RESPONSAVEL.celular);
    expect(t.sEndereco).toBe(RESPONSAVEL.endereco);
  });

  it("não inventa campo fora do contrato de UpdateResponsaveis2", () => {
    expect(Object.keys(t).sort()).toEqual(
      [
        "nResponsavelID",
        "sNome",
        "dDataNascimento",
        "nParentesco",
        "sCEP",
        "sEndereco",
        "nNumeroEndereco",
        "sRG",
        "sCPFCNPJ",
        "sCidade",
        "sBairro",
        "sEmail",
        "sTelefone",
        "sCelular",
        "nAlunoID",
        "lResponsavelFinanceiro",
        "lResponsavelDidatico",
        "sObservacao",
        "sSexo",
        "sProfissao",
        "nTipoPessoa",
        "sComplementoEndereco",
      ].sort(),
    );
  });
});
