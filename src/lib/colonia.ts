// Domínio do módulo "Colônia de Férias" — serviço avulso (pago por uso).
// Diferente do Diário, NÃO há plano/horário contratado: todos os registros são
// livres e gravam a hora exata do evento. O roster (crianças/turmas) é o mesmo
// já sincronizado do Sponte (diario_students / diario_classes).

export type ColoniaRecordType = "breakfast" | "lunch" | "snack" | "dinner" | "entry" | "exit";

export const COLONIA_MEALS: { key: ColoniaRecordType; label: string }[] = [
  { key: "breakfast", label: "Lanche da Manhã" },
  { key: "lunch", label: "Almoço" },
  { key: "snack", label: "Lanche da Tarde" },
  { key: "dinner", label: "Jantar" },
];

export const COLONIA_GATE: { key: ColoniaRecordType; label: string }[] = [
  { key: "entry", label: "Entrada" },
  { key: "exit", label: "Saída" },
];

export const COLONIA_RECORD_LABEL: Record<ColoniaRecordType, string> = {
  breakfast: "Lanche da Manhã",
  lunch: "Almoço",
  snack: "Lanche da Tarde",
  dinner: "Jantar",
  entry: "Entrada",
  exit: "Saída",
};

// Aluno da Colônia: só os campos necessários para listar/agrupar e registrar.
// (Sem plano/horário — a Colônia não valida contratação.)
export type ColoniaStudent = {
  id: string;
  name: string;
  className: string;
  schoolId: string;
  photo: string | null;
};

// Registro salvo em holiday_camp_records.
export type ColoniaRecord = {
  id: string;
  record_type: ColoniaRecordType;
  occurred_at: string;
};

// Dias úteis (segunda a sexta) usados no Fechamento Semanal. weekday = Date.getDay().
export const COLONIA_WEEKDAYS: { weekday: number; label: string }[] = [
  { weekday: 1, label: "Segunda-feira" },
  { weekday: 2, label: "Terça-feira" },
  { weekday: 3, label: "Quarta-feira" },
  { weekday: 4, label: "Quinta-feira" },
  { weekday: 5, label: "Sexta-feira" },
];

// Estrutura por aluno já agrupada por dia da semana — pensada para que o próximo
// passo (calculadora de valores) some facilmente o total diário e o da semana.
export type ColoniaStudentWeek = {
  studentId: string;
  name: string;
  className: string;
  byDay: Record<number, ColoniaRecord[]>; // weekday (1..5) → registros do dia
  total: number; // total de registros na semana
};

// Segunda-feira (00:00 local) da semana que contém `d`.
export function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=domingo … 6=sábado
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff, 0, 0, 0, 0);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
