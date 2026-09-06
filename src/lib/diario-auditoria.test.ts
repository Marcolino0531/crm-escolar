import { describe, expect, it } from "vitest";
import { emptyPlan, emptySchedule, type MealPlan, type SchedulePlan } from "@/lib/diario";
import {
  categoriasAtivas,
  itensSemLancamento,
  ordenarInconsistencias,
  segmentoDaTurma,
  temHorarioEstendido,
  temPlanoAtivo,
} from "@/lib/diario-auditoria";

const SEG_A_SEX = [1, 2, 3, 4, 5] as const;

function titulo(categoria: string, vencimento = "2026-09-10", situacao = "Pendente") {
  return { categoria, vencimento, situacao };
}

function horario(dias: Partial<SchedulePlan>): SchedulePlan {
  return { ...emptySchedule(), ...dias };
}

const isabela: MealPlan = { ...emptyPlan(), lunch: [...SEG_A_SEX], dinner: [...SEG_A_SEX] };
const estendidoTarde = horario({
  1: { entry: "13:00", exit: "19:00" },
  2: { entry: "13:00", exit: "19:00" },
});
const tardePadraoInfantil = horario({ 1: { entry: "13:00", exit: "17:30" } });

describe("categoriasAtivas", () => {
  it("considera só parcelas não canceladas vencendo no ano auditado", () => {
    const ativas = categoriasAtivas(
      [
        titulo("Almoço"),
        titulo("Jantar", "2026-10-10", "Quitada"),
        titulo("Lanche da Tarde", "2026-08-10", "Cancelada"),
        titulo("Hora Extra", "2025-12-10"),
      ],
      2026,
    );
    expect(ativas).toEqual(new Set(["almoco", "jantar"]));
  });
});

describe("itensSemLancamento — categoria a categoria", () => {
  const base = { schedule: emptySchedule(), segmento: "infantil" as const };

  it("referência correta (Isabela): Almoço, Jantar e Hora Extra lançados → sem inconsistência", () => {
    const ativas = categoriasAtivas(
      ["Mensalidade", "Hora Extra", "Almoço", "Jantar", "Material Pedagógico"].map((c) =>
        titulo(c),
      ),
      2026,
    );
    expect(
      itensSemLancamento({
        plan: isabela,
        schedule: estendidoTarde,
        segmento: "infantil",
        categoriasAtivas: ativas,
      }),
    ).toEqual([]);
  });

  it.each([
    ["breakfast", "Lanche da Manhã"],
    ["lunch", "Almoço"],
    ["snack", "Lanche da Tarde"],
    ["dinner", "Jantar"],
  ] as const)("%s contratado sem parcela → acusa exatamente '%s'", (meal, categoria) => {
    const plan = { ...emptyPlan(), [meal]: [3] } as MealPlan;
    const semNada = itensSemLancamento({ ...base, plan, categoriasAtivas: new Set() });
    expect(semNada).toEqual([`${categoria} sem categoria correspondente no Sponte`]);

    const comParcela = itensSemLancamento({
      ...base,
      plan,
      categoriasAtivas: categoriasAtivas([titulo(categoria)], 2026),
    });
    expect(comParcela).toEqual([]);
  });

  it("acusa só as refeições faltantes quando o plano tem várias", () => {
    const plan: MealPlan = { ...emptyPlan(), breakfast: [1], lunch: [1], snack: [1], dinner: [1] };
    const ativas = categoriasAtivas([titulo("Almoço"), titulo("Jantar")], 2026);
    expect(itensSemLancamento({ ...base, plan, categoriasAtivas: ativas })).toEqual([
      "Lanche da Manhã sem categoria correspondente no Sponte",
      "Lanche da Tarde sem categoria correspondente no Sponte",
    ]);
  });

  it("casa a categoria ignorando acento e caixa", () => {
    const plan: MealPlan = { ...emptyPlan(), breakfast: [1] };
    const ativas = categoriasAtivas([titulo("LANCHE DA MANHA")], 2026);
    expect(itensSemLancamento({ ...base, plan, categoriasAtivas: ativas })).toEqual([]);
  });

  it("parcela cancelada não conta como lançamento", () => {
    const plan: MealPlan = { ...emptyPlan(), lunch: [1] };
    const ativas = categoriasAtivas([titulo("Almoço", "2026-09-10", "Cancelada")], 2026);
    expect(itensSemLancamento({ ...base, plan, categoriasAtivas: ativas })).toHaveLength(1);
  });
});

describe("Horário Estendido × Hora Extra", () => {
  it("horário dentro do período base não exige Hora Extra", () => {
    expect(temHorarioEstendido(tardePadraoInfantil, "infantil")).toBe(false);
    expect(
      temHorarioEstendido(horario({ 1: { entry: "07:20", exit: "12:40" } }), "fundamental"),
    ).toBe(false);
    expect(
      itensSemLancamento({
        plan: emptyPlan(),
        schedule: tardePadraoInfantil,
        segmento: "infantil",
        categoriasAtivas: new Set(),
      }),
    ).toEqual([]);
  });

  it("saída depois do período base é estendido e exige Hora Extra", () => {
    expect(temHorarioEstendido(estendidoTarde, "infantil")).toBe(true);
    expect(
      itensSemLancamento({
        plan: emptyPlan(),
        schedule: estendidoTarde,
        segmento: "infantil",
        categoriasAtivas: new Set(),
      }),
    ).toEqual(["Horário Estendido sem Hora Extra lançada"]);
    expect(
      itensSemLancamento({
        plan: emptyPlan(),
        schedule: estendidoTarde,
        segmento: "infantil",
        categoriasAtivas: categoriasAtivas([titulo("Hora Extra")], 2026),
      }),
    ).toEqual([]);
  });

  it("entrada de manhã e saída à tarde (integral) é estendido", () => {
    expect(
      temHorarioEstendido(horario({ 2: { entry: "07:20", exit: "18:20" } }), "fundamental"),
    ).toBe(true);
  });

  it("base do Infantil termina mais cedo: 12:40 é estendido no Infantil, não no Fundamental", () => {
    const s = horario({ 1: { entry: "07:20", exit: "12:40" } });
    expect(temHorarioEstendido(s, "infantil")).toBe(true);
    expect(temHorarioEstendido(s, "fundamental")).toBe(false);
  });

  it("segmento pela turma do Diário", () => {
    expect(segmentoDaTurma("04 - Maternal 3 T/A")).toBe("infantil");
    expect(segmentoDaTurma("Berçário II")).toBe("infantil");
    expect(segmentoDaTurma("1º Período T/B")).toBe("infantil");
    expect(segmentoDaTurma("3º Ano M/A")).toBe("fundamental");
  });
});

describe("temPlanoAtivo / ordenação", () => {
  it("aluno sem refeição e sem horário não entra na auditoria", () => {
    expect(temPlanoAtivo(emptyPlan(), emptySchedule())).toBe(false);
    expect(temPlanoAtivo({ ...emptyPlan(), lunch: [1] }, emptySchedule())).toBe(true);
    expect(temPlanoAtivo(emptyPlan(), tardePadraoInfantil)).toBe(true);
  });

  it("ordena por turma e nome", () => {
    const linha = (turma: string, aluno: string) => ({
      studentId: aluno,
      aluno,
      turma,
      unidade: "CEC",
      itens: ["x"],
    });
    expect(
      ordenarInconsistencias([
        linha("2º Ano", "Zé"),
        linha("1º Ano", "Bia"),
        linha("1º Ano", "Ana"),
      ]).map((l) => l.aluno),
    ).toEqual(["Ana", "Bia", "Zé"]);
  });
});
