// Helpers puros da auditoria de matrículas (compartilhados entre o webhook e o
// painel /matriculas). Sem dependências de rede/servidor, para serem testáveis
// isoladamente.

export type SubmissaoStatus =
  | "sucesso"
  | "duplicado"
  | "erro_aluno"
  | "erro_responsavel"
  | "erro_validacao";

// Status que representam falha (badge de alerta no painel).
export const STATUS_ERRO: readonly SubmissaoStatus[] = [
  "erro_aluno",
  "erro_responsavel",
  "erro_validacao",
];

export interface DadosBasicosSubmissao {
  submissionId: string | null;
  unidade: string | null;
  alunoNome: string | null;
  alunoCpf: string | null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function objeto(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * Extrai, de forma tolerante, os dados principais de um payload de matrícula
 * (nome/CPF do aluno, unidade, id da submissão) mesmo quando ele não passou na
 * validação. Usado para registrar a tentativa rejeitada no painel.
 */
export function extrairDadosBasicos(bruto: unknown): DadosBasicosSubmissao {
  const raiz = objeto(bruto);
  const aluno = objeto(raiz.aluno);
  return {
    submissionId: textoOuNulo(raiz.submissionId),
    unidade: textoOuNulo(raiz.unidade),
    alunoNome: textoOuNulo(aluno.nome),
    alunoCpf: textoOuNulo(aluno.cpf),
  };
}

export interface ResumoSubmissoes {
  total: number;
  porStatus: Record<string, number>;
  erros: number;
}

/**
 * Agrega submissões por status. `total` conta todas as linhas (inclusive as de
 * erro de validação), `erros` soma apenas os status de falha.
 */
export function resumirSubmissoes(rows: ReadonlyArray<{ status: string }>): ResumoSubmissoes {
  const porStatus: Record<string, number> = {};
  let erros = 0;
  for (const row of rows) {
    porStatus[row.status] = (porStatus[row.status] ?? 0) + 1;
    if ((STATUS_ERRO as readonly string[]).includes(row.status)) erros += 1;
  }
  return { total: rows.length, porStatus, erros };
}
