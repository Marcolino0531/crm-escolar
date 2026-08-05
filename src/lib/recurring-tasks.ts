// Lógica pura do Planner de tarefas recorrentes (módulo Tasks).
//
// A recorrência é DERIVADA: uma rotina define um dia do mês e, para cada mês,
// gera-se uma ocorrência nesse dia. Quando o dia configurado não existe no mês
// (ex.: dia 31 em fevereiro), ele é "grampeado" para o último dia do mês.
//
// O status de uma ocorrência é por mês: uma linha em recurring_task_completions
// marca aquele mês como cumprido; a ausência dela significa pendente. Por isso
// marcar cumprida em um mês não afeta o mês seguinte.
//
// A rotina só gera ocorrências a partir de start_month (inclusive): nunca em
// meses anteriores à sua criação. Se o dia configurado já passou no mês da
// criação, start_month é o mês seguinte (a 1ª ocorrência não nasce "vencida").

export type RecurringTaskDef = {
  id: string;
  title: string;
  description: string | null;
  day_of_month: number;
  // Primeiro mês (YYYY-MM) em que a rotina passa a ocorrer.
  start_month: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Número de dias do mês. `month0` é 0-indexado (0 = janeiro).
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

// Dia real da ocorrência no mês, grampeando ao último dia quando o dia
// configurado excede o tamanho do mês (ex.: 31 em fevereiro → 28/29).
export function resolveOccurrenceDay(year: number, month0: number, dayOfMonth: number): number {
  const dim = daysInMonth(year, month0);
  const raw = Math.trunc(Number(dayOfMonth) || 1);
  return Math.min(Math.max(raw, 1), dim);
}

// Data ISO (YYYY-MM-DD) da ocorrência da rotina no mês informado.
export function resolveOccurrenceDate(year: number, month0: number, dayOfMonth: number): string {
  const day = resolveOccurrenceDay(year, month0, dayOfMonth);
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

// Chave do mês (YYYY-MM) usada para marcar/consultar cumprimento por mês.
export function monthKey(year: number, month0: number): string {
  return `${year}-${pad2(month0 + 1)}`;
}

// Primeiro mês (YYYY-MM) em que a rotina deve ocorrer, dado o dia do mês e a
// data de criação: o próprio mês se o dia ainda não passou (hoje <= ocorrência),
// senão o mês seguinte — evitando gerar uma ocorrência já vencida na criação.
export function firstOccurrenceMonthKey(todayISO: string, dayOfMonth: number): string {
  const year = Number(todayISO.slice(0, 4));
  const month0 = Number(todayISO.slice(5, 7)) - 1;
  const occ = resolveOccurrenceDate(year, month0, dayOfMonth);
  if (todayISO <= occ) return monthKey(year, month0);
  const next = new Date(year, month0 + 1, 1);
  return monthKey(next.getFullYear(), next.getMonth());
}

// A rotina ocorre no mês `mk` (YYYY-MM)? Só a partir de start_month (inclusive).
export function occursInMonth(def: RecurringTaskDef, mk: string): boolean {
  return mk >= def.start_month;
}

// Mês (YYYY-MM) de uma data ISO (YYYY-MM-DD).
export function monthKeyOfISO(iso: string): string {
  return iso.slice(0, 7);
}

// Chave única de cumprimento (rotina + mês).
export function completedKey(defId: string, mk: string): string {
  return `${defId}:${mk}`;
}

export type OccurrenceStatus = "cumprida" | "vencida" | "futura";

// Status da ocorrência de um mês: cumprida (marcada), vencida (data já chegou e
// não cumprida) ou futura (a data ainda não chegou).
export function occurrenceStatus(
  occurrenceDate: string,
  completed: boolean,
  todayISO: string,
): OccurrenceStatus {
  if (completed) return "cumprida";
  return todayISO >= occurrenceDate ? "vencida" : "futura";
}

export type DueOccurrence = {
  def: RecurringTaskDef;
  date: string;
  monthKey: string;
};

// Ocorrências VENCIDAS e ainda PENDENTES do mês corrente (base do aviso e do
// contador). "Vencida" = a data configurada já chegou (today >= data) e não há
// marca de cumprimento para aquele mês. Ordenadas por data e título.
export function dueOccurrences(
  defs: RecurringTaskDef[],
  completed: Set<string>,
  todayISO: string,
): DueOccurrence[] {
  const year = Number(todayISO.slice(0, 4));
  const month0 = Number(todayISO.slice(5, 7)) - 1;
  const mk = monthKey(year, month0);
  const out: DueOccurrence[] = [];
  for (const def of defs) {
    if (!occursInMonth(def, mk)) continue;
    const date = resolveOccurrenceDate(year, month0, def.day_of_month);
    if (todayISO >= date && !completed.has(completedKey(def.id, mk))) {
      out.push({ def, date, monthKey: mk });
    }
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.def.title.localeCompare(b.def.title, "pt-BR"),
  );
}

// Quantidade de rotinas vencidas e pendentes no mês corrente (usada no badge).
export function countDuePending(
  defs: RecurringTaskDef[],
  completed: Set<string>,
  todayISO: string,
): number {
  return dueOccurrences(defs, completed, todayISO).length;
}
