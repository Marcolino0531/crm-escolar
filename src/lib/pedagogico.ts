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

// Professor tem atribuição exatamente nesta turma+disciplina (mesma regra da
// RLS professor_leciona_disciplina — é o que autoriza conteúdo e frequência).
export function professorLecionaDisciplina(
  atribuicoes: readonly Atribuicao[],
  professorId: string,
  schoolId: string,
  anoLetivo: number,
  turmaNome: string,
  disciplinaId: string,
): boolean {
  return atribuicoes.some(
    (a) =>
      a.professor_id === professorId &&
      a.school_id === schoolId &&
      a.ano_letivo === anoLetivo &&
      a.turma_nome === turmaNome &&
      a.disciplina_id === disciplinaId,
  );
}

// ─── Fase 1: grade, conteúdo e frequência ───────────────────────────────────

// ISO: 1 = segunda … 7 = domingo (igual à coluna dia_semana).
export const DIAS_SEMANA_LETIVOS = [1, 2, 3, 4, 5, 6] as const;
export const ROTULO_DIA_SEMANA: Record<number, string> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  7: "Domingo",
};

export function diaSemanaISO(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return js === 0 ? 7 : js;
}

export interface Horario {
  id: string;
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  disciplina_id: string;
  dia_semana: number;
  horario_inicio: string; // HH:MM[:SS]
  horario_fim: string;
}

export const hhmm = (t: string): string => t.slice(0, 5);

export function validarHorario(inicio: string, fim: string): string | null {
  const re = /^\d{2}:\d{2}$/;
  if (!re.test(inicio) || !re.test(fim)) return "Informe os horários no formato HH:MM.";
  if (fim <= inicio) return "O horário de fim deve ser depois do início.";
  return null;
}

// Dois horários da mesma turma no mesmo dia não podem se sobrepor.
export function horarioConflita(
  existentes: readonly Horario[],
  novo: Omit<Horario, "id">,
  ignorarId?: string,
): Horario | null {
  const ini = hhmm(novo.horario_inicio);
  const fim = hhmm(novo.horario_fim);
  return (
    existentes.find(
      (h) =>
        h.id !== ignorarId &&
        h.school_id === novo.school_id &&
        h.ano_letivo === novo.ano_letivo &&
        h.turma_nome === novo.turma_nome &&
        h.dia_semana === novo.dia_semana &&
        hhmm(h.horario_inicio) < fim &&
        hhmm(h.horario_fim) > ini,
    ) ?? null
  );
}

export interface AulaDoDia {
  schoolId: string;
  anoLetivo: number;
  turmaNome: string;
  disciplinaId: string;
  // Sem horário na grade: atribuição existe, mas a secretaria ainda não
  // cadastrou a aula naquele dia (Infantil, por exemplo). Continua lançável.
  horarioInicio: string | null;
  horarioFim: string | null;
}

// Aulas do professor em uma data: a grade das SUAS atribuições no dia da
// semana correspondente. Atribuições sem nenhum horário cadastrado na grade
// da turma aparecem como aula sem horário, para o lançamento não ficar
// bloqueado pela falta da grade.
export function aulasDoDia(
  horarios: readonly Horario[],
  atribuicoes: readonly Atribuicao[],
  professorId: string,
  ymd: string,
): AulaDoDia[] {
  const dia = diaSemanaISO(ymd);
  const ano = Number(ymd.slice(0, 4));
  const minhas = atribuicoes.filter((a) => a.professor_id === professorId && a.ano_letivo === ano);
  const out: AulaDoDia[] = [];
  for (const a of minhas) {
    const grade = horarios.filter(
      (h) =>
        h.school_id === a.school_id &&
        h.ano_letivo === a.ano_letivo &&
        h.turma_nome === a.turma_nome &&
        h.disciplina_id === a.disciplina_id,
    );
    const hoje = grade.filter((h) => h.dia_semana === dia);
    if (hoje.length > 0) {
      for (const h of hoje)
        out.push({
          schoolId: a.school_id,
          anoLetivo: a.ano_letivo,
          turmaNome: a.turma_nome,
          disciplinaId: a.disciplina_id,
          horarioInicio: hhmm(h.horario_inicio),
          horarioFim: hhmm(h.horario_fim),
        });
    } else if (grade.length === 0) {
      out.push({
        schoolId: a.school_id,
        anoLetivo: a.ano_letivo,
        turmaNome: a.turma_nome,
        disciplinaId: a.disciplina_id,
        horarioInicio: null,
        horarioFim: null,
      });
    }
  }
  return out.sort(
    (x, y) =>
      (x.horarioInicio ?? "99:99").localeCompare(y.horarioInicio ?? "99:99") ||
      x.turmaNome.localeCompare(y.turmaNome, "pt-BR"),
  );
}

export interface Lancamento {
  professorId: string;
  schoolId: string;
  anoLetivo: number;
  turmaNome: string;
  disciplinaId: string;
  data: string; // YYYY-MM-DD
}

// Erro (ou null) antes de gravar conteúdo/frequência: só o professor
// responsável pela atribuição, e a data precisa estar no ano letivo.
export function validarLancamento(
  atribuicoes: readonly Atribuicao[],
  l: Lancamento,
): string | null {
  if (Number(l.data.slice(0, 4)) !== l.anoLetivo)
    return "A data da aula precisa estar dentro do ano letivo.";
  if (
    !professorLecionaDisciplina(
      atribuicoes,
      l.professorId,
      l.schoolId,
      l.anoLetivo,
      l.turmaNome,
      l.disciplinaId,
    )
  )
    return "Você não leciona esta disciplina nesta turma.";
  return null;
}

export interface ConteudoRow {
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  disciplina_id: string;
  professor_id: string;
  data: string;
  conteudo: string;
  licao_casa: string | null;
}

export interface FrequenciaRow {
  school_id: string;
  ano_letivo: number;
  turma_nome: string;
  disciplina_id: string;
  data: string;
  sponte_aluno_id: string;
  presente: boolean;
}

// Só os lançamentos das atribuições do professor (espelho, no cliente, do que
// a RLS já devolve; garante que a tela do professor nunca mostre aula alheia).
export function filtrarPorAtribuicao<
  T extends { school_id: string; ano_letivo: number; turma_nome: string; disciplina_id: string },
>(linhas: readonly T[], atribuicoes: readonly Atribuicao[], professorId: string): T[] {
  return linhas.filter((r) =>
    professorLecionaDisciplina(
      atribuicoes,
      professorId,
      r.school_id,
      r.ano_letivo,
      r.turma_nome,
      r.disciplina_id,
    ),
  );
}

export interface ChamadaAluno {
  sponteAlunoId: string;
  nome: string;
  presente: boolean;
}

// Lista de chamada da aula: alunos ativos da turma no ano, com o que já foi
// lançado; quem ainda não tem registro entra como presente (o professor marca
// só as faltas).
export function montarChamada(
  alunos: readonly (MatriculaAnoRow & { aluno_nome: string })[],
  schoolId: string,
  anoLetivo: number,
  turmaNome: string,
  lancadas: readonly FrequenciaRow[],
): ChamadaAluno[] {
  const registro = new Map(lancadas.map((f) => [f.sponte_aluno_id, f.presente]));
  return alunos
    .filter(
      (a) =>
        a.ativo &&
        a.school_id === schoolId &&
        a.ano_letivo === anoLetivo &&
        a.turma_nome === turmaNome,
    )
    .map((a) => ({
      sponteAlunoId: a.sponte_aluno_id,
      nome: a.aluno_nome,
      presente: registro.get(a.sponte_aluno_id) ?? true,
    }))
    .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
}

export function resumoChamada(chamada: readonly ChamadaAluno[]): {
  total: number;
  presentes: number;
  faltas: number;
} {
  const presentes = chamada.filter((c) => c.presente).length;
  return { total: chamada.length, presentes, faltas: chamada.length - presentes };
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
