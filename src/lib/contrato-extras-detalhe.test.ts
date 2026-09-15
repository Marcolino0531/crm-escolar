import { describe, expect, it } from "vitest";
import {
  descreverDias,
  detalharExtrasContrato,
  horaExtraDaSemana,
  intervalosHoraExtraDoDia,
  type PlanoDiarioContrato,
} from "@/lib/contrato-extras-detalhe";
import {
  TEXTO_SEM_EXTRAS,
  extrasDoContrato,
  montarContratoMatricula,
  type MontarContratoInput,
  type TituloExtras,
} from "@/lib/contrato-matricula";
import type { Weekday } from "@/lib/diario";
import { HORARIOS_PADRAO, segmentoDaSerie } from "@/lib/matricula-form";

const ANO = 2027;
const TARDE_FUND = HORARIOS_PADRAO.fundamental.tarde; // 13:00–18:20
const MANHA_FUND = HORARIOS_PADRAO.fundamental.manha; // 07:20–12:40
const SEG_SEX: Weekday[] = [1, 2, 3, 4, 5];

function titulo(categoria: string, valor: number): TituloExtras {
  return { categoria, vencimento: "2027-02-10", valor, situacao: "Em aberto", quitada: false };
}

function plano(over: Partial<PlanoDiarioContrato> = {}): PlanoDiarioContrato {
  return {
    refeicoes: { breakfast: [], lunch: [], snack: [], dinner: [] },
    horarios: {},
    turnoRegular: TARDE_FUND,
    ...over,
  };
}

function horariosIguais(entry: string, exit: string, dias: Weekday[] = SEG_SEX) {
  return Object.fromEntries(
    dias.map((d) => [d, { entry, exit }]),
  ) as PlanoDiarioContrato["horarios"];
}

describe("descreverDias", () => {
  it("os 5 dias úteis viram 'de segunda a sexta-feira', em qualquer ordem", () => {
    expect(descreverDias([5, 3, 1, 4, 2])).toBe("de segunda a sexta-feira");
  });

  it("dias parciais saem por extenso, com vírgula e 'e' antes do último", () => {
    expect(descreverDias([1, 3, 5])).toBe("segunda-feira, quarta-feira e sexta-feira");
    expect(descreverDias([2, 4])).toBe("terça-feira e quinta-feira");
    expect(descreverDias([3])).toBe("quarta-feira");
  });

  it("6 dias (com sábado) não é 'segunda a sexta'", () => {
    expect(descreverDias([1, 2, 3, 4, 5, 6])).toBe(
      "segunda-feira, terça-feira, quarta-feira, quinta-feira, sexta-feira e sábado",
    );
  });
});

describe("intervalosHoraExtraDoDia", () => {
  it("só antes do turno", () => {
    expect(intervalosHoraExtraDoDia({ entry: "11:00", exit: "18:20" }, TARDE_FUND)).toEqual([
      { inicio: "11:00", fim: "13:00" },
    ]);
  });

  it("só depois do turno", () => {
    expect(intervalosHoraExtraDoDia({ entry: "07:20", exit: "14:00" }, MANHA_FUND)).toEqual([
      { inicio: "12:40", fim: "14:00" },
    ]);
  });

  it("antes E depois no mesmo dia", () => {
    expect(intervalosHoraExtraDoDia({ entry: "07:00", exit: "19:00" }, TARDE_FUND)).toEqual([
      { inicio: "07:00", fim: "13:00" },
      { inicio: "18:20", fim: "19:00" },
    ]);
  });

  it("horário dentro do turno regular não gera Hora Extra", () => {
    expect(intervalosHoraExtraDoDia({ entry: "13:00", exit: "18:20" }, TARDE_FUND)).toEqual([]);
    expect(intervalosHoraExtraDoDia({ entry: "14:00", exit: "17:00" }, TARDE_FUND)).toEqual([]);
  });

  it("aceita HH:MM:SS do banco e rejeita horário inválido", () => {
    expect(intervalosHoraExtraDoDia({ entry: "11:00:00", exit: "18:20:00" }, TARDE_FUND)).toEqual([
      { inicio: "11:00", fim: "13:00" },
    ]);
    expect(intervalosHoraExtraDoDia({ entry: "", exit: "18:20" }, TARDE_FUND)).toBeNull();
    expect(intervalosHoraExtraDoDia({ entry: "18:00", exit: "12:00" }, TARDE_FUND)).toBeNull();
  });
});

describe("horaExtraDaSemana", () => {
  it("mesmo horário todos os dias → intervalo único + dias", () => {
    const r = horaExtraDaSemana(horariosIguais("11:00", "18:20"), TARDE_FUND);
    expect(r.texto).toBe("das 11:00 às 13:00, de segunda a sexta-feira");
    expect(r.minutosSemana).toBe(5 * 120);
  });

  it("horário variando por dia → lista dia a dia", () => {
    const r = horaExtraDaSemana(
      { 1: { entry: "11:00", exit: "18:20" }, 3: { entry: "13:00", exit: "19:00" } },
      TARDE_FUND,
    );
    expect(r.texto).toBe("segunda-feira das 11:00 às 13:00, quarta-feira das 18:20 às 19:00");
  });

  it("dias dentro do turno ficam fora da Hora Extra", () => {
    const r = horaExtraDaSemana(
      { 1: { entry: "11:00", exit: "18:20" }, 2: { entry: "13:00", exit: "18:20" } },
      TARDE_FUND,
    );
    expect(r.dias).toEqual([1]);
    expect(r.texto).toBe("das 11:00 às 13:00, segunda-feira");
  });

  it("sem sobra em nenhum dia → texto vazio", () => {
    const r = horaExtraDaSemana(horariosIguais("13:00", "18:20"), TARDE_FUND);
    expect(r.dias).toEqual([]);
    expect(r.texto).toBe("");
  });
});

describe("detalharExtrasContrato", () => {
  const extrasGabriel = extrasDoContrato(
    [titulo("Hora Extra", 611.8), titulo("Almoço", 401.5), titulo("Lanche da Tarde", 334.45)],
    ANO,
  );

  it("caso Gabriel: tarde 13:00–18:20, Diário 11:00–18:20 seg–sex → Hora Extra de 2h (11:00 às 13:00)", () => {
    expect(segmentoDaSerie("1º Ano")).toBe("fundamental");
    const r = detalharExtrasContrato(
      extrasGabriel,
      plano({
        refeicoes: { breakfast: [], lunch: SEG_SEX, snack: SEG_SEX, dinner: [] },
        horarios: horariosIguais("11:00", "18:20"),
        turnoRegular: HORARIOS_PADRAO[segmentoDaSerie("1º Ano")].tarde,
      }),
    );
    expect(r.lista).toBe(
      "Hora Extra (R$611,80, das 11:00 às 13:00, de segunda a sexta-feira), Almoço (R$401,50, de segunda a sexta-feira) e Lanche da Tarde (R$334,45, de segunda a sexta-feira)",
    );
    expect(r.valorMensal).toBe(1347.75);
    expect(r.avisos).toEqual([]);
    expect(r.lista).not.toContain("18:20");
  });

  it("texto final do parágrafo EXTRAS do contrato do Gabriel", () => {
    const extras = detalharExtrasContrato(
      extrasGabriel,
      plano({
        refeicoes: { breakfast: [], lunch: SEG_SEX, snack: SEG_SEX, dinner: [] },
        horarios: horariosIguais("11:00", "18:20"),
      }),
    );
    const doc = montarContratoMatricula(inputBase({ extras }));
    const p = doc.paragrafos.find((x) => x.texto.startsWith("EXTRAS:"));
    expect(p?.texto).toBe(
      "EXTRAS: Hora Extra (R$611,80, das 11:00 às 13:00, de segunda a sexta-feira), Almoço (R$401,50, de segunda a sexta-feira) e Lanche da Tarde (R$334,45, de segunda a sexta-feira), no valor mensal total de R$1.347,75, cobrados juntamente com a mensalidade, enquanto vigente a contratação de cada serviço.",
    );
  });

  it("dias parciais na refeição", () => {
    const r = detalharExtrasContrato(
      extrasDoContrato([titulo("Almoço", 200)], ANO),
      plano({ refeicoes: { breakfast: [], lunch: [1, 3, 5], snack: [], dinner: [] } }),
    );
    expect(r.lista).toBe("Almoço (R$200,00, segunda-feira, quarta-feira e sexta-feira)");
    expect(r.avisos).toEqual([]);
  });

  it("sem plano no Diário: itens só com nome e valor + aviso; total intacto", () => {
    const r = detalharExtrasContrato(
      extrasGabriel,
      null,
      "Aluno sem vínculo com o Sponte no Diário.",
    );
    expect(r.lista).toBe("Hora Extra (R$611,80), Almoço (R$401,50) e Lanche da Tarde (R$334,45)");
    expect(r.valorMensal).toBe(1347.75);
    expect(r.avisos).toEqual(["Aluno sem vínculo com o Sponte no Diário."]);
  });

  it("sem student_routine do ano (turno desconhecido): Hora Extra sem horário, refeições detalhadas", () => {
    const r = detalharExtrasContrato(
      extrasGabriel,
      plano({
        refeicoes: { breakfast: [], lunch: SEG_SEX, snack: SEG_SEX, dinner: [] },
        horarios: horariosIguais("11:00", "18:20"),
        turnoRegular: null,
      }),
    );
    expect(r.lista).toBe(
      "Hora Extra (R$611,80), Almoço (R$401,50, de segunda a sexta-feira) e Lanche da Tarde (R$334,45, de segunda a sexta-feira)",
    );
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/Turno regular do aluno desconhecido/);
  });

  it("Hora Extra cobrada no Sponte com horário dentro do turno → valor sem horário + aviso", () => {
    const r = detalharExtrasContrato(
      extrasDoContrato([titulo("Hora Extra", 611.8)], ANO),
      plano({ horarios: horariosIguais("13:00", "18:20") }),
    );
    expect(r.lista).toBe("Hora Extra (R$611,80)");
    expect(r.avisos).toEqual([
      "Hora Extra cobrada no Sponte, mas o horário registrado no Diário fica dentro do turno regular.",
    ]);
  });

  it("refeição cobrada no Sponte sem dias no Diário → valor sem dias + aviso", () => {
    const r = detalharExtrasContrato(extrasDoContrato([titulo("Jantar", 150)], ANO), plano());
    expect(r.lista).toBe("Jantar (R$150,00)");
    expect(r.avisos).toEqual([
      "Jantar cobrado no Sponte, mas sem dias marcados no plano do Diário.",
    ]);
  });

  it("serviço no Diário sem cobrança no Sponte → aviso, sem inventar valor", () => {
    const r = detalharExtrasContrato(
      extrasDoContrato([titulo("Almoço", 200)], ANO),
      plano({
        refeicoes: { breakfast: [1], lunch: SEG_SEX, snack: [], dinner: [] },
        horarios: horariosIguais("11:00", "18:20"),
      }),
    );
    expect(r.lista).toBe("Almoço (R$200,00, de segunda a sexta-feira)");
    expect(r.avisos).toEqual([
      "Diário registra Hora Extra (das 11:00 às 13:00, de segunda a sexta-feira), mas não há cobrança de Hora Extra no Sponte para o ano do contrato.",
      "Diário marca Lanche da Manhã (segunda-feira), mas não há cobrança de Lanche da Manhã no Sponte para o ano do contrato.",
    ]);
  });

  it("sem extras no Sponte mantém o texto de fallback", () => {
    const r = detalharExtrasContrato(extrasDoContrato([], ANO), plano());
    expect(r.lista).toBe(TEXTO_SEM_EXTRAS);
    expect(r.avisos).toEqual([]);
  });
});

function inputBase(over: Partial<MontarContratoInput>): MontarContratoInput {
  return {
    numeroContrato: "2027-NVS-172",
    anoLetivo: ANO,
    colegio: {
      unidade: "Núcleo Vale do Sereno",
      razaoSocial: "Colégio X Ltda",
      nomeFantasia: "Colégio X",
      cnpj: "00.000.000/0001-00",
      endereco: "Rua A",
      numero: "1",
      complemento: "",
      bairro: "Centro",
      cidade: "Belo Horizonte",
      uf: "MG",
      cep: "30000-000",
      email: "x@x.com",
      representanteNome: "Rep",
      representanteCpf: "000.000.000-00",
      representanteEmail: "rep@x.com",
      representanteCelular: "(31) 99999-9999",
    },
    responsavel: {
      nome: "Resp",
      cpf: "111.111.111-11",
      email: "resp@x.com",
      telefone: "(31) 98888-8888",
      endereco: "Rua B",
      numero: "2",
      complemento: "",
      bairro: "Bairro",
      cidade: "Belo Horizonte",
      uf: "MG",
      cep: "30000-001",
    },
    alunoNome: "Gabriel Ferreira Teixeira Bautto",
    serie: "1º Ano",
    matricula: { valor: 1000, parcelas: 1, primeiroVencimento: "2026-10-10" },
    mensalidade: {
      valor: 2000,
      descontoPercentual: 0,
      vencimento: "2027-02-10",
      totalParcelas: 11,
      primeiroMes: "fevereiro",
      ultimoMes: "dezembro",
    },
    material: null,
    extras: extrasDoContrato([], ANO),
    testemunhas: [],
    hojeISO: "2026-09-14",
    ...over,
  };
}
