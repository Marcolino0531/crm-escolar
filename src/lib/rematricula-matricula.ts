// Regras PURAS da matrícula parcelada e dos ajustes do formulário público de
// Rematrícula (CEC e CEC Baby). Nada aqui fala com Supabase ou Sponte.
//
// MATRÍCULA
//   O valor depende do segmento da série do PRÓXIMO ano letivo: Educação
//   Infantil e Fundamental I pagam um valor, Fundamental II outro. A mensalidade
//   não entra aqui.
//
//   Parcelamento: o "mês de referência" é o mês em que o responsável preenche
//   o formulário quando o dia é até 25; do dia 26 em diante passa a ser o mês
//   seguinte. As parcelas vão do mês de referência até JANEIRO (o mês em que a
//   janela fecha), no máximo 5. Referência em janeiro ou depois: só à vista.
//
//   Só a 1ª parcela tem vencimento escolhido pelo responsável (entre a data de
//   preenchimento e o último dia do mês). As demais seguem o vencimento REAL da
//   mensalidade do aluno em cada mês, lido do Sponte na efetivação.
//
// TURNOS
//   A restrição vale só para CEC/CEC Baby e vem das turmas abertas do Sponte
//   para a série: o turno é lido do nome/horário da turma (o campo `Turno` da
//   API chega vazio).

import { TURMAS_POR_IDADE } from "./crm/mecCutoff";
import type { RotinaForm } from "./matricula-form";
import { addMesesYMD } from "./confissao-divida";
import { chaveSerie, mensalidadesDeReferencia } from "./rematricula";
import { turnoDaTurma, type TurnoTurma } from "./matricula-turma";
import type { ParcelaAberta } from "./cantina";

// ─── Segmento e valor ───────────────────────────────────────────────────────

export type SegmentoMatricula = "infantil_fundamental_1" | "fundamental_2";

export const VALOR_MATRICULA: Record<SegmentoMatricula, number> = {
  infantil_fundamental_1: 2057.1,
  fundamental_2: 2234.25,
};

export const ROTULO_SEGMENTO_MATRICULA: Record<SegmentoMatricula, string> = {
  infantil_fundamental_1: "Educação Infantil e Ensino Fundamental I",
  fundamental_2: "Ensino Fundamental II",
};

const INDICE_SEXTO_ANO = TURMAS_POR_IDADE.indexOf("6º Ano");

function indiceSerie(serie: string): number {
  const alvo = chaveSerie(serie);
  return TURMAS_POR_IDADE.findIndex((s) => chaveSerie(s) === alvo);
}

// Fundamental II começa no 6º Ano; tudo antes (inclusive Berçário e os Períodos)
// paga o valor de Educação Infantil/Fundamental I.
export function segmentoMatricula(serie: string): SegmentoMatricula {
  const indice = indiceSerie(serie);
  return indice >= INDICE_SEXTO_ANO ? "fundamental_2" : "infantil_fundamental_1";
}

export function valorMatricula(serie: string): number {
  return VALOR_MATRICULA[segmentoMatricula(serie)];
}

// ─── Frequência parcial: só até o Maternal 3 ────────────────────────────────

const INDICE_PRIMEIRO_PERIODO = TURMAS_POR_IDADE.indexOf("1º Período");

// A pergunta "não frequenta todos os dias úteis" só faz sentido para Berçário e
// Maternais. Série desconhecida (fora da tabela) mantém a pergunta visível.
export function perguntaFrequenciaParcial(serie: string): boolean {
  const indice = indiceSerie(serie);
  return indice < 0 || indice < INDICE_PRIMEIRO_PERIODO;
}

// ─── Mês de referência e parcelas ───────────────────────────────────────────

export const DIA_LIMITE_MES_ATUAL = 25;
export const MAX_PARCELAS_MATRICULA = 5;
// Mês (1-12) em que a janela de parcelamento fecha: janeiro do ano seguinte.
export const MES_FIM_JANELA = 1;

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

function exigirYMD(ymd: string, campo: string): void {
  if (!RE_YMD.test(ymd)) throw new Error(`${campo} inválida (esperado YYYY-MM-DD).`);
}

// "YYYY-MM" do mês de referência: até o dia 25 é o mês do preenchimento, do 26
// em diante é o seguinte.
export function mesReferenciaMatricula(dataPreenchimento: string): string {
  exigirYMD(dataPreenchimento, "Data de preenchimento");
  const dia = Number(dataPreenchimento.slice(8, 10));
  const base = dia <= DIA_LIMITE_MES_ATUAL ? dataPreenchimento : addMesesYMD(dataPreenchimento, 1);
  return base.slice(0, 7);
}

// Quantidade máxima de parcelas: meses do mês de referência até janeiro
// (inclusive), limitada a 5. Referência em janeiro conta 1 (só janeiro);
// fevereiro em diante já está fora da janela → 1 (à vista).
export function maxParcelasMatricula(dataPreenchimento: string): number {
  const [ano, mes] = mesReferenciaMatricula(dataPreenchimento).split("-").map(Number);
  // Janela fecha em janeiro do ano seguinte ao mês de referência quando este
  // está em fev–dez; se a referência já é janeiro, fecha nele mesmo.
  const anoFim = mes === MES_FIM_JANELA ? ano : ano + 1;
  const meses = anoFim * 12 + MES_FIM_JANELA - (ano * 12 + mes) + 1;
  return Math.max(1, Math.min(MAX_PARCELAS_MATRICULA, meses));
}

// Referência dentro da janela de parcelamento (setembro a janeiro)?
export function referenciaDentroDaJanela(dataPreenchimento: string): boolean {
  const mes = Number(mesReferenciaMatricula(dataPreenchimento).slice(5, 7));
  return mes >= 9 || mes === MES_FIM_JANELA;
}

export interface ParcelaMatriculaOpcao {
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  total: number;
}

// Divide o valor em N parcelas, sobra de centavos na 1ª (mesmo critério do
// material pedagógico).
export function parcelamentoMatricula(valor: number, parcelas: number): ParcelaMatriculaOpcao {
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS_MATRICULA) {
    throw new Error(
      `Número de parcelas da matrícula fora do intervalo (1 a ${MAX_PARCELAS_MATRICULA}).`,
    );
  }
  const totalCentavos = Math.round(valor * 100);
  const base = Math.floor(totalCentavos / parcelas);
  const primeira = totalCentavos - base * (parcelas - 1);
  return {
    parcelas,
    valorParcela: base / 100,
    valorPrimeiraParcela: primeira / 100,
    total: totalCentavos / 100,
  };
}

export interface ParcelamentoMatriculaDisponivel {
  mesReferencia: string; // YYYY-MM
  somenteAVista: boolean;
  maxParcelas: number;
  opcoes: ParcelaMatriculaOpcao[];
}

// Tudo que a tela precisa: quantas parcelas cabem hoje e o valor de cada opção.
// Fora da janela (referência em janeiro ou depois) só existe 1x.
export function parcelamentoMatriculaDisponivel(
  valor: number,
  dataPreenchimento: string,
): ParcelamentoMatriculaDisponivel {
  const mesReferencia = mesReferenciaMatricula(dataPreenchimento);
  const mes = Number(mesReferencia.slice(5, 7));
  const somenteAVista = mes === MES_FIM_JANELA || !referenciaDentroDaJanela(dataPreenchimento);
  const maxParcelas = somenteAVista ? 1 : maxParcelasMatricula(dataPreenchimento);
  const opcoes: ParcelaMatriculaOpcao[] = [];
  for (let n = 1; n <= maxParcelas; n++) opcoes.push(parcelamentoMatricula(valor, n));
  return { mesReferencia, somenteAVista, maxParcelas, opcoes };
}

export function parcelasMatriculaValida(parcelas: number, dataPreenchimento: string): boolean {
  if (!Number.isInteger(parcelas) || parcelas < 1) return false;
  return parcelas <= parcelamentoMatriculaDisponivel(0, dataPreenchimento).maxParcelas;
}

// ─── Vencimento da 1ª parcela ───────────────────────────────────────────────

export function ultimoDiaDoMes(ymd: string): string {
  exigirYMD(ymd, "Data");
  const [ano, mes] = ymd.split("-").map(Number);
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ymd.slice(0, 7)}-${String(dias).padStart(2, "0")}`;
}

export interface LimitesPrimeiroVencimento {
  minimo: string; // = data de preenchimento
  maximo: string; // último dia do mês do preenchimento
}

export function limitesPrimeiroVencimento(dataPreenchimento: string): LimitesPrimeiroVencimento {
  exigirYMD(dataPreenchimento, "Data de preenchimento");
  return { minimo: dataPreenchimento, maximo: ultimoDiaDoMes(dataPreenchimento) };
}

// Mensagem de erro ou "" quando válida.
export function validarPrimeiroVencimento(vencimento: string, dataPreenchimento: string): string {
  if (!RE_YMD.test(vencimento)) return "Informe a data de vencimento da 1ª parcela.";
  const { minimo, maximo } = limitesPrimeiroVencimento(dataPreenchimento);
  if (vencimento < minimo) return `A data não pode ser anterior a ${formatarDataBR(minimo)}.`;
  if (vencimento > maximo) return `A data deve ser até ${formatarDataBR(maximo)}.`;
  return "";
}

// ─── Vencimentos das parcelas 2+ pelas mensalidades reais ───────────────────

// 1ª parcela: exatamente a data escolhida pelo responsável. Da 2ª em diante: o
// vencimento real da mensalidade do aluno no mês correspondente; sem
// mensalidade naquele mês, o mesmo dia da 1ª parcela no mês seguinte.
export function vencimentosMatriculaPelasMensalidades<T extends ParcelaAberta>(
  mensalidades: readonly T[],
  primeiroVencimento: string,
  parcelas: number,
): string[] {
  exigirYMD(primeiroVencimento, "Vencimento da 1ª parcela");
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS_MATRICULA) {
    throw new Error(
      `Número de parcelas da matrícula fora do intervalo (1 a ${MAX_PARCELAS_MATRICULA}).`,
    );
  }
  const porMes = new Map<string, string>();
  for (const p of mensalidadesDeReferencia(mensalidades)) {
    const mes = p.vencimento.slice(0, 7);
    const atual = porMes.get(mes);
    if (!atual || p.vencimento < atual) porMes.set(mes, p.vencimento);
  }
  const datas: string[] = [primeiroVencimento];
  for (let i = 1; i < parcelas; i++) {
    const nominal = addMesesYMD(primeiroVencimento, i);
    datas.push(porMes.get(nominal.slice(0, 7)) ?? nominal);
  }
  return datas;
}

export interface ParcelaMatriculaLancada {
  numero: number;
  valor: number;
  vencimento: string;
}

export function cronogramaMatricula(
  valor: number,
  parcelas: number,
  vencimentos: readonly string[],
): ParcelaMatriculaLancada[] {
  if (vencimentos.length !== parcelas) {
    throw new Error("Quantidade de vencimentos diferente do número de parcelas.");
  }
  const op = parcelamentoMatricula(valor, parcelas);
  return vencimentos.map((vencimento, i) => ({
    numero: i + 1,
    valor: i === 0 ? op.valorPrimeiraParcela : op.valorParcela,
    vencimento,
  }));
}

export function observacaoMatriculaSponte(anoLetivo: number, parcelas: number): string {
  return `Matrícula ${anoLetivo} — ${parcelas}x (Rematrícula School Hub)`;
}

// ─── Turnos disponíveis por série (CEC/CEC Baby) ────────────────────────────

export const UNIDADES_COM_RESTRICAO_TURNO: readonly string[] = ["CEC", "CEC Baby"];

export function unidadeRestringeTurno(unidade: string): boolean {
  return UNIDADES_COM_RESTRICAO_TURNO.some((u) => u.toLowerCase() === unidade.trim().toLowerCase());
}

export interface TurnosDisponiveis {
  manha: boolean;
  tarde: boolean;
}

export const TODOS_OS_TURNOS: TurnosDisponiveis = { manha: true, tarde: true };

export interface TurmaParaTurno {
  nome: string;
  horario: string;
  curso: string;
  situacao: string;
}

function normalizarTexto(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Turma pertence à série? O `Curso` vem como "07 - 1° Ano": compara pela chave
// da série depois de tirar o código numérico do início.
export function turmaDaSerie(turma: { curso: string; nome: string }, serie: string): boolean {
  const alvo = chaveSerie(serie);
  const semCodigo = (t: string) => t.trim().replace(/^\d{1,3}\s*[-–—]\s*/, "");
  const curso = chaveSerie(semCodigo(turma.curso));
  if (curso === alvo) return true;
  // Reserva: nome da turma sem código e sem o sufixo de turno ("1º Ano M").
  const nome = chaveSerie(semCodigo(turma.nome).replace(/\s+[A-Za-z]$/, ""));
  return nome === alvo;
}

// Turnos que existem DE FATO para a série, a partir das turmas abertas do ano.
// Sem nenhuma turma aberta da série (ou sem turno identificável), devolve os dois
// turnos — a restrição nunca pode impedir o responsável de preencher.
export function turnosDisponiveisParaSerie(
  turmas: readonly TurmaParaTurno[],
  serie: string,
): TurnosDisponiveis {
  const turnos = new Set<TurnoTurma>();
  for (const t of turmas) {
    if (normalizarTexto(t.situacao) !== "aberta") continue;
    if (!turmaDaSerie(t, serie)) continue;
    const turno = turnoDaTurma(t);
    if (turno) turnos.add(turno);
  }
  if (turnos.size === 0) return { ...TODOS_OS_TURNOS };
  return { manha: turnos.has("M"), tarde: turnos.has("T") };
}

/**
 * Ajusta a rotina ao que a tela realmente oferece para a série: sem a pergunta
 * de frequência parcial o aluno frequenta todos os dias, e um turno que não
 * existe para a série não pode seguir marcado (ex.: pré-preenchimento antigo).
 */
export function normalizarRotinaParaSerie(
  rotina: RotinaForm,
  serie: string,
  turnos: TurnosDisponiveis,
): RotinaForm {
  const r: RotinaForm = { ...rotina };
  if (!perguntaFrequenciaParcial(serie)) {
    r.frequenciaParcial = false;
    r.diasSelecionados = [];
  }
  if (!turnos.manha && r.periodoManha) r.periodoManha = false;
  if (!turnos.tarde && r.periodoTarde) r.periodoTarde = false;
  return r;
}

// ─── Mensalidade vigente com desconto ───────────────────────────────────────

// Valor × (1 − desconto%), arredondado ao centavo. Ex.: 2134,25 com 80% → 426,85.
export function valorMensalidadeComDesconto(valor: number, descontoPercentual: number): number {
  const pct = Math.min(Math.max(descontoPercentual, 0), 100);
  return Math.round(valor * (1 - pct / 100) * 100) / 100;
}

// ─── Datas no formato brasileiro ────────────────────────────────────────────

export function formatarDataBR(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (ymd ?? "");
}
