// Pedagógico (Secretaria) — Fase 0: lógica pura, sem I/O.
//
// A sincronização anual reaproveita a reconciliação do Diário
// (planejarSincronizacaoAno): aqui a "identidade" do aluno é a chave
// `${school_id}::${sponte_aluno_id}` em vez do uuid de diario_students, porque
// pedagogico_matriculas_ano guarda o aluno diretamente pelo AlunoID do Sponte.

import { planejarSincronizacaoAno, type AlunoDoAno, type VinculoAno } from "@/lib/diario-sync";

// ─── Sincronização aluno × ano ──────────────────────────────────────────────

export interface AlunoColetado {
  schoolId: string;
  aluno: AlunoDoAno;
}

export interface MatriculaAnoRow {
  school_id: string;
  sponte_aluno_id: string;
  ano_letivo: number;
  turma_nome: string;
  ativo: boolean;
}

export interface MatriculaAnoUpsert {
  school_id: string;
  sponte_aluno_id: string;
  aluno_nome: string;
  ano_letivo: number;
  turma_nome: string;
  contrato_sponte_numero: string | null;
  ativo: true;
}

export interface PlanoPedagogicoAno {
  upserts: MatriculaAnoUpsert[];
  // Vínculos ativos DESTE ano que não vieram mais do Sponte.
  inativar: { school_id: string; sponte_aluno_id: string }[];
}

export const chaveAluno = (schoolId: string, sponteAlunoId: string): string =>
  `${schoolId}::${sponteAlunoId}`;

function separarChave(chave: string): { school_id: string; sponte_aluno_id: string } {
  const i = chave.indexOf("::");
  return { school_id: chave.slice(0, i), sponte_aluno_id: chave.slice(i + 2) };
}

// Mesma regra do Diário: só o ano sincronizado é tocado; vínculos de outros
// anos (aluno já rematriculado para o ano seguinte) ficam intactos.
export function planejarSincronizacaoPedagogico(
  anoLetivo: number,
  coletados: readonly AlunoColetado[],
  existentes: readonly MatriculaAnoRow[],
): PlanoPedagogicoAno {
  const nomes = new Map<string, string>();
  const alunos = coletados.map((c) => {
    const k = chaveAluno(c.schoolId, c.aluno.sponteId);
    if (!nomes.has(k)) nomes.set(k, c.aluno.nome);
    return { studentId: k, turma: c.aluno.turma, contratoId: c.aluno.contratoId };
  });
  const vinculos: VinculoAno[] = existentes.map((e) => ({
    studentId: chaveAluno(e.school_id, e.sponte_aluno_id),
    anoLetivo: Number(e.ano_letivo),
    turmaNome: e.turma_nome,
    ativo: e.ativo,
  }));
  const plano = planejarSincronizacaoAno(anoLetivo, alunos, vinculos);
  return {
    upserts: plano.upserts.map((u) => ({
      ...separarChave(u.student_id),
      aluno_nome: nomes.get(u.student_id) ?? "",
      ano_letivo: u.ano_letivo,
      turma_nome: u.turma_nome,
      contrato_sponte_numero: u.contrato_sponte_numero,
      ativo: true,
    })),
    inativar: plano.inativar.map(separarChave),
  };
}

// Turmas distintas (ordenadas) dos vínculos ativos de uma unidade × ano.
export function turmasDoAnoPedagogico(
  vinculos: readonly MatriculaAnoRow[],
  schoolId: string,
  anoLetivo: number,
): string[] {
  const set = new Set<string>();
  for (const v of vinculos) {
    if (v.ativo && v.school_id === schoolId && v.ano_letivo === anoLetivo && v.turma_nome)
      set.add(v.turma_nome);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// ─── Atribuições ────────────────────────────────────────────────────────────

export interface Atribuicao {
  id: string;
  school_id: string;
  professor_id: string;
  turma_nome: string;
  disciplina_id: string;
  ano_letivo: number;
}

export interface TurmaDoProfessor {
  turmaNome: string;
  disciplinaIds: string[];
}

// O que um professor enxerga em uma unidade × ano: só as turmas/disciplinas
// das próprias atribuições (a RLS aplica a mesma regra no banco; esta função
// serve à tela do professor e aos testes).
export function atribuicoesDoProfessor(
  atribuicoes: readonly Atribuicao[],
  professorId: string,
  anoLetivo: number,
  schoolId?: string,
): TurmaDoProfessor[] {
  const porTurma = new Map<string, Set<string>>();
  for (const a of atribuicoes) {
    if (a.professor_id !== professorId || a.ano_letivo !== anoLetivo) continue;
    if (schoolId && a.school_id !== schoolId) continue;
    const set = porTurma.get(a.turma_nome) ?? new Set<string>();
    set.add(a.disciplina_id);
    porTurma.set(a.turma_nome, set);
  }
  return [...porTurma.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([turmaNome, ids]) => ({ turmaNome, disciplinaIds: [...ids].sort() }));
}

export function professorLecionaTurma(
  atribuicoes: readonly Atribuicao[],
  professorId: string,
  schoolId: string,
  anoLetivo: number,
  turmaNome: string,
): boolean {
  return atribuicoes.some(
    (a) =>
      a.professor_id === professorId &&
      a.school_id === schoolId &&
      a.ano_letivo === anoLetivo &&
      a.turma_nome === turmaNome,
  );
}

// Já existe atribuição idêntica? (a UNIQUE do banco também barra; aqui é para
// a tela avisar antes de tentar gravar.)
export function atribuicaoDuplicada(
  atribuicoes: readonly Atribuicao[],
  nova: Omit<Atribuicao, "id">,
): boolean {
  return atribuicoes.some(
    (a) =>
      a.professor_id === nova.professor_id &&
      a.turma_nome === nova.turma_nome &&
      a.disciplina_id === nova.disciplina_id &&
      a.ano_letivo === nova.ano_letivo,
  );
}

// Cargo "Professor"/"Professora"/"Prof. de Educação Física"… (Title Case já é
// garantido pelo trigger; comparação sem acento e sem caixa).
export function ehCargoDeProfessor(cargo: string | null | undefined): boolean {
  const c = (cargo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\bprof(essor|essora|\.)?\b/.test(c);
}

// ─── Calendário ─────────────────────────────────────────────────────────────

export const TIPOS_CALENDARIO = [
  "letivo",
  "feriado",
  "evento",
  "inicio_trimestre",
  "fim_trimestre",
] as const;
export type TipoCalendario = (typeof TIPOS_CALENDARIO)[number];

export const ROTULO_TIPO_CALENDARIO: Record<TipoCalendario, string> = {
  letivo: "Dia letivo",
  feriado: "Feriado da escola",
  evento: "Evento",
  inicio_trimestre: "Início de trimestre",
  fim_trimestre: "Fim de trimestre",
};

export interface DiaCalendario {
  data: string; // YYYY-MM-DD
  tipo: TipoCalendario;
  trimestre: number | null;
  descricao: string;
}

export interface Trimestre {
  numero: 1 | 2 | 3;
  inicio: string | null;
  fim: string | null;
}

export function trimestresDoCalendario(dias: readonly DiaCalendario[]): Trimestre[] {
  return ([1, 2, 3] as const).map((numero) => ({
    numero,
    inicio: dias.find((d) => d.tipo === "inicio_trimestre" && d.trimestre === numero)?.data ?? null,
    fim: dias.find((d) => d.tipo === "fim_trimestre" && d.trimestre === numero)?.data ?? null,
  }));
}

// Erros de consistência do calendário (fim antes do início, trimestres fora
// de ordem, marco sem número). Lista vazia = ok.
export function validarCalendario(dias: readonly DiaCalendario[]): string[] {
  const erros: string[] = [];
  for (const d of dias) {
    if ((d.tipo === "inicio_trimestre" || d.tipo === "fim_trimestre") && !d.trimestre)
      erros.push(`${d.data}: marco de trimestre sem número do trimestre.`);
  }
  const tri = trimestresDoCalendario(dias);
  for (const t of tri) {
    if (t.inicio && t.fim && t.fim < t.inicio)
      erros.push(`${t.numero}º trimestre termina antes de começar.`);
  }
  for (let i = 1; i < tri.length; i++) {
    const ant = tri[i - 1];
    const cur = tri[i];
    if (ant.fim && cur.inicio && cur.inicio <= ant.fim)
      erros.push(`${cur.numero}º trimestre começa antes do fim do ${ant.numero}º.`);
  }
  return erros;
}

export function contarDiasLetivos(dias: readonly DiaCalendario[]): number {
  return dias.filter((d) => d.tipo === "letivo").length;
}

// Ano letivo padrão das telas: o ano vigente; a partir de outubro já sugere o
// próximo (montagem do ano seguinte).
export function anoLetivoSugerido(hoje: Date): number {
  return hoje.getMonth() >= 9 ? hoje.getFullYear() + 1 : hoje.getFullYear();
}
