// Auditoria Plano do Diário do Aluno × lançamentos do Sponte (lógica pura).
//
// Cada refeição marcada como "PLANO CONTRATADO" no Diário precisa de uma
// parcela ativa no Sponte com a categoria de mesmo nome; Horário Estendido
// (fora do horário base do segmento) precisa da categoria "Hora Extra".
// Só as ausências viram inconsistência: aluno sem pendência não é listado.

import type { MealKey, MealPlan, SchedulePlan, Weekday } from "@/lib/diario";
import { HORARIOS_PADRAO, type SegmentoSerie } from "@/lib/matricula-form";

export const CATEGORIA_POR_REFEICAO: Record<MealKey, string> = {
  breakfast: "Lanche da Manhã",
  lunch: "Almoço",
  snack: "Lanche da Tarde",
  dinner: "Jantar",
};

export const CATEGORIA_HORA_EXTRA = "Hora Extra";

const ORDEM_REFEICOES: MealKey[] = ["breakfast", "lunch", "snack", "dinner"];

export interface TituloParaAuditoria {
  categoria: string;
  vencimento: string; // YYYY-MM-DD
  situacao: string;
}

export interface InconsistenciaAluno {
  studentId: string;
  aluno: string;
  turma: string;
  unidade: string;
  itens: string[];
}

export function normalizarCategoria(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Segmento pela turma do Diário ("04 - Maternal 3 T/A", "2º Ano M/B"…):
// Berçário, Maternal e Períodos são Infantil; o resto é Fundamental.
export function segmentoDaTurma(turma: string): SegmentoSerie {
  const t = normalizarCategoria(turma);
  if (t.includes("bercario") || t.includes("maternal") || t.includes("periodo")) {
    return "infantil";
  }
  return "fundamental";
}

// Categorias com parcela ativa (não cancelada) vencendo no ano letivo auditado.
export function categoriasAtivas(
  titulos: readonly TituloParaAuditoria[],
  anoLetivo: number,
): Set<string> {
  const ativas = new Set<string>();
  for (const t of titulos) {
    if (normalizarCategoria(t.situacao) === "cancelada") continue;
    if (!t.vencimento.startsWith(`${anoLetivo}-`)) continue;
    ativas.add(normalizarCategoria(t.categoria));
  }
  return ativas;
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function dentroDaJanela(entry: string, exit: string, base: { entrada: string; saida: string }) {
  return minutos(entry) >= minutos(base.entrada) && minutos(exit) <= minutos(base.saida);
}

// Horário Estendido = algum dia com entrada/saída fora do horário base de
// Manhã e de Tarde do segmento.
export function temHorarioEstendido(schedule: SchedulePlan, segmento: SegmentoSerie): boolean {
  const base = HORARIOS_PADRAO[segmento];
  return (Object.keys(schedule).map(Number) as Weekday[]).some((weekday) => {
    const dia = schedule[weekday];
    if (!dia || !dia.entry || !dia.exit) return false;
    return (
      !dentroDaJanela(dia.entry, dia.exit, base.manha) &&
      !dentroDaJanela(dia.entry, dia.exit, base.tarde)
    );
  });
}

export function itensSemLancamento(entrada: {
  plan: MealPlan;
  schedule: SchedulePlan;
  segmento: SegmentoSerie;
  categoriasAtivas: ReadonlySet<string>;
}): string[] {
  const itens: string[] = [];
  for (const meal of ORDEM_REFEICOES) {
    if (entrada.plan[meal].length === 0) continue;
    const categoria = CATEGORIA_POR_REFEICAO[meal];
    if (!entrada.categoriasAtivas.has(normalizarCategoria(categoria))) {
      itens.push(`${categoria} sem categoria correspondente no Sponte`);
    }
  }
  if (
    temHorarioEstendido(entrada.schedule, entrada.segmento) &&
    !entrada.categoriasAtivas.has(normalizarCategoria(CATEGORIA_HORA_EXTRA))
  ) {
    itens.push(`Horário Estendido sem ${CATEGORIA_HORA_EXTRA} lançada`);
  }
  return itens;
}

// Aluno sem plano e sem horário não tem o que auditar.
export function temPlanoAtivo(plan: MealPlan, schedule: SchedulePlan): boolean {
  return (
    ORDEM_REFEICOES.some((m) => plan[m].length > 0) ||
    Object.values(schedule).some((d) => d && d.entry && d.exit)
  );
}

export function ordenarInconsistencias(linhas: InconsistenciaAluno[]): InconsistenciaAluno[] {
  return [...linhas].sort(
    (a, b) => a.turma.localeCompare(b.turma, "pt-BR") || a.aluno.localeCompare(b.aluno, "pt-BR"),
  );
}
