// Domínio do módulo "Diário do Aluno" (integração do School Connect).
// Tipos, constantes e helpers de plano/horário reaproveitados pelas telas.

export type MealKey = "breakfast" | "lunch" | "snack" | "dinner";
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type MealPlan = Record<MealKey, Weekday[]>;
export type DaySchedule = { entry: string; exit: string } | null;
export type SchedulePlan = Record<Weekday, DaySchedule>;

export type DiarioStudent = {
  id: string;
  name: string;
  className: string;
  classId: string | null;
  schoolId: string;
  photo: string | null;
  plan: MealPlan;
  schedule: SchedulePlan;
};

export type DiarioClass = {
  id: string;
  name: string;
  school_id: string;
};

export const MEALS: { key: MealKey; label: string }[] = [
  { key: "breakfast", label: "Lanche da Manhã" },
  { key: "lunch", label: "Almoço" },
  { key: "snack", label: "Lanche da Tarde" },
  { key: "dinner", label: "Jantar" },
];

export const MEAL_LABEL: Record<MealKey, string> = {
  breakfast: "Lanche da Manhã",
  lunch: "Almoço",
  snack: "Lanche da Tarde",
  dinner: "Jantar",
};

export const WEEKDAYS: { value: Weekday; short: string; long: string }[] = [
  { value: 1, short: "Seg", long: "Segunda" },
  { value: 2, short: "Ter", long: "Terça" },
  { value: 3, short: "Qua", long: "Quarta" },
  { value: 4, short: "Qui", long: "Quinta" },
  { value: 5, short: "Sex", long: "Sexta" },
];

export function emptyPlan(): MealPlan {
  return { breakfast: [], lunch: [], snack: [], dinner: [] };
}

export function emptySchedule(): SchedulePlan {
  return { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
}

export const DEFAULT_DAY: DaySchedule = { entry: "07:30", exit: "17:30" };

// Uma refeição está coberta hoje se o dia da semana atual estiver no plano.
export function isCoveredToday(plan: MealPlan, meal: MealKey, today = new Date()): boolean {
  return plan[meal].includes(today.getDay() as Weekday);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function checkSchedule(
  schedule: SchedulePlan,
  now = new Date(),
): { withinSchedule: boolean; hasSchedule: boolean; today: DaySchedule } {
  const today = schedule[now.getDay() as Weekday];
  if (!today) return { withinSchedule: false, hasSchedule: false, today: null };
  const cur = now.getHours() * 60 + now.getMinutes();
  const within = cur >= toMinutes(today.entry) && cur <= toMinutes(today.exit);
  return { withinSchedule: within, hasSchedule: true, today };
}
