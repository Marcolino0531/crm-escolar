import { describe, expect, it } from "vitest";
import {
  MAX_SUBMISSOES_POR_IP,
  MATRICULA_FORM_VAZIO,
  cepCompletoValido,
  cpfCompletoValido,
  dataNascimentoValida,
  emailValido,
  excedeuLimitePorIp,
  formatarCep,
  formatarCpf,
  formValido,
  inicioJanelaLimite,
  MIDIAS_SPONTE,
  montarPayloadMatricula,
  responsavelPreenchido,
  telefoneValido,
  validarMatriculaForm,
  type MatriculaForm,
} from "./matricula-form";

const UNIDADES = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];
const HOJE = "2026-08-28";

// CPFs com dígito verificador válido (gerados para o teste).
const CPF_MAE = "529.982.247-25";
const CPF_PAI = "111.444.777-35";
const CPF_ALUNO = "390.533.447-05";

function formCompleto(over: Partial<MatriculaForm> = {}): MatriculaForm {
  return {
    ...MATRICULA_FORM_VAZIO,
    unidade: "CEC",
    aluno: {
      nome: "Ryan Kleber Braga de Morais",
      cpf: CPF_ALUNO,
      dataNascimento: "2015-04-10",
      naturalidade: "Belo Horizonte",
    },
    endereco: {
      cep: "30320-000",
      logradouro: "Rua Teste",
      numero: "100",
      complemento: "Apto 202",
      bairro: "Belvedere",
      cidade: "Belo Horizonte",
    },
    mae: {
      nome: "Maria Braga de Morais",
      cpf: CPF_MAE,
      dataNascimento: "1985-02-20",
      telefone: "(31) 99999-8888",
      email: "maria@example.com",
      mesmoEnderecoDoAluno: true,
      endereco: MATRICULA_FORM_VAZIO.endereco,
    },
    pai: {
      nome: "Kleber de Morais",
      cpf: CPF_PAI,
      dataNascimento: "1983-07-05",
      telefone: "(31) 98888-7777",
      email: "kleber@example.com",
      mesmoEnderecoDoAluno: true,
      endereco: MATRICULA_FORM_VAZIO.endereco,
    },
    responsavelFinanceiro: "mae",
    ...over,
  };
}

describe("máscaras", () => {
  it("formata CPF progressivamente", () => {
    expect(formatarCpf("529")).toBe("529");
    expect(formatarCpf("52998")).toBe("529.98");
    expect(formatarCpf("52998224")).toBe("529.982.24");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });

  it("descarta dígitos além do CPF e caracteres não numéricos", () => {
    expect(formatarCpf("529.982.247-25999")).toBe("529.982.247-25");
    expect(formatarCpf("abc529def982")).toBe("529.982");
  });

  it("formata CEP", () => {
    expect(formatarCep("30320")).toBe("30320");
    expect(formatarCep("30320000")).toBe("30320-000");
    expect(formatarCep("3032000012")).toBe("30320-000");
  });
});

describe("validação de CPF (dígito verificador)", () => {
  it("aceita CPF válido com e sem máscara", () => {
    expect(cpfCompletoValido(CPF_MAE)).toBe(true);
    expect(cpfCompletoValido("52998224725")).toBe(true);
    expect(cpfCompletoValido(CPF_PAI)).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(cpfCompletoValido("529.982.247-24")).toBe(false);
    expect(cpfCompletoValido("111.444.777-30")).toBe(false);
  });

  it("recusa tamanho inválido e sequência repetida", () => {
    expect(cpfCompletoValido("529.982.247")).toBe(false);
    expect(cpfCompletoValido("")).toBe(false);
    expect(cpfCompletoValido("111.111.111-11")).toBe(false);
    expect(cpfCompletoValido("000.000.000-00")).toBe(false);
  });
});

describe("outras validações de formato", () => {
  it("valida CEP por quantidade de dígitos", () => {
    expect(cepCompletoValido("30320-000")).toBe(true);
    expect(cepCompletoValido("3032-000")).toBe(false);
  });

  it("valida telefone fixo e celular com DDD", () => {
    expect(telefoneValido("(31) 3333-4444")).toBe(true);
    expect(telefoneValido("(31) 99999-8888")).toBe(true);
    expect(telefoneValido("99999-8888")).toBe(false);
  });

  it("valida e-mail", () => {
    expect(emailValido("maria@example.com")).toBe(true);
    expect(emailValido("maria@example")).toBe(false);
    expect(emailValido("maria example.com")).toBe(false);
  });

  it("recusa data impossível, futura ou fora do formato", () => {
    expect(dataNascimentoValida("2015-04-10", HOJE)).toBe(true);
    expect(dataNascimentoValida("2026-02-31", HOJE)).toBe(false);
    expect(dataNascimentoValida("2027-01-01", HOJE)).toBe(false);
    expect(dataNascimentoValida("10/04/2015", HOJE)).toBe(false);
    expect(dataNascimentoValida("", HOJE)).toBe(false);
  });

  it("aceita 29/02 de ano bissexto e recusa em ano comum", () => {
    expect(dataNascimentoValida("2016-02-29", HOJE)).toBe(true);
    expect(dataNascimentoValida("2015-02-29", HOJE)).toBe(false);
  });
});

describe("validarMatriculaForm", () => {
  it("aprova o formulário completo", () => {
    expect(formValido(validarMatriculaForm(formCompleto(), HOJE, UNIDADES))).toBe(true);
  });

  it("exige colégio válido", () => {
    const erros = validarMatriculaForm(formCompleto({ unidade: "Outro" }), HOJE, UNIDADES);
    expect(erros.unidade).toBeDefined();
  });

  it("aponta os campos obrigatórios do aluno", () => {
    const erros = validarMatriculaForm(
      formCompleto({ aluno: { nome: "Jo", cpf: "", dataNascimento: "", naturalidade: "" } }),
      HOJE,
      UNIDADES,
    );
    expect(Object.keys(erros).sort()).toEqual([
      "aluno.cpf",
      "aluno.dataNascimento",
      "aluno.naturalidade",
      "aluno.nome",
    ]);
  });

  it("exige o CPF do aluno e recusa CPF inválido", () => {
    const semCpf = formCompleto();
    semCpf.aluno = { ...semCpf.aluno, cpf: "" };
    expect(validarMatriculaForm(semCpf, HOJE, UNIDADES)["aluno.cpf"]).toBeDefined();

    const cpfErrado = formCompleto();
    cpfErrado.aluno = { ...cpfErrado.aluno, cpf: "529.982.247-24" };
    expect(validarMatriculaForm(cpfErrado, HOJE, UNIDADES)["aluno.cpf"]).toBeDefined();
  });

  it("exige CEP e número do endereço", () => {
    const form = formCompleto();
    form.endereco = { ...form.endereco, cep: "303", numero: "" };
    const erros = validarMatriculaForm(form, HOJE, UNIDADES);
    expect(erros["endereco.cep"]).toBeDefined();
    expect(erros["endereco.numero"]).toBeDefined();
  });

  it("aceita família com um único responsável (bloco do pai em branco)", () => {
    const form = formCompleto({ pai: MATRICULA_FORM_VAZIO.pai });
    expect(responsavelPreenchido(form.pai)).toBe(false);
    expect(formValido(validarMatriculaForm(form, HOJE, UNIDADES))).toBe(true);
  });

  it("recusa formulário sem nenhum responsável", () => {
    const erros = validarMatriculaForm(
      formCompleto({ pai: MATRICULA_FORM_VAZIO.pai, mae: MATRICULA_FORM_VAZIO.mae }),
      HOJE,
      UNIDADES,
    );
    expect(erros.responsaveis).toBeDefined();
  });

  it("exige CPF válido do responsável (o Sponte recusa cadastro sem CPF)", () => {
    const form = formCompleto();
    form.mae = { ...form.mae, cpf: "529.982.247-24" };
    expect(validarMatriculaForm(form, HOJE, UNIDADES)["mae.cpf"]).toBeDefined();
  });

  it("valida o bloco parcialmente preenchido em vez de ignorá-lo", () => {
    const form = formCompleto({
      pai: { ...MATRICULA_FORM_VAZIO.pai, nome: "Kleber de Morais" },
    });
    const erros = validarMatriculaForm(form, HOJE, UNIDADES);
    expect(erros["pai.cpf"]).toBeDefined();
    expect(erros["pai.telefone"]).toBeDefined();
    expect(erros["pai.email"]).toBeDefined();
  });

  it("recusa responsável financeiro cujo bloco não foi informado", () => {
    const erros = validarMatriculaForm(
      formCompleto({ pai: MATRICULA_FORM_VAZIO.pai, responsavelFinanceiro: "pai" }),
      HOJE,
      UNIDADES,
    );
    expect(erros.responsavelFinanceiro).toBeDefined();
  });

  it("valida o endereço próprio do responsável quando ele não mora com o aluno", () => {
    const form = formCompleto();
    form.pai = { ...form.pai, mesmoEnderecoDoAluno: false };
    const erros = validarMatriculaForm(form, HOJE, UNIDADES);
    expect(erros["pai.endereco.cep"]).toBeDefined();
    expect(erros["pai.endereco.numero"]).toBeDefined();
  });
});

describe("montarPayloadMatricula", () => {
  it("monta o payload no contrato do fluxo de matrícula já existente", () => {
    const payload = montarPayloadMatricula(formCompleto(), "site-123");

    expect(payload).toMatchObject({
      submissionId: "site-123",
      unidade: "CEC",
      aluno: {
        nome: "Ryan Kleber Braga de Morais",
        cpf: "39053344705",
        dataNascimento: "2015-04-10",
        naturalidade: "Belo Horizonte",
      },
      endereco: {
        cep: "30320000",
        numero: "100",
        complemento: "Apto 202",
        logradouro: "Rua Teste",
        bairro: "Belvedere",
        cidade: "Belo Horizonte",
      },
    });
    expect(payload.responsaveis).toHaveLength(2);
  });

  it("envia uma mídia que existe no cadastro do Sponte", () => {
    const payload = montarPayloadMatricula(formCompleto(), "site-123");
    expect(MIDIAS_SPONTE).toContain(payload.aluno.midia);
  });

  it("envia CPF e telefone apenas em dígitos", () => {
    const payload = montarPayloadMatricula(formCompleto(), "site-123");
    const mae = payload.responsaveis[0];
    expect(mae.cpf).toBe("52998224725");
    expect(mae.celular).toBe("31999998888");
  });

  it("coloca o responsável financeiro em primeiro e marca só ele", () => {
    const payload = montarPayloadMatricula(formCompleto({ responsavelFinanceiro: "pai" }), "s");
    expect(payload.responsaveis.map((r) => r.parentesco)).toEqual(["Pai", "Mãe"]);
    expect(payload.responsaveis[0].responsavelFinanceiro).toBe(true);
    expect(payload.responsaveis[0].responsavelDidatico).toBe(true);
    expect(payload.responsaveis[1].responsavelFinanceiro).toBe(false);
  });

  it("omite o responsável em branco", () => {
    const payload = montarPayloadMatricula(formCompleto({ pai: MATRICULA_FORM_VAZIO.pai }), "s");
    expect(payload.responsaveis).toHaveLength(1);
    expect(payload.responsaveis[0].parentesco).toBe("Mãe");
  });

  it("replica o endereço do aluno para quem mora com ele e preserva o próprio de quem não mora", () => {
    const form = formCompleto();
    form.pai = {
      ...form.pai,
      mesmoEnderecoDoAluno: false,
      endereco: {
        cep: "30140-071",
        logradouro: "Av. Afonso Pena",
        numero: "1500",
        complemento: "",
        bairro: "Centro",
        cidade: "Belo Horizonte",
      },
    };
    const payload = montarPayloadMatricula(form, "s");
    const mae = payload.responsaveis.find((r) => r.parentesco === "Mãe");
    const pai = payload.responsaveis.find((r) => r.parentesco === "Pai");
    expect(mae?.endereco?.cep).toBe("30320000");
    expect(pai?.endereco).toMatchObject({ cep: "30140071", numero: "1500", bairro: "Centro" });
  });

  it("usa o contato do responsável financeiro como contato do aluno", () => {
    const payload = montarPayloadMatricula(formCompleto({ responsavelFinanceiro: "pai" }), "s");
    expect(payload.aluno.email).toBe("kleber@example.com");
    expect(payload.aluno.celular).toBe("31988887777");
  });
});

describe("limite de submissões por IP", () => {
  it("libera abaixo do teto e recusa a partir dele", () => {
    expect(excedeuLimitePorIp(0)).toBe(false);
    expect(excedeuLimitePorIp(MAX_SUBMISSOES_POR_IP - 1)).toBe(false);
    expect(excedeuLimitePorIp(MAX_SUBMISSOES_POR_IP)).toBe(true);
    expect(excedeuLimitePorIp(MAX_SUBMISSOES_POR_IP + 3)).toBe(true);
  });

  it("a janela do limite começa uma hora antes de agora", () => {
    expect(inicioJanelaLimite("2026-08-28T15:30:00.000Z")).toBe("2026-08-28T14:30:00.000Z");
  });
});
