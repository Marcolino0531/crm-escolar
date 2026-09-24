// Lógica pura da exclusão de uma submissão do formulário de matrícula.
//
// A partir dos dados JÁ gravados no School Hub, resume o que existe no Sponte
// para a tela de confirmação: aluno criado, matrícula na turma e cobranças
// lançadas por tipo (só status 'lancado'). Havendo qualquer objeto no Sponte,
// a confirmação exige o "Estou ciente" — a exclusão remove só o registro do
// School Hub.

export const AVISO_SPONTE =
  "A exclusão remove o registro só do School Hub. O que foi criado no Sponte deve ser cancelado manualmente.";

export const ROTULO_TIPO_COBRANCA: Record<string, string> = {
  matricula: "Matrícula",
  mensalidade: "Mensalidade",
  proporcional: "Proporcional",
  material: "Material pedagógico",
  alimentacao: "Alimentação",
  hora_extra: "Hora extra",
};

export interface LancamentoResumo {
  tipo: string;
  status: string;
}

export interface StatusIntegracao {
  alunoCriado: boolean;
  spontAlunoId: number | null;
  turmaMatriculada: boolean;
  turmaNome: string | null;
  cobrancasLancadas: string[];
}

export function resumirIntegracao(input: {
  sponteAlunoId: number | null;
  turmaStatus: string | null;
  turmaNome: string | null;
  lancamentos: LancamentoResumo[];
}): StatusIntegracao {
  const tipos = new Set<string>();
  for (const l of input.lancamentos) if (l.status === "lancado") tipos.add(l.tipo);
  const turmaMatriculada = input.turmaStatus === "matriculado";
  return {
    alunoCriado: input.sponteAlunoId != null,
    spontAlunoId: input.sponteAlunoId,
    turmaMatriculada,
    turmaNome: turmaMatriculada ? input.turmaNome : null,
    cobrancasLancadas: Object.keys(ROTULO_TIPO_COBRANCA).filter((t) => tipos.has(t)),
  };
}

export function existeAlgoNoSponte(s: StatusIntegracao): boolean {
  return s.alunoCriado || s.turmaMatriculada || s.cobrancasLancadas.length > 0;
}

export function rotuloCobrancas(tipos: string[]): string {
  if (tipos.length === 0) return "nenhuma";
  return tipos.map((t) => ROTULO_TIPO_COBRANCA[t] ?? t).join(", ");
}
