// Rotina do formulário de matrícula → Diário do Aluno.
//
// O formulário grava a rotina só em `student_routine`; o aluno entra no Diário
// pela sincronização com o Sponte. Ao final dessa sincronização, cada aluno do
// Diário SEM plano no ano letivo recebe a rotina de matrícula do mesmo
// sponte_aluno_id e ano. Plano existente (inclusive editado à mão) nunca é
// tocado — por isso rodar duas vezes não duplica nada.

import { linhasDiarioDaRotina, type RotinaPersistida } from "@/lib/matricula-form";
import type { MealPlanRow, ScheduleRow } from "@/lib/diario";

export interface AlunoDiarioRotina {
  studentId: string;
  schoolId: string;
  sponteAlunoId: string;
}

export interface RotinaMatriculaRow {
  schoolId: string;
  sponteAlunoId: string;
  anoLetivo: number;
  alunoNome: string;
  dados: RotinaPersistida;
}

export interface AplicacaoRotina {
  studentId: string;
  schoolId: string;
  sponteAlunoId: string;
  alunoNome: string;
  refeicoes: MealPlanRow[];
  horarios: ScheduleRow[];
}

/**
 * Decide o que gravar: só alunos sem NENHUMA linha (refeição ou horário) no
 * ano e com rotina de matrícula do mesmo ano. Rotina vazia não gera nada.
 */
export function planejarRotinasNoDiario(
  anoLetivo: number,
  alunos: AlunoDiarioRotina[],
  comPlanoNoAno: ReadonlySet<string>,
  rotinas: RotinaMatriculaRow[],
): AplicacaoRotina[] {
  const rotinaPorChave = new Map<string, RotinaMatriculaRow>();
  for (const r of rotinas) {
    if (r.anoLetivo !== anoLetivo) continue;
    rotinaPorChave.set(`${r.schoolId}::${r.sponteAlunoId}`, r);
  }
  const saida: AplicacaoRotina[] = [];
  for (const a of alunos) {
    if (comPlanoNoAno.has(a.studentId)) continue;
    const r = rotinaPorChave.get(`${a.schoolId}::${a.sponteAlunoId}`);
    if (!r) continue;
    const { refeicoes, horarios } = linhasDiarioDaRotina(a.studentId, anoLetivo, r.dados);
    if (refeicoes.length === 0 && horarios.length === 0) continue;
    saida.push({
      studentId: a.studentId,
      schoolId: a.schoolId,
      sponteAlunoId: a.sponteAlunoId,
      alunoNome: r.alunoNome,
      refeicoes,
      horarios,
    });
  }
  return saida;
}

/** Simula a 2ª rodada: quem acabou de receber plano passa a ter plano no ano. */
export function comPlanoAposAplicar(
  antes: ReadonlySet<string>,
  aplicadas: AplicacaoRotina[],
): Set<string> {
  const depois = new Set(antes);
  for (const a of aplicadas) depois.add(a.studentId);
  return depois;
}
