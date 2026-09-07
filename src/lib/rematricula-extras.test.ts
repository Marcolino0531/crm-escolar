import { describe, expect, it } from "vitest";
import { emptyPlan, emptySchedule, type SchedulePlan } from "@/lib/diario";
import {
  categoriasDoDiario,
  divergenciasExtras,
  extrasDoSponteNoAno,
  normalizarSelecaoExtras,
  validarExtrasContraRotinaSalva,
  validarRotinaExtras,
} from "@/lib/rematricula-extras";
import { ROTINA_FORM_VAZIA, refeicoesVazias, type RotinaForm } from "@/lib/matricula-form";

function parcela(categoria: string, vencimento: string, valor: number, situacao = "Pendente") {
  return { categoria, vencimento, valor, situacao };
}

// Recorrência mensal como o Sponte devolve: fev–dez do ano letivo.
function recorrente(categoria: string, ano: number, valor: number) {
  return Array.from({ length: 11 }, (_, i) =>
    parcela(categoria, `${ano}-${String(i + 2).padStart(2, "0")}-10`, valor),
  );
}

// Caso real de referência: Ryan Kleber (CEC) com Mensalidade + Almoço + Lanche da
// Tarde já lançados para 2027, além das parcelas de 2026 ainda em aberto.
const ryan2027 = [
  ...recorrente("Mensalidade", 2027, 2134.25),
  ...recorrente("Almoço", 2027, 100),
  ...recorrente("Lanche da Tarde", 2027, 150),
  ...recorrente("Mensalidade", 2026, 1980),
  ...recorrente("Almoço", 2026, 92.5),
];

describe("extrasDoSponteNoAno", () => {
  it("Ryan/2027: uma linha por categoria com o valor MENSAL (não a soma das 11 parcelas)", () => {
    expect(extrasDoSponteNoAno(ryan2027, 2027)).toEqual([
      { categoria: "Almoço", valorMensal: 100, parcelas: 11 },
      { categoria: "Lanche da Tarde", valorMensal: 150, parcelas: 11 },
    ]);
  });

  it("filtra pelo ano do vencimento: 2026 não traz Lanche da Tarde e usa o valor de 2026", () => {
    expect(extrasDoSponteNoAno(ryan2027, 2026)).toEqual([
      { categoria: "Almoço", valorMensal: 92.5, parcelas: 11 },
    ]);
  });

  it("ignora canceladas, valor zero e categorias que não são extras", () => {
    expect(
      extrasDoSponteNoAno(
        [
          parcela("Jantar", "2027-03-10", 120, "Cancelada"),
          parcela("Hora Extra", "2027-03-10", 0),
          parcela("Material Pedagógico", "2027-03-10", 300),
          parcela("hora  extra", "2027-04-10", 210.4),
        ],
        2027,
      ),
    ).toEqual([{ categoria: "Hora Extra", valorMensal: 210.4, parcelas: 1 }]);
  });

  it("valor mensal é o da parcela mais cedo do ano quando os valores variam", () => {
    expect(
      extrasDoSponteNoAno(
        [parcela("Almoço", "2027-06-10", 110), parcela("Almoço", "2027-02-10", 100)],
        2027,
      ),
    ).toEqual([{ categoria: "Almoço", valorMensal: 100, parcelas: 2 }]);
  });
});

describe("categoriasDoDiario", () => {
  it("refeições marcadas viram categorias e o horário estendido vira Hora Extra", () => {
    const schedule: SchedulePlan = {
      ...emptySchedule(),
      1: { entry: "07:00", exit: "19:00" },
    };
    expect(
      categoriasDoDiario({
        plan: { ...emptyPlan(), lunch: [1, 2], snack: [1] },
        schedule,
        segmento: "fundamental",
      }),
    ).toEqual(new Set(["Almoço", "Lanche da Tarde", "Hora Extra"]));
  });
});

describe("divergenciasExtras — os três tipos", () => {
  const sponte = extrasDoSponteNoAno(ryan2027, 2027);

  it("remoção pendente: pais do Ryan desmarcaram Lanche da Tarde (R$ 150,00)", () => {
    const d = divergenciasExtras({
      aluno: "Ryan Kleber Braga de Morais",
      sponte,
      selecionadas: ["Almoço"],
      diario: new Set(["Almoço", "Lanche da Tarde"]),
    });
    expect(d).toEqual([
      expect.objectContaining({
        categoria: "Lanche da Tarde",
        tipo: "remocao_pendente",
        valor: 150,
      }),
    ]);
    expect(d[0].mensagem).toContain("cancelar manualmente no Sponte e no Diário do Aluno");
    expect(d[0].mensagem).toContain("R$ 150,00/mês");
  });

  it("lançamento pendente: responsável marcou Jantar, que não existia no Sponte", () => {
    const d = divergenciasExtras({
      aluno: "Ryan Kleber Braga de Morais",
      sponte,
      selecionadas: ["Almoço", "Lanche da Tarde", "Jantar"],
      diario: null,
    });
    expect(d).toEqual([
      expect.objectContaining({ categoria: "Jantar", tipo: "lancamento_pendente", valor: null }),
    ]);
    expect(d[0].mensagem).toContain("lançar manualmente no Sponte e configurar no Diário do Aluno");
  });

  it("inconsistente: Sponte e responsável têm Almoço, mas o Diário do ano não", () => {
    const d = divergenciasExtras({
      aluno: "Ryan",
      sponte,
      selecionadas: ["Almoço", "Lanche da Tarde"],
      diario: new Set(["Lanche da Tarde"]),
    });
    expect(d).toEqual([
      expect.objectContaining({ categoria: "Almoço", tipo: "inconsistente", valor: 100 }),
    ]);
  });

  it("sem plano do Diário para o ano, não há tipo 'inconsistente'; tudo igual → vazio", () => {
    expect(
      divergenciasExtras({
        aluno: "Ryan",
        sponte,
        selecionadas: ["Almoço", "Lanche da Tarde"],
        diario: null,
      }),
    ).toEqual([]);
  });

  it("uma divergência por categoria, na ordem do formulário", () => {
    const d = divergenciasExtras({
      aluno: "Ryan",
      sponte,
      selecionadas: ["Lanche da Manhã", "Lanche da Tarde"],
      diario: new Set(["Almoço"]),
    });
    expect(d.map((x) => [x.categoria, x.tipo])).toEqual([
      ["Lanche da Manhã", "lancamento_pendente"],
      ["Almoço", "remocao_pendente"],
      ["Lanche da Tarde", "inconsistente"],
    ]);
  });
});

describe("normalizarSelecaoExtras", () => {
  it("aceita variações de caixa/acento, descarta repetidas e desconhecidas", () => {
    expect(normalizarSelecaoExtras(["almoco", "ALMOÇO", "Jantar", "Mensalidade"])).toEqual([
      "Almoço",
      "Jantar",
    ]);
  });
});

describe("validarExtrasContraRotinaSalva — extras x rotina gravada no servidor", () => {
  // Caso real: a tela tinha Lanche da Manhã marcado, mas a versão SALVA (a que
  // foi para o Diário) ainda estava com "nenhuma refeição".
  const salvaSemRefeicoes = {
    diasAtivos: [1, 2, 3, 4, 5],
    horarioEstendido: true,
    semRefeicoes: true,
    refeicoes: {},
  };

  it("bloqueia Lanche da Manhã marcado em Extras quando a rotina salva não tem refeição", () => {
    const erros = validarExtrasContraRotinaSalva(
      salvaSemRefeicoes,
      ["Lanche da Manhã", "Hora Extra"],
      "1º Período",
    );
    expect(Object.keys(erros)).toEqual(["extras.Lanche da Manhã"]);
  });

  it("aceita quando a rotina salva tem os dias da refeição e o estendido", () => {
    expect(
      validarExtrasContraRotinaSalva(
        { ...salvaSemRefeicoes, semRefeicoes: false, refeicoes: { breakfast: [1, 2, 3, 4, 5] } },
        ["Lanche da Manhã", "Hora Extra"],
        "1º Período",
      ),
    ).toEqual({});
  });

  it("ignora dias gravados fora dos dias ativos e refeição sem pacote bloqueia", () => {
    const erros = validarExtrasContraRotinaSalva(
      {
        diasAtivos: [2, 4],
        horarioEstendido: false,
        semRefeicoes: false,
        refeicoes: { lunch: [1], snack: [2] },
      },
      [],
      "6º Ano",
    );
    expect(Object.keys(erros)).toEqual(["extras.Lanche da Tarde"]);
  });
});

describe("validarRotinaExtras — rotina x pacotes mensais", () => {
  const base: RotinaForm = { ...ROTINA_FORM_VAZIA, periodoManha: true };

  it("aceita rotina e extras coerentes (Almoço com dias + Hora Extra com estendido)", () => {
    const rotina: RotinaForm = {
      ...base,
      horarioEstendido: true,
      refeicoes: { ...refeicoesVazias(), lunch: [1, 3] },
    };
    expect(validarRotinaExtras(rotina, ["Almoço", "Hora Extra"], "6º Ano")).toEqual({});
  });

  it("extra marcado sem dia na grade bloqueia", () => {
    const erros = validarRotinaExtras(base, ["Almoço"], "6º Ano");
    expect(Object.keys(erros)).toEqual(["extras.Almoço"]);
  });

  it("refeição com dia na grade sem o pacote marcado bloqueia", () => {
    const rotina: RotinaForm = { ...base, refeicoes: { ...refeicoesVazias(), snack: [2] } };
    const erros = validarRotinaExtras(rotina, [], "6º Ano");
    expect(Object.keys(erros)).toEqual(["extras.Lanche da Tarde"]);
  });

  it("horário estendido sem Hora Extra marcada bloqueia, e vice-versa", () => {
    expect(
      Object.keys(validarRotinaExtras({ ...base, horarioEstendido: true }, [], "6º Ano")),
    ).toEqual(["extras.Hora Extra"]);
    expect(Object.keys(validarRotinaExtras(base, ["Hora Extra"], "6º Ano"))).toEqual([
      "extras.Hora Extra",
    ]);
  });

  it("dia marcado fora dos dias ativos (frequência parcial) não conta", () => {
    const rotina: RotinaForm = {
      ...base,
      frequenciaParcial: true,
      diasSelecionados: [1],
      refeicoes: { ...refeicoesVazias(), lunch: [5] },
    };
    expect(validarRotinaExtras(rotina, [], "Maternal 1")).toEqual({});
  });

  it("Jantar fora da oferta da série é ignorado", () => {
    const rotina: RotinaForm = { ...base, refeicoes: { ...refeicoesVazias(), dinner: [1] } };
    expect(validarRotinaExtras(rotina, [], "6º Ano")).toEqual({});
  });
});
