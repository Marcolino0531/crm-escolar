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
