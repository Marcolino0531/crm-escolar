// Regras puras da matrícula automática em turma (Fase 2 do fluxo
// matrícula → turma → onboarding).
//
// Tudo o que decide EM QUAL turma o aluno entra mora aqui, sem rede: série
// (data de corte), turno (período da rotina) e ano letivo (escolha da etapa 1)
// viram um TurmaID do Sponte. Errar isso significa matricular a criança na
// turma errada, então cada regra abaixo veio de leitura da base real:
//
//   • `GetTurmas` aceita `AnoLetivo` e `CursoID` (combináveis com `;`), mas o
//     campo `Turno` volta SEMPRE vazio e o parâmetro `Turno=` é ignorado pela
//     busca. O turno só existe no sufixo do `Nome`/`Horario` da turma
//     ("07 - 1º Ano M / Prof. …", Horario "Fundamental 1/2 M").
//   • `Situacao` é textual ("Aberta"/"Encerrada"): turma encerrada nunca pode
//     receber matrícula nova.
//   • TurmaID não é estável entre unidades/anos — a turma é sempre localizada
//     por série + turno + ano letivo, nunca por ID fixo.

import { escapeXml } from "@/lib/sponte-plano";

export type TurnoTurma = "M" | "T";

export const TURNOS_TURMA: readonly TurnoTurma[] = ["M", "T"];

export const ROTULO_TURNO: Record<TurnoTurma, string> = { M: "Manhã", T: "Tarde" };

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// ─── Ano letivo ─────────────────────────────────────────────────────────────

/**
 * As duas opções de ano letivo do formulário: o ano vigente e o seguinte,
 * derivados da data do servidor (nada de lista fixa para revisar todo ano).
 */
export function anosLetivosDisponiveis(hojeYMD: string): [number, number] {
  const ano = Number(hojeYMD.slice(0, 4));
  return [ano, ano + 1];
}

export function anoLetivoValidoMatricula(ano: number, hojeYMD: string): boolean {
  return anosLetivosDisponiveis(hojeYMD).includes(ano);
}

// Contrato do Sponte segue o ano letivo inteiro — é o padrão de 100% dos
// contratos vigentes lidos por GetMatriculas (01/01 a 31/12).
export function datasContratoAnoLetivo(anoLetivo: number): { inicio: string; termino: string } {
  return { inicio: `01/01/${anoLetivo}`, termino: `31/12/${anoLetivo}` };
}

// ─── Turno ──────────────────────────────────────────────────────────────────

const TOKENS_MANHA = new Set(["m", "manha", "matutino"]);
const TOKENS_TARDE = new Set(["t", "tarde", "vespertino"]);

function turnoDeTexto(texto: string): TurnoTurma | null {
  const tokens = normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const manha = tokens.some((t) => TOKENS_MANHA.has(t));
  const tarde = tokens.some((t) => TOKENS_TARDE.has(t));
  if (manha === tarde) return null;
  return manha ? "M" : "T";
}

/**
 * Turno de uma turma do Sponte. O marcador do nome ("06 - 2º Período M") é a
 * fonte preferida, porque o `Horario` é um rótulo livre e chega contradizendo o
 * nome em parte das turmas; no nome só o trecho ANTES da primeira barra é
 * considerado, para a inicial de um professor não ser lida como turno.
 */
export function turnoDaTurma(turma: { nome: string; horario: string }): TurnoTurma | null {
  return turnoDeTexto(turma.nome.split("/")[0]) ?? turnoDeTexto(turma.horario);
}

export interface PeriodoRotinaTurma {
  periodoManha: boolean;
  periodoTarde: boolean;
  horarioEstendido: boolean;
  // Resposta obrigatória do Horário Estendido: em qual turno o aluno assiste às
  // aulas curriculares.
  horarioCurricular: TurnoTurma | "";
}

/**
 * Turno em que o aluno é matriculado. No Horário Estendido ele vem da pergunta
 * extra do formulário; caso contrário, do período escolhido. `null` quando a
 * rotina não permite concluir (nada marcado, ou manhã e tarde juntas sem a
 * resposta do horário curricular) — aí a matrícula na turma vira pendência da
 * secretaria em vez de chute.
 */
export function turnoDaRotina(rotina: PeriodoRotinaTurma): TurnoTurma | null {
  if (rotina.horarioCurricular !== "") return rotina.horarioCurricular;
  if (rotina.horarioEstendido) return null;
  if (rotina.periodoManha === rotina.periodoTarde) return null;
  return rotina.periodoManha ? "M" : "T";
}

// ─── Curso (série) ──────────────────────────────────────────────────────────

// O Sponte alterna os indicadores ordinais entre o nome e a série do mesmo
// curso ("06 - 2° Período" e "06 - 2º Período"), então a comparação de série
// ignora indicador ordinal e pontuação.
function normalizarSerie(s: string): string {
  return normalizar(s)
    .replace(/[ºª°]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface CursoSponte {
  cursoId: number;
  nome: string;
  serie: string;
}

/**
 * CursoID da série calculada. O campo `Serie` do curso é a comparação
 * preferida; o nome só é usado como reserva, e sempre por igualdade
 * normalizada ou sufixo ("07 - 1º Ano"), nunca por semelhança parcial — "1º
 * Ano" não pode casar com "11º Ano".
 */
export function cursoIdDaSerie(serie: string, cursos: readonly CursoSponte[]): number | null {
  const alvo = normalizarSerie(serie);
  if (alvo === "") return null;

  const porSerie = cursos.find((c) => normalizarSerie(c.serie) === alvo);
  if (porSerie) return porSerie.cursoId;

  const porNome = cursos.find((c) => normalizarSerie(c.nome) === alvo);
  if (porNome) return porNome.cursoId;

  // Série e nome costumam trazer um prefixo de código ("07 - 1º Ano").
  const porSufixo = cursos.find((c) =>
    [c.serie, c.nome].some((campo) => {
      const texto = normalizarSerie(campo);
      if (!texto.endsWith(alvo)) return false;
      const antes = texto.slice(0, texto.length - alvo.length);
      return antes === "" || /[^a-z0-9]$/.test(antes);
    }),
  );
  return porSufixo?.cursoId ?? null;
}

// ─── Turma ──────────────────────────────────────────────────────────────────

export interface TurmaSponte {
  turmaId: number;
  nome: string;
  cursoId: number;
  curso: string;
  anoLetivo: number | null;
  situacao: string;
  horario: string;
  maxAlunos: number | null;
  vagasOcupadas: number | null;
}

export function turmaAberta(turma: TurmaSponte): boolean {
  return normalizar(turma.situacao) === "aberta";
}

/**
 * Escolhe a turma para a matrícula: mesma série (curso), mesmo turno, mesmo ano
 * letivo e ainda aberta. Havendo mais de uma candidata, vale a de menor
 * TurmaID — sem balanceamento por vaga, como combinado; o critério é fixo só
 * para o resultado ser reproduzível.
 */
export function escolherTurma(
  turmas: readonly TurmaSponte[],
  alvo: { cursoId: number; turno: TurnoTurma; anoLetivo: number },
): TurmaSponte | null {
  const candidatas = turmas
    .filter((t) => t.cursoId === alvo.cursoId)
    .filter((t) => t.anoLetivo === null || t.anoLetivo === alvo.anoLetivo)
    .filter((t) => turmaAberta(t))
    .filter((t) => turnoDaTurma(t) === alvo.turno)
    .sort((a, b) => a.turmaId - b.turmaId);
  return candidatas[0] ?? null;
}

/** Texto da pendência para a secretaria quando não há turma para matricular. */
export function textoPendenciaTurma(alvo: {
  serie: string;
  turno: TurnoTurma | null;
  anoLetivo: number;
}): string {
  const turno = alvo.turno ? ROTULO_TURNO[alvo.turno] : "não identificado";
  return `Nenhuma turma aberta para ${alvo.serie || "série não identificada"} — turno ${turno} — ano letivo ${alvo.anoLetivo}. Crie a turma no Sponte e matricule o aluno manualmente.`;
}

// ─── InsertMatricula ────────────────────────────────────────────────────────

// Valores lidos dos contratos reais de 2026 (GetMatriculas): toda matrícula
// vigente tem SituacaoID 1 ("Vigente"), TipoContratoID -2 e Tipo 1.
export const SITUACAO_MATRICULA_VIGENTE = 1;
export const TIPO_CONTRATO_PADRAO = -2;
export const TIPO_MATRICULA_PADRAO = 1;

export interface ParametrosInsertMatricula {
  alunoId: number;
  cursoId: number;
  turmaId: number;
  anoLetivo: number;
  // Data em que a matrícula é feita (YYYY-MM-DD).
  dataMatricula: string;
  observacao: string;
}

// Ordem das tags conforme o WSDL — o Sponte recusa parâmetro fora de ordem.
export function montarParametrosInsertMatricula(p: ParametrosInsertMatricula): string {
  const { inicio, termino } = datasContratoAnoLetivo(p.anoLetivo);
  return (
    `<nSituacao>${SITUACAO_MATRICULA_VIGENTE}</nSituacao>` +
    `<nAlunoID>${p.alunoId}</nAlunoID>` +
    `<nCursoID>${p.cursoId}</nCursoID>` +
    `<nTurmaID>${p.turmaId}</nTurmaID>` +
    `<nTipoContratoID>${TIPO_CONTRATO_PADRAO}</nTipoContratoID>` +
    `<dDataInicio>${inicio}</dDataInicio>` +
    `<dDataTermino>${termino}</dDataTermino>` +
    `<dDataMatricula>${p.dataMatricula}T00:00:00</dDataMatricula>` +
    `<nTipo>${TIPO_MATRICULA_PADRAO}</nTipo>` +
    `<sDisciplinas></sDisciplinas>` +
    `<nModulo></nModulo>` +
    `<nContratante></nContratante>` +
    `<nNumeroHoras></nNumeroHoras>` +
    `<sObservacao>${escapeXml(p.observacao)}</sObservacao>`
  );
}

/**
 * A matrícula só é considerada feita com confirmação do Sponte: ContratoID
 * positivo ou retorno explícito de sucesso. Qualquer outra resposta é falha —
 * nunca se reporta turma matriculada sem isso.
 */
export function matriculaConfirmada(retornoOperacao: string, contratoId: string): boolean {
  const contrato = parseInt(contratoId, 10);
  if (Number.isFinite(contrato) && contrato > 0) return true;
  return normalizar(retornoOperacao).includes("sucesso");
}

export type StatusMatriculaTurma = "matriculado" | "sem_turma" | "erro";
