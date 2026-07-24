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

// Ordem cronológica lógica de exibição dos registros de um dia. Entrada e Saída
// ancoram a lista (primeiro e último item); as refeições ficam entre elas na
// sequência do dia. Itens não registrados simplesmente não aparecem.
export const COLONIA_RECORD_ORDER: ColoniaRecordType[] = [
  "entry",
  "breakfast",
  "lunch",
  "snack",
  "dinner",
  "exit",
];

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

// Prepara os registros de UM dia para exibição: descarta duplicados idênticos
// (mesmo tipo no mesmo minuto — vindos de duplo clique, ex.: duas Entradas às
// 07:05) e ordena por COLONIA_RECORD_ORDER, com o horário como desempate.
export function ordenarRegistrosDoDia<T extends ColoniaRecord>(records: T[]): T[] {
  const vistos = new Set<string>();
  const unicos: T[] = [];
  for (const r of records) {
    const minuto = Math.floor(new Date(r.occurred_at).getTime() / 60000);
    const chave = `${r.record_type}|${minuto}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(r);
  }
  return unicos.sort((a, b) => {
    const ordem =
      COLONIA_RECORD_ORDER.indexOf(a.record_type) - COLONIA_RECORD_ORDER.indexOf(b.record_type);
    return ordem !== 0 ? ordem : a.occurred_at.localeCompare(b.occurred_at);
  });
}

// Integridade do dia: se houve QUALQUER movimentação, o aluno precisa ter uma
// Entrada e uma Saída registradas — sem isso o controle de horas fica quebrado.
// Trava de data: só acusa dias já finalizados (de ontem para trás); o dia de
// hoje é ignorado, pois as crianças ainda estão na colônia.
export type PendenciaPortaria = { faltaEntrada: boolean; faltaSaida: boolean };

export function pendenciaPortaria(
  records: ColoniaRecord[],
  diaYMD: string,
  hojeYMD: string,
): PendenciaPortaria | null {
  if (records.length === 0) return null;
  if (diaYMD >= hojeYMD) return null;
  const faltaEntrada = !records.some((r) => r.record_type === "entry");
  const faltaSaida = !records.some((r) => r.record_type === "exit");
  return faltaEntrada || faltaSaida ? { faltaEntrada, faltaSaida } : null;
}

export function labelPendenciaPortaria(p: PendenciaPortaria): string {
  if (p.faltaEntrada && p.faltaSaida) return "Entrada e Saída não registradas";
  return p.faltaEntrada ? "Entrada não registrada" : "Saída não registrada";
}

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
  schoolId: string;
  sponteAlunoId: string | null;
  name: string;
  className: string;
  byDay: Record<number, ColoniaRecord[]>; // weekday (1..5) → registros do dia
  total: number; // total de registros na semana
};

// Primeiro dia do mês (00:00 local) que contém `d`.
export function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

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

// Data local (00:00) → "YYYY-MM-DD". TIMEZONE-SAFE: usa os componentes locais,
// sem toISOString() (que converteria para UTC e poderia deslocar o dia).
export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
