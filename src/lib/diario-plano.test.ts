import { describe, expect, it } from "vitest";
import {
  emptyPlan,
  fetchAllRows,
  groupMealPlans,
  groupSchedules,
  isCoveredToday,
  mealPlanToRows,
  scheduleToRows,
  type MealPlan,
  type MealPlanRow,
  type Weekday,
} from "./diario";

const ALUNO = "aluno-a";
const SEG_A_SEX: Weekday[] = [1, 2, 3, 4, 5];
const quarta = new Date(2026, 8, 2, 10, 0); // 02/09/2026 (quarta-feira)
const sabado = new Date(2026, 8, 5, 10, 0);

function salvarELer(studentId: string, plan: MealPlan): MealPlan {
  const rows = mealPlanToRows(studentId, plan);
  return groupMealPlans(rows).get(studentId) ?? emptyPlan();
}

describe("plano de refeições — salvar e ler de volta (com plano vs sem plano)", () => {
  it("refeição/dia salvo volta como 'com plano'; não salvo segue 'sem plano' (cobrança extra)", () => {
    const lido = salvarELer(ALUNO, {
      breakfast: SEG_A_SEX,
      lunch: SEG_A_SEX,
      snack: SEG_A_SEX,
      dinner: SEG_A_SEX,
    });
    for (const meal of ["breakfast", "lunch", "snack", "dinner"] as const) {
      expect(isCoveredToday(lido, meal, quarta)).toBe(true);
      expect(isCoveredToday(lido, meal, sabado)).toBe(false);
    }
  });

  it("refeição não marcada fica 'sem plano' mesmo com outras marcadas no mesmo dia", () => {
    const lido = salvarELer(ALUNO, { ...emptyPlan(), lunch: [3] });
    expect(isCoveredToday(lido, "lunch", quarta)).toBe(true);
    expect(isCoveredToday(lido, "breakfast", quarta)).toBe(false);
    expect(isCoveredToday(lido, "dinner", quarta)).toBe(false);
  });

  it("plano vazio não gera linhas e lê como 'sem plano' em tudo", () => {
    expect(mealPlanToRows(ALUNO, emptyPlan())).toEqual([]);
    const lido = salvarELer(ALUNO, emptyPlan());
    expect(isCoveredToday(lido, "lunch", quarta)).toBe(false);
  });

  it("linhas de outro aluno não vazam para o plano lido", () => {
    const rows = [
      ...mealPlanToRows("aluno-b", { ...emptyPlan(), dinner: [3] }),
      ...mealPlanToRows(ALUNO, { ...emptyPlan(), lunch: [3] }),
    ];
    const porAluno = groupMealPlans(rows);
    expect(isCoveredToday(porAluno.get(ALUNO)!, "dinner", quarta)).toBe(false);
    expect(isCoveredToday(porAluno.get("aluno-b")!, "dinner", quarta)).toBe(true);
    expect(porAluno.get("aluno-c")).toBeUndefined();
  });

  it("horários fazem o mesmo round-trip por dia", () => {
    const rows = scheduleToRows(ALUNO, {
      0: null,
      1: { entry: "07:30", exit: "17:30" },
      2: null,
      3: { entry: "13:00", exit: "18:00" },
      4: null,
      5: null,
      6: null,
    });
    expect(rows).toHaveLength(2);
    const lido = groupSchedules(rows).get(ALUNO)!;
    expect(lido[3]).toEqual({ entry: "13:00", exit: "18:00" });
    expect(lido[2]).toBeNull();
  });
});

describe("fetchAllRows — leitura além do teto de 1000 linhas do PostgREST", () => {
  // Cenário real: 133 alunos com plano geravam 1283 linhas; a leitura sem
  // paginação descartava as últimas 283 (exatamente as recém-salvas), e a tela
  // mostrava "SEM PLANO · COBRANÇA EXTRA" para planos que estavam no banco.
  function banco(qtdAlunos: number): MealPlanRow[] {
    const rows: MealPlanRow[] = [];
    for (let i = 0; i < qtdAlunos; i++) {
      rows.push(
        ...mealPlanToRows(`aluno-${i}`, {
          breakfast: SEG_A_SEX,
          lunch: SEG_A_SEX,
          snack: [],
          dinner: [],
        }),
      );
    }
    return rows;
  }

  it("o último aluno salvo (além da linha 1000) lê como 'com plano'", async () => {
    const todas = banco(130); // 1300 linhas
    const paginas: number[] = [];
    const lidas = await fetchAllRows<MealPlanRow>(async (from, to) => {
      paginas.push(from);
      return { data: todas.slice(from, to + 1), error: null };
    });
    expect(lidas).toHaveLength(1300);
    expect(paginas).toEqual([0, 1000]);
    const ultimo = groupMealPlans(lidas).get("aluno-129")!;
    expect(isCoveredToday(ultimo, "lunch", quarta)).toBe(true);
  });

  it("sem paginação, o mesmo aluno apareceria 'sem plano' (regressão)", () => {
    const truncado = banco(130).slice(0, 1000);
    expect(groupMealPlans(truncado).get("aluno-129")).toBeUndefined();
  });

  it("para exatamente no múltiplo do tamanho da página", async () => {
    const todas = banco(100); // 1000 linhas
    let chamadas = 0;
    const lidas = await fetchAllRows<MealPlanRow>(async (from, to) => {
      chamadas++;
      return { data: todas.slice(from, to + 1), error: null };
    });
    expect(lidas).toHaveLength(1000);
    expect(chamadas).toBe(2);
  });

  it("propaga erro da página em vez de devolver lista parcial", async () => {
    await expect(
      fetchAllRows<MealPlanRow>(async () => ({ data: null, error: new Error("RLS") })),
    ).rejects.toThrow("RLS");
  });
});
