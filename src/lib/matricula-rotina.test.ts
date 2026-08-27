// Etapa 2 do formulário de matrícula ("Rotina Escolar"): o que é salvo em
// student_routine e a garantia estrutural de que nada disso chega ao Sponte.

import { describe, expect, it } from "vitest";
import {
  MATRICULA_FORM_VAZIO,
  MEIO_PERIODO_MANHA,
  MEIO_PERIODO_TARDE,
  ROTINA_FORM_VAZIA,
  montarPayloadMatricula,
  montarRotinaPersistida,
  refeicoesVazias,
  validarRotinaForm,
  type MatriculaForm,
  type RotinaForm,
} from "./matricula-form";

function rotinaCompleta(patch: Partial<RotinaForm> = {}): RotinaForm {
  return {
    ...ROTINA_FORM_VAZIA,
    dataInicio: "2027-02-01",
    horarios: {
      1: { ...MEIO_PERIODO_MANHA },
      2: { entrada: "08:00", saida: "17:30" },
      3: { ...MEIO_PERIODO_TARDE },
      4: { entrada: "10:00", saida: "17:30" },
      5: { ...MEIO_PERIODO_MANHA },
    },
    refeicoes: { ...refeicoesVazias(), lunch: [1, 2, 3, 4, 5], snack: [2, 4] },
    ...patch,
  };
}

function formMatricula(): MatriculaForm {
  return {
    ...MATRICULA_FORM_VAZIO,
    unidade: "CEC",
    aluno: {
      nome: "Ryan Kleber Braga de Morais",
      cpf: "",
      dataNascimento: "2019-04-10",
      naturalidade: "Belo Horizonte",
    },
    endereco: {
      cep: "30320-000",
      logradouro: "Rua das Acácias",
      numero: "100",
      complemento: "",
      bairro: "São Bento",
      cidade: "Belo Horizonte",
    },
    mae: {
      nome: "Ana Braga de Morais",
      cpf: "529.982.247-25",
      dataNascimento: "1990-05-20",
      telefone: "(31) 90000-0000",
      email: "ana@exemplo.com",
      mesmoEnderecoDoAluno: true,
      endereco: MATRICULA_FORM_VAZIO.endereco,
    },
  };
}

describe("validarRotinaForm", () => {
  it("aceita a rotina completa de cinco dias com horários diferentes por dia", () => {
    expect(validarRotinaForm(rotinaCompleta())).toEqual({});
  });

  it("exige data de início válida", () => {
    expect(
      validarRotinaForm(rotinaCompleta({ dataInicio: "" }))["rotina.dataInicio"],
    ).toBeDefined();
    expect(
      validarRotinaForm(rotinaCompleta({ dataInicio: "2027-02-31" }))["rotina.dataInicio"],
    ).toBeDefined();
  });

  it("exige ao menos um dia quando a frequência é parcial", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ frequenciaParcial: true, diasSelecionados: [] }),
    );
    expect(erros["rotina.dias"]).toBeDefined();
  });

  it("cobra horário só dos dias ativos", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({
        frequenciaParcial: true,
        diasSelecionados: [2, 4],
        horarios: { 2: { entrada: "08:00", saida: "17:30" } },
      }),
    );
    expect(erros["rotina.horario.4"]).toBeDefined();
    expect(erros["rotina.horario.2"]).toBeUndefined();
    // Segunda não é frequentada: não vira erro mesmo sem horário.
    expect(erros["rotina.horario.1"]).toBeUndefined();
  });

  it("recusa saída anterior ou igual à entrada", () => {
    const rotina = rotinaCompleta();
    rotina.horarios[3] = { entrada: "13:00", saida: "11:50" };
    expect(validarRotinaForm(rotina)["rotina.horario.3"]).toBeDefined();
  });

  it("exige pelo menos uma refeição quando 'nenhuma refeição' não está marcado", () => {
    const erros = validarRotinaForm(rotinaCompleta({ refeicoes: refeicoesVazias() }));
    expect(erros["rotina.refeicoes"]).toBeDefined();
  });

  it("dispensa a grade quando a família não contrata refeição", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ refeicoes: refeicoesVazias(), semRefeicoes: true }),
    );
    expect(erros["rotina.refeicoes"]).toBeUndefined();
  });
});

describe("montarRotinaPersistida", () => {
  it("salva dias ativos, horários por dia e refeições por dia", () => {
    expect(montarRotinaPersistida(rotinaCompleta())).toEqual({
      dataInicio: "2027-02-01",
      diasAtivos: [1, 2, 3, 4, 5],
      horarios: [
        { weekday: 1, entrada: "07:20", saida: "11:50" },
        { weekday: 2, entrada: "08:00", saida: "17:30" },
        { weekday: 3, entrada: "13:00", saida: "17:30" },
        { weekday: 4, entrada: "10:00", saida: "17:30" },
        { weekday: 5, entrada: "07:20", saida: "11:50" },
      ],
      semRefeicoes: false,
      refeicoes: { breakfast: [], lunch: [1, 2, 3, 4, 5], snack: [2, 4], dinner: [] },
    });
  });

  it("mantém só os dias frequentados, nos horários e nas refeições", () => {
    const salvo = montarRotinaPersistida(
      rotinaCompleta({ frequenciaParcial: true, diasSelecionados: [2, 4] }),
    );
    expect(salvo.diasAtivos).toEqual([2, 4]);
    expect(salvo.horarios).toEqual([
      { weekday: 2, entrada: "08:00", saida: "17:30" },
      { weekday: 4, entrada: "10:00", saida: "17:30" },
    ]);
    expect(salvo.refeicoes.lunch).toEqual([2, 4]);
    expect(salvo.refeicoes.snack).toEqual([2, 4]);
  });

  it("zera a grade quando a família marca 'não vou contratar nenhuma refeição'", () => {
    const salvo = montarRotinaPersistida(rotinaCompleta({ semRefeicoes: true }));
    expect(salvo.semRefeicoes).toBe(true);
    expect(salvo.refeicoes).toEqual(refeicoesVazias());
  });
});

describe("payload do Sponte", () => {
  it("não leva nada da Rotina Escolar (nem data de início, horários ou refeições)", () => {
    const payload = montarPayloadMatricula(formMatricula(), "site-1");
    const bruto = JSON.stringify(payload);

    for (const chave of [
      "dataInicio",
      "horarios",
      "refeicoes",
      "diasAtivos",
      "semRefeicoes",
      "rotina",
    ]) {
      expect(bruto).not.toContain(chave);
    }

    // Nem os valores dos atalhos de meio período aparecem no payload.
    expect(bruto).not.toContain(MEIO_PERIODO_MANHA.entrada);
    expect(bruto).not.toContain(MEIO_PERIODO_TARDE.saida);
    expect(Object.keys(payload)).toEqual([
      "submissionId",
      "unidade",
      "aluno",
      "endereco",
      "responsaveis",
    ]);
  });
});
