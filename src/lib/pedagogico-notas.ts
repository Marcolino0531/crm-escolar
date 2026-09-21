// Pedagógico — Fase 2: avaliações e notas (Fundamental em diante), lógica pura.
//
// Regra do colégio, por disciplina:
//   • 3 trimestres: 1º e 2º valem 30 pontos, 3º vale 40 (total anual 100).
//   • Dentro do trimestre o professor distribui o valor entre atividades
//     avaliativas; a soma dos valores máximos não passa do total do trimestre.
//   • Média do trimestre = 70% do valor dele (21 / 21 / 28).
//   • Recuperação de trimestre (só 1º e 2º), valendo 30, quando a nota ficou
//     abaixo de 21: nota final = min(max(nota, recuperação), 21).
//   • Soma anual = final do 1º + final do 2º + nota do 3º (sem recuperação).
//   • Recuperação final (só se soma < 70), prova de 100: aprovado com 70+ →
//     nota final do ano = 70 (trava); reprovado → mantém a soma original.
//
// Infantil não tem nota: usa parecer descritivo (segmentoDaTurma → "infantil").

import { INDICE_PRIMEIRO_ANO, TURMAS_POR_IDADE } from "@/lib/crm/mecCutoff";
import { chaveSerie, serieDaTurma } from "@/lib/rematricula";

// ─── Constantes da regra ────────────────────────────────────────────────────

export type Trimestre = 1 | 2 | 3;
export const TRIMESTRES: readonly Trimestre[] = [1, 2, 3];

export const VALOR_TRIMESTRE: Record<Trimestre, number> = { 1: 30, 2: 30, 3: 40 };
export const PERCENTUAL_MEDIA = 0.7;
export const VALOR_RECUPERACAO_TRIMESTRE = 30;
export const VALOR_RECUPERACAO_FINAL = 100;
export const MEDIA_ANUAL = 70;

export const mediaTrimestre = (t: Trimestre): number =>
  arred(VALOR_TRIMESTRE[t] * PERCENTUAL_MEDIA);

export const temRecuperacaoTrimestre = (t: Trimestre): boolean => t === 1 || t === 2;

// Notas com até 2 casas; evita 0.1 + 0.2 nas somas.
export const arred = (n: number): number => Math.round(n * 100) / 100;

// ─── Tipos (espelham as tabelas) ────────────────────────────────────────────

export interface AtividadeAvaliativa {
  id: string;
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  disciplina_id: string;
  professor_id: string;
  trimestre: Trimestre;
  nome: string;
  valor_maximo: number;
  data: string; // YYYY-MM-DD
}

export interface NotaRow {
  atividade_id: string;
  sponte_aluno_id: string;
  nota: number;
}

export interface RecuperacaoTrimestreRow {
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  disciplina_id: string;
  trimestre: Trimestre;
  sponte_aluno_id: string;
  nota: number;
}

export interface RecuperacaoFinalRow {
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  disciplina_id: string;
  sponte_aluno_id: string;
  nota: number;
}

// ─── Atividades avaliativas ─────────────────────────────────────────────────

export const mesmaDisciplina = (
  a: { school_id: string; ano_letivo: number; turma_nome: string; disciplina_id: string },
  b: { school_id: string; ano_letivo: number; turma_nome: string; disciplina_id: string },
): boolean =>
  a.school_id === b.school_id &&
  a.ano_letivo === b.ano_letivo &&
  a.turma_nome === b.turma_nome &&
  a.disciplina_id === b.disciplina_id;

export function atividadesDoTrimestre(
  atividades: readonly AtividadeAvaliativa[],
  chave: Pick<AtividadeAvaliativa, "school_id" | "ano_letivo" | "turma_nome" | "disciplina_id">,
  trimestre: Trimestre,
): AtividadeAvaliativa[] {
  return atividades
    .filter((a) => a.trimestre === trimestre && mesmaDisciplina(a, chave))
    .sort((x, y) => x.data.localeCompare(y.data) || x.nome.localeCompare(y.nome, "pt-BR"));
}

// Quanto do trimestre já foi distribuído entre atividades.
export function valorDistribuido(
  atividades: readonly AtividadeAvaliativa[],
  chave: Pick<AtividadeAvaliativa, "school_id" | "ano_letivo" | "turma_nome" | "disciplina_id">,
  trimestre: Trimestre,
  ignorarId?: string,
): number {
  return arred(
    atividadesDoTrimestre(atividades, chave, trimestre)
      .filter((a) => a.id !== ignorarId)
      .reduce((s, a) => s + Number(a.valor_maximo), 0),
  );
}

// Erro (ou null) antes de gravar uma atividade: nome, valor positivo e a soma
// do trimestre dentro do total (30/30/40).
export function validarAtividade(
  existentes: readonly AtividadeAvaliativa[],
  nova: Omit<AtividadeAvaliativa, "id"> & { id?: string },
): string | null {
  if (!nova.nome.trim()) return "Dê um nome à atividade (ex.: Prova 1, Trabalho em grupo).";
  if (!TRIMESTRES.includes(nova.trimestre)) return "Trimestre inválido.";
  if (!(nova.valor_maximo > 0)) return "O valor da atividade precisa ser maior que zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nova.data) || Number(nova.data.slice(0, 4)) !== nova.ano_letivo)
    return "A data da atividade precisa estar dentro do ano letivo.";
  const total = VALOR_TRIMESTRE[nova.trimestre];
  const ja = valorDistribuido(existentes, nova, nova.trimestre, nova.id);
  const soma = arred(ja + Number(nova.valor_maximo));
  if (soma > total)
    return `A soma das atividades do ${nova.trimestre}º trimestre ficaria em ${fmtNota(soma)} pontos; o máximo é ${total}. Restam ${fmtNota(arred(total - ja))}.`;
  return null;
}

export function validarNota(nota: number, valorMaximo: number): string | null {
  if (!Number.isFinite(nota)) return "Informe uma nota numérica.";
  if (nota < 0) return "A nota não pode ser negativa.";
  if (nota > valorMaximo) return `A nota não pode passar de ${fmtNota(valorMaximo)}.`;
  return null;
}

export function validarRecuperacaoTrimestre(trimestre: Trimestre, nota: number): string | null {
  if (!temRecuperacaoTrimestre(trimestre)) return "O 3º trimestre não tem recuperação própria.";
  return validarNota(nota, VALOR_RECUPERACAO_TRIMESTRE);
}

export const validarRecuperacaoFinal = (nota: number): string | null =>
  validarNota(nota, VALOR_RECUPERACAO_FINAL);

// ─── Fórmulas ───────────────────────────────────────────────────────────────

// Nota do trimestre = soma das notas do aluno nas atividades daquele trimestre
// (atividade ainda sem nota lançada conta zero).
export function notaTrimestre(
  atividadesTrimestre: readonly AtividadeAvaliativa[],
  notas: readonly NotaRow[],
  alunoId: string,
): number {
  const ids = new Set(atividadesTrimestre.map((a) => a.id));
  return arred(
    notas
      .filter((n) => n.sponte_aluno_id === alunoId && ids.has(n.atividade_id))
      .reduce((s, n) => s + Number(n.nota), 0),
  );
}

export const abaixoDaMedia = (trimestre: Trimestre, nota: number): boolean =>
  nota < mediaTrimestre(trimestre);

// 1º/2º: abaixo da média e com recuperação lançada → min(max(nota, rec), 21).
// Sem recuperação (ou nota já na média, ou 3º trimestre) → a própria nota.
export function notaFinalTrimestre(
  trimestre: Trimestre,
  nota: number,
  recuperacao: number | null | undefined,
): number {
  if (!temRecuperacaoTrimestre(trimestre)) return arred(nota);
  const media = mediaTrimestre(trimestre);
  if (nota >= media) return arred(nota);
  if (recuperacao == null) return arred(nota);
  return arred(Math.min(Math.max(nota, recuperacao), media));
}

export const somaAnual = (final1: number, final2: number, nota3: number): number =>
  arred(final1 + final2 + nota3);

export const precisaRecuperacaoFinal = (soma: number): boolean => soma < MEDIA_ANUAL;

// Recuperação final aprovada (70+) trava a nota do ano em 70; reprovada
// mantém a soma original; sem necessidade de recuperação, a soma sem teto.
export function notaFinalAno(soma: number, recuperacaoFinal: number | null | undefined): number {
  if (!precisaRecuperacaoFinal(soma)) return arred(soma);
  if (recuperacaoFinal != null && recuperacaoFinal >= MEDIA_ANUAL) return MEDIA_ANUAL;
  return arred(soma);
}

// ─── Boletim do aluno em uma disciplina ─────────────────────────────────────

export interface TrimestreDoAluno {
  numero: Trimestre;
  valorTotal: number;
  valorDistribuido: number;
  media: number;
  nota: number;
  abaixoDaMedia: boolean;
  // Só 1º/2º: pode lançar recuperação quando abaixo da média.
  podeRecuperar: boolean;
  recuperacao: number | null;
  notaFinal: number;
}

export type SituacaoAnual =
  | "em_andamento" // 3º trimestre ainda não fechou (valor não todo distribuído/lançado)
  | "aprovado"
  | "recuperacao_final" // soma < 70 e recuperação final ainda não lançada
  | "aprovado_recuperacao"
  | "reprovado";

export interface BoletimDisciplina {
  trimestres: TrimestreDoAluno[];
  somaAnual: number;
  precisaRecuperacaoFinal: boolean;
  recuperacaoFinal: number | null;
  notaFinalAno: number;
  situacao: SituacaoAnual;
}

export function boletimDisciplina(
  chave: Pick<AtividadeAvaliativa, "school_id" | "ano_letivo" | "turma_nome" | "disciplina_id">,
  alunoId: string,
  atividades: readonly AtividadeAvaliativa[],
  notas: readonly NotaRow[],
  recuperacoes: readonly RecuperacaoTrimestreRow[],
  recuperacoesFinais: readonly RecuperacaoFinalRow[],
  // O 3º trimestre está fechado? (decide se já cabe falar em recuperação final;
  // por padrão, quando todo o valor do 3º já foi distribuído em atividades).
  terceiroFechado?: boolean,
): BoletimDisciplina {
  const trimestres = TRIMESTRES.map((t): TrimestreDoAluno => {
    const ativs = atividadesDoTrimestre(atividades, chave, t);
    const nota = notaTrimestre(ativs, notas, alunoId);
    const rec =
      recuperacoes.find(
        (r) => r.trimestre === t && r.sponte_aluno_id === alunoId && mesmaDisciplina(r, chave),
      )?.nota ?? null;
    const abaixo = abaixoDaMedia(t, nota);
    return {
      numero: t,
      valorTotal: VALOR_TRIMESTRE[t],
      valorDistribuido: valorDistribuido(atividades, chave, t),
      media: mediaTrimestre(t),
      nota,
      abaixoDaMedia: abaixo,
      podeRecuperar: temRecuperacaoTrimestre(t) && abaixo,
      recuperacao: rec == null ? null : Number(rec),
      notaFinal: notaFinalTrimestre(t, nota, rec == null ? null : Number(rec)),
    };
  });
  const soma = somaAnual(trimestres[0].notaFinal, trimestres[1].notaFinal, trimestres[2].nota);
  const recFinalRaw =
    recuperacoesFinais.find((r) => r.sponte_aluno_id === alunoId && mesmaDisciplina(r, chave))
      ?.nota ?? null;
  const recFinal = recFinalRaw == null ? null : Number(recFinalRaw);
  const fechado = terceiroFechado ?? trimestres[2].valorDistribuido >= VALOR_TRIMESTRE[3];
  const precisa = precisaRecuperacaoFinal(soma);

  let situacao: SituacaoAnual;
  if (!precisa) situacao = "aprovado";
  else if (!fechado) situacao = "em_andamento";
  else if (recFinal == null) situacao = "recuperacao_final";
  else if (recFinal >= MEDIA_ANUAL) situacao = "aprovado_recuperacao";
  else situacao = "reprovado";

  return {
    trimestres,
    somaAnual: soma,
    precisaRecuperacaoFinal: precisa,
    recuperacaoFinal: recFinal,
    notaFinalAno: notaFinalAno(soma, recFinal),
    situacao,
  };
}

export const ROTULO_SITUACAO: Record<SituacaoAnual, string> = {
  em_andamento: "Em andamento",
  aprovado: "Aprovado",
  recuperacao_final: "Recuperação final",
  aprovado_recuperacao: "Aprovado na recuperação final",
  reprovado: "Reprovado",
};

export function fmtNota(n: number): string {
  return arred(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ─── Segmento da turma (Infantil × Fundamental) ─────────────────────────────

export type SegmentoTurma = "infantil" | "fundamental";

// Reaproveita a mesma escala de séries do corte etário (TURMAS_POR_IDADE) e o
// leitor de série da turma do Sponte ("07 - 1º Ano T / A / Prof. X" → "1º Ano").
// Berçário tem sufixo variável ("Berçário 1", "Berçário II") e por isso casa
// por prefixo. Turma que não casa com nenhuma série conhecida → null (a tela
// não presume o segmento).
export function segmentoDaTurma(turmaNome: string): SegmentoTurma | null {
  const chave = chaveSerie(serieDaTurma(turmaNome));
  if (!chave) return null;
  if (chave.startsWith("bercario")) return "infantil";
  const idx = TURMAS_POR_IDADE.findIndex((s) => chaveSerie(s) === chave);
  if (idx < 0) return null;
  return idx >= INDICE_PRIMEIRO_ANO ? "fundamental" : "infantil";
}

// ─── Pareceres (Infantil) ───────────────────────────────────────────────────

export interface ParecerRow {
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  sponte_aluno_id: string;
  trimestre: Trimestre;
  texto: string;
}

export function parecerDoAluno(
  pareceres: readonly ParecerRow[],
  chave: Pick<ParecerRow, "school_id" | "ano_letivo" | "turma_nome">,
  alunoId: string,
  trimestre: Trimestre,
): ParecerRow | null {
  return (
    pareceres.find(
      (p) =>
        p.school_id === chave.school_id &&
        p.ano_letivo === chave.ano_letivo &&
        p.turma_nome === chave.turma_nome &&
        p.sponte_aluno_id === alunoId &&
        p.trimestre === trimestre,
    ) ?? null
  );
}
