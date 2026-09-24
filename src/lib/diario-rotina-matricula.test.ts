import { describe, expect, it } from "vitest";
import {
  comPlanoAposAplicar,
  planejarRotinasNoDiario,
  type RotinaMatriculaRow,
} from "@/lib/diario-rotina-matricula";
import type { RotinaPersistida } from "@/lib/matricula-form";

const rotinaSegASex: RotinaPersistida = {
  dataInicio: "2027-02-01",
  diasAtivos: [1, 2, 3, 4, 5],
  periodoManha: false,
  periodoTarde: false,
  horarioEstendido: true,
  horarioCurricular: "T",
  horarios: [1, 2, 3, 4, 5].map((d) => ({
    weekday: d as 1 | 2 | 3 | 4 | 5,
    entrada: "07:30",
    saida: "17:30",
  })),
  semRefeicoes: false,
  refeicoes: {
    breakfast: [1, 2, 3, 4, 5],
    lunch: [1, 2, 3, 4, 5],
    snack: [1, 2, 3, 4, 5],
    dinner: [],
  },
};

const rotina: RotinaMatriculaRow = {
  schoolId: "cec",
  sponteAlunoId: "707",
  anoLetivo: 2027,
  alunoNome: "Gabriel Santana Vieira",
  dados: rotinaSegASex,
};
const aluno = { studentId: "st-1", schoolId: "cec", sponteAlunoId: "707" };

describe("rotina do formulário de matrícula no Diário", () => {
  it("converte seg a sex com três refeições em 5 horários e 15 refeições", () => {
    const plano = planejarRotinasNoDiario(2027, [aluno], new Set(), [rotina]);
    expect(plano).toHaveLength(1);
    expect(plano[0].horarios).toHaveLength(5);
    expect(plano[0].horarios[0]).toEqual({
      student_id: "st-1",
      weekday: 1,
      entry: "07:30",
      exit: "17:30",
      ano_letivo: 2027,
    });
    expect(plano[0].refeicoes).toHaveLength(15);
    expect(plano[0].refeicoes.every((r) => r.ano_letivo === 2027)).toBe(true);
    expect(plano[0].refeicoes.some((r) => r.meal === "dinner")).toBe(false);
  });

  it("não duplica ao rodar duas vezes: a 2ª rodada não grava nada", () => {
    const primeira = planejarRotinasNoDiario(2027, [aluno], new Set(), [rotina]);
    const comPlano = comPlanoAposAplicar(new Set(), primeira);
    const segunda = planejarRotinasNoDiario(2027, [aluno], comPlano, [rotina]);
    expect(primeira).toHaveLength(1);
    expect(segunda).toEqual([]);
  });

  it("nunca sobrescreve plano já existente ou editado manualmente", () => {
    expect(planejarRotinasNoDiario(2027, [aluno], new Set(["st-1"]), [rotina])).toEqual([]);
  });

  it("ignora rotina de outro ano, de outra unidade e rotina vazia", () => {
    expect(planejarRotinasNoDiario(2026, [aluno], new Set(), [rotina])).toEqual([]);
    expect(
      planejarRotinasNoDiario(2027, [aluno], new Set(), [{ ...rotina, schoolId: "baby" }]),
    ).toEqual([]);
    const vazia: RotinaMatriculaRow = {
      ...rotina,
      dados: {
        ...rotinaSegASex,
        horarios: [],
        semRefeicoes: true,
        refeicoes: { breakfast: [], lunch: [], snack: [], dinner: [] },
      },
    };
    expect(planejarRotinasNoDiario(2027, [aluno], new Set(), [vazia])).toEqual([]);
  });
});
