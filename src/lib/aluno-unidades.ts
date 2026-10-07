// Unidades de um aluno nas bases Sponte segmentadas por turma (CEC × CEC Baby).
// Depois da rematrícula, o Sponte devolve em TurmaAtual a turma do ano seguinte;
// o vínculo do ano letivo (diario_matriculas_ano) mantém o aluno na unidade em
// que ele ainda estuda. Na transição, o mesmo aluno pode estar nas duas.

export type VinculoTurma = { anoLetivo: number; turmaNome: string };

/** Unidade-mãe da base segmentada: aluno sem turma classificável e sem vínculo. */
export const UNIDADE_MAE = "CEC";

/** Unidades do School Hub que compartilham a base Sponte segmentada por turma. */
export const UNIDADES_SEGMENTADAS = ["CEC", "CEC Baby"] as const;

export function anoCorrenteSaoPaulo(agora: Date = new Date()): number {
  return Number(agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
}

/**
 * Unidade → turma do aluno naquela unidade. Pertence a U quando TurmaAtual
 * classifica como U, ou quando tem vínculo ativo de ano letivo >= anoCorrente
 * cuja turma classifica como U. A turma é a do vínculo de menor ano letivo que
 * classifica em U; sem vínculo, a TurmaAtual.
 */
export function unidadesDoAluno(
  turmaAtual: string,
  vinculos: readonly VinculoTurma[],
  anoCorrente: number,
  classificar: (turma: string) => string | null,
): Map<string, string> {
  const unidades = new Map<string, string>();
  const vigentes = vinculos
    .filter((v) => v.anoLetivo >= anoCorrente)
    .sort((a, b) => a.anoLetivo - b.anoLetivo);
  for (const v of vigentes) {
    const u = classificar(v.turmaNome);
    if (u && !unidades.has(u)) unidades.set(u, v.turmaNome);
  }
  const atual = classificar(turmaAtual) ?? (unidades.size === 0 ? UNIDADE_MAE : null);
  if (atual && !unidades.has(atual)) unidades.set(atual, turmaAtual);
  return unidades;
}
