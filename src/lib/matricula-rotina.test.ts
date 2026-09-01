// Etapa 2 do formulário de matrícula ("Rotina Escolar"): o que é salvo em
// student_routine e a garantia estrutural de que nada disso chega ao Sponte.

import { describe, expect, it } from "vitest";
import {
  MATRICULA_FORM_VAZIO,
  ROTINA_FORM_VAZIA,
  montarPayloadMatricula,
  montarRotinaPersistida,
  refeicoesVazias,
  rotinaDoPlanoExistente,
  selecionarPeriodo,
  validarRotinaForm,
  type MatriculaForm,
  type RotinaForm,
} from "./matricula-form";

// Séries usadas nos testes: uma de cada segmento do quadro fixo de horários.
const INFANTIL = "1º Período";
const FUNDAMENTAL = "3º Ano";

// Rotina no modo estendido: é o único em que os horários são digitados por dia.
function rotinaCompleta(patch: Partial<RotinaForm> = {}): RotinaForm {
  return {
    ...ROTINA_FORM_VAZIA,
    dataInicio: "2027-02-01",
    horarioEstendido: true,
    horarios: {
      1: { entrada: "07:20", saida: "11:50" },
      2: { entrada: "08:00", saida: "17:30" },
      3: { entrada: "13:00", saida: "17:30" },
      4: { entrada: "10:00", saida: "17:30" },
      5: { entrada: "07:20", saida: "11:50" },
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
      cpf: "390.533.447-05",
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
    expect(validarRotinaForm(rotinaCompleta(), INFANTIL)).toEqual({});
  });

  it("exige marcar manhã, tarde ou horário estendido", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ horarioEstendido: false, horarios: {} }),
      INFANTIL,
    );
    expect(erros["rotina.periodos"]).toBeDefined();
  });

  it("recusa mais de um período marcado (a escolha é única)", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ horarioEstendido: false, periodoManha: true, periodoTarde: true }),
      INFANTIL,
    );
    expect(erros["rotina.periodos"]).toBeDefined();
  });

  it("não cobra horário digitado quando o período é o fixo do colégio", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ horarioEstendido: false, periodoManha: true, horarios: {} }),
      INFANTIL,
    );
    expect(erros).toEqual({});
  });

  it("exige data de início válida", () => {
    expect(
      validarRotinaForm(rotinaCompleta({ dataInicio: "" }), INFANTIL)["rotina.dataInicio"],
    ).toBeDefined();
    expect(
      validarRotinaForm(rotinaCompleta({ dataInicio: "2027-02-31" }), INFANTIL)[
        "rotina.dataInicio"
      ],
    ).toBeDefined();
  });

  it("exige ao menos um dia quando a frequência é parcial", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ frequenciaParcial: true, diasSelecionados: [] }),
      INFANTIL,
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
      INFANTIL,
    );
    expect(erros["rotina.horario.4"]).toBeDefined();
    expect(erros["rotina.horario.2"]).toBeUndefined();
    // Segunda não é frequentada: não vira erro mesmo sem horário.
    expect(erros["rotina.horario.1"]).toBeUndefined();
  });

  it("recusa saída anterior ou igual à entrada", () => {
    const rotina = rotinaCompleta();
    rotina.horarios[3] = { entrada: "13:00", saida: "11:50" };
    expect(validarRotinaForm(rotina, INFANTIL)["rotina.horario.3"]).toBeDefined();
  });

  it("exige pelo menos uma refeição quando 'nenhuma refeição' não está marcado", () => {
    const erros = validarRotinaForm(rotinaCompleta({ refeicoes: refeicoesVazias() }), INFANTIL);
    expect(erros["rotina.refeicoes"]).toBeDefined();
  });

  it("dispensa a grade quando a família não contrata refeição", () => {
    const erros = validarRotinaForm(
      rotinaCompleta({ refeicoes: refeicoesVazias(), semRefeicoes: true }),
      INFANTIL,
    );
    expect(erros["rotina.refeicoes"]).toBeUndefined();
  });
});

describe("montarRotinaPersistida", () => {
  it("salva dias ativos, horários por dia e refeições por dia", () => {
    expect(montarRotinaPersistida(rotinaCompleta(), INFANTIL)).toEqual({
      dataInicio: "2027-02-01",
      diasAtivos: [1, 2, 3, 4, 5],
      periodoManha: false,
      periodoTarde: false,
      horarioEstendido: true,
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
      INFANTIL,
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
    const salvo = montarRotinaPersistida(rotinaCompleta({ semRefeicoes: true }), INFANTIL);
    expect(salvo.semRefeicoes).toBe(true);
    expect(salvo.refeicoes).toEqual(refeicoesVazias());
  });

  it("usa o horário fixo do segmento quando o período escolhido é manhã ou tarde", () => {
    const base = rotinaCompleta({ horarioEstendido: false, horarios: {} });

    const infantilManha = montarRotinaPersistida({ ...base, periodoManha: true }, INFANTIL);
    expect(infantilManha.horarios[0]).toEqual({ weekday: 1, entrada: "07:20", saida: "11:50" });

    const fundamentalTarde = montarRotinaPersistida({ ...base, periodoTarde: true }, FUNDAMENTAL);
    expect(fundamentalTarde.horarios[0]).toEqual({ weekday: 1, entrada: "13:00", saida: "18:20" });

    const fundamentalManha = montarRotinaPersistida({ ...base, periodoManha: true }, FUNDAMENTAL);
    expect(fundamentalManha.horarios[0]).toEqual({ weekday: 1, entrada: "07:20", saida: "12:40" });
  });
});

describe("selecionarPeriodo", () => {
  it("marcar um período desmarca os outros dois", () => {
    const manha = selecionarPeriodo(rotinaCompleta(), "manha");
    expect([manha.periodoManha, manha.periodoTarde, manha.horarioEstendido]).toEqual([
      true,
      false,
      false,
    ]);

    const tarde = selecionarPeriodo(manha, "tarde");
    expect([tarde.periodoManha, tarde.periodoTarde, tarde.horarioEstendido]).toEqual([
      false,
      true,
      false,
    ]);

    const estendido = selecionarPeriodo(tarde, "estendido");
    expect([estendido.periodoManha, estendido.periodoTarde, estendido.horarioEstendido]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("a escolha resultante sempre passa na validação de períodos", () => {
    const rotina = selecionarPeriodo(rotinaCompleta(), "tarde");
    expect(validarRotinaForm(rotina, INFANTIL)["rotina.periodos"]).toBeUndefined();
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

    // Nem os horários fixos do colégio aparecem no payload.
    expect(bruto).not.toContain("07:20");
    expect(bruto).not.toContain("17:30");
    expect(Object.keys(payload)).toEqual([
      "submissionId",
      "unidade",
      "aluno",
      "endereco",
      "responsaveis",
    ]);
  });
});

describe("sugestão de rotina a partir de um plano já cadastrado", () => {
  it("reconhece o meio período da manhã do Infantil como checkbox, sem estendido", () => {
    const rotina = rotinaDoPlanoExistente(
      {
        horarios: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday: weekday as 1 | 2 | 3 | 4 | 5,
          entrada: "07:20",
          saida: "11:50",
        })),
        refeicoes: [{ meal: "breakfast", weekday: 1 }],
      },
      INFANTIL,
    );

    expect(rotina.periodoManha).toBe(true);
    expect(rotina.periodoTarde).toBe(false);
    expect(rotina.horarioEstendido).toBe(false);
    expect(rotina.frequenciaParcial).toBe(false);
    expect(rotina.refeicoes.breakfast).toEqual([1]);
    expect(rotina.semRefeicoes).toBe(false);
  });

  it("cai no horário estendido quando o plano não bate com o quadro fixo", () => {
    const rotina = rotinaDoPlanoExistente(
      {
        horarios: [
          { weekday: 1, entrada: "06:45", saida: "18:00" },
          { weekday: 3, entrada: "06:45", saida: "18:00" },
        ],
        refeicoes: [],
      },
      FUNDAMENTAL,
    );

    expect(rotina.horarioEstendido).toBe(true);
    expect(rotina.periodoManha).toBe(false);
    expect(rotina.periodoTarde).toBe(false);
    // Só dois dias no plano: a frequência parcial vem marcada com eles.
    expect(rotina.frequenciaParcial).toBe(true);
    expect(rotina.diasSelecionados).toEqual([1, 3]);
    expect(rotina.horarios[1]).toEqual({ entrada: "06:45", saida: "18:00" });
    expect(rotina.semRefeicoes).toBe(true);
  });

  it("integral do Fundamental cai no horário estendido, com os horários reais", () => {
    const rotina = rotinaDoPlanoExistente(
      {
        horarios: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday: weekday as 1 | 2 | 3 | 4 | 5,
          entrada: "07:20",
          saida: "18:20",
        })),
        refeicoes: [{ meal: "lunch", weekday: 2 }],
      },
      FUNDAMENTAL,
    );

    expect(rotina.periodoManha).toBe(false);
    expect(rotina.periodoTarde).toBe(false);
    expect(rotina.horarioEstendido).toBe(true);
    expect(rotina.horarios[1]).toEqual({ entrada: "07:20", saida: "18:20" });
  });

  it("sem plano nenhum, devolve a etapa em branco (sem estendido nem parcial)", () => {
    const rotina = rotinaDoPlanoExistente({ horarios: [], refeicoes: [] }, INFANTIL);

    expect(rotina.horarioEstendido).toBe(false);
    expect(rotina.frequenciaParcial).toBe(false);
    expect(rotina.semRefeicoes).toBe(false);
    expect(rotina.diasSelecionados).toEqual([1, 2, 3, 4, 5]);
  });
});
