// Regras PURAS da matrícula parcelada e dos ajustes do formulário público de
// Rematrícula (CEC e CEC Baby). Nada aqui fala com Supabase ou Sponte.
//
// MATRÍCULA
//   O valor depende do colégio e do segmento da série do PRÓXIMO ano letivo:
//   Ensino Infantil, Fundamental 1 e Fundamental 2, cada um com o seu valor por
//   colégio × ano. A mensalidade não entra aqui.
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

import { INDICE_PRIMEIRO_ANO, TURMAS_POR_IDADE } from "./crm/mecCutoff";
import type { RotinaForm } from "./matricula-form";
import { addMesesYMD } from "./confissao-divida";
import { chaveSerie, mensalidadesDeReferencia } from "./rematricula";
import { turnoDaTurma, type TurnoTurma } from "./matricula-turma";
import { dataNoMes, diaVencimentoHabitual, type ParcelaAberta } from "./cantina";
import { addDaysYMD, proximoDiaUtil } from "./billing-schedule";

// ─── Segmento e valor ───────────────────────────────────────────────────────

export type SegmentoMatricula = "infantil" | "fundamental_1" | "fundamental_2";

export const SEGMENTOS_MATRICULA: readonly SegmentoMatricula[] = [
  "infantil",
  "fundamental_1",
  "fundamental_2",
];

// Segmento do cadastro anterior (um valor para Infantil + Fundamental 1). Só
// aparece no histórico de rematricula_matricula_escolhas; não recebe valor novo.
export type SegmentoMatriculaLegado = "infantil_fundamental_1";
export type SegmentoMatriculaHistorico = SegmentoMatricula | SegmentoMatriculaLegado;

// Valor da Matrícula por segmento de UM colégio × ano letivo, lido do cadastro
// (rematricula_matricula_valores). Segmento ausente = sem valor nesse colégio
// (nunca cadastrado ou excluído).
export type ValoresMatricula = Partial<Record<SegmentoMatricula, number>>;

export function segmentosSemValorMatricula(valores: ValoresMatricula): SegmentoMatricula[] {
  return SEGMENTOS_MATRICULA.filter((s) => !(valores[s] && valores[s] > 0));
}

export const ROTULO_SEGMENTO_MATRICULA: Record<SegmentoMatriculaHistorico, string> = {
  infantil: "Ensino Infantil",
  fundamental_1: "Ensino Fundamental 1 / Anos Iniciais",
  fundamental_2: "Ensino Fundamental 2 / Anos Finais",
  infantil_fundamental_1: "Educação Infantil e Ensino Fundamental I (cadastro antigo)",
};

// Pendências por colégio que impedem abrir a campanha do ano ao público.
export interface PendenciaCampanhaColegio {
  unidade: string;
  segmentosSemValorMatricula: SegmentoMatricula[];
}

// null = pode abrir. Um colégio sem NENHUM segmento cadastrado bloqueia a
// abertura; colégio com pelo menos um segmento pode abrir (ex.: CEC Baby só com
// Infantil), e o portal bloqueia individualmente o aluno sem valor.
export function mensagemPendenciasCampanha(
  anoLetivo: number,
  pendencias: { colegios: PendenciaCampanhaColegio[] },
): string | null {
  const semNada = pendencias.colegios.filter(
    (c) => c.segmentosSemValorMatricula.length >= SEGMENTOS_MATRICULA.length,
  );
  if (semNada.length === 0) return null;
  const nomes = semNada.map((c) => c.unidade).join(", ");
  return `Não é possível abrir a campanha de ${anoLetivo}: falta cadastrar o valor da Matrícula de ${anoLetivo} para ${nomes} (nenhum segmento cadastrado).`;
}

function indiceSerie(serie: string): number {
  const alvo = chaveSerie(serie);
  return TURMAS_POR_IDADE.findIndex((s) => chaveSerie(s) === alvo);
}

const INDICE_SEXTO_ANO = TURMAS_POR_IDADE.indexOf("6º Ano");

// Berçário ao 2º Período = infantil; 1º ao 5º Ano = fundamental_1; 6º ao 9º Ano
// = fundamental_2. Série fora de TURMAS_POR_IDADE não tem segmento (null).
export function segmentoMatricula(serie: string): SegmentoMatricula | null {
  const indice = indiceSerie(serie);
  if (indice < 0) return null;
  if (indice < INDICE_PRIMEIRO_ANO) return "infantil";
  if (indice < INDICE_SEXTO_ANO) return "fundamental_1";
  return "fundamental_2";
}

// null quando a série não tem segmento ou o segmento não tem valor no colégio.
export function valorMatricula(valores: ValoresMatricula, serie: string): number | null {
  const segmento = segmentoMatricula(serie);
  if (!segmento) return null;
  const valor = valores[segmento];
  return valor && valor > 0 ? valor : null;
}

// Etapa da Matrícula no portal: segmento, valor cheio e parcelamento disponível
// na data para o ano letivo. null = sem valor no colégio — a etapa é bloqueada e NENHUMA parcela é
// calculada (nunca com valor 0).
export function matriculaPortal(
  valores: ValoresMatricula,
  serie: string,
  hoje: string,
  anoLetivo: number,
): {
  segmento: SegmentoMatricula;
  valor: number;
  disponivel: ParcelamentoMatriculaDisponivel;
} | null {
  const segmento = segmentoMatricula(serie);
  const valor = valorMatricula(valores, serie);
  if (!segmento || valor === null) return null;
  return { segmento, valor, disponivel: parcelamentoMatriculaDisponivel(valor, hoje, anoLetivo) };
}

// ─── Frequência parcial: só até o Maternal 3 ────────────────────────────────

const INDICE_PRIMEIRO_PERIODO = TURMAS_POR_IDADE.indexOf("1º Período");

// A pergunta "não frequenta todos os dias úteis" só faz sentido para Berçário e
// Maternais. Série desconhecida (fora da tabela) mantém a pergunta visível.
export function perguntaFrequenciaParcial(serie: string): boolean {
  const indice = indiceSerie(serie);
  return indice < 0 || indice < INDICE_PRIMEIRO_PERIODO;
}

// ─── Jantar: só até o 1º Período ────────────────────────────────────────────

// O Jantar não é servido do 2º Período em diante. Série desconhecida mantém a
// opção visível.
export function serveJantar(serie: string): boolean {
  const indice = indiceSerie(serie);
  return indice < 0 || indice <= INDICE_PRIMEIRO_PERIODO;
}

// ─── Parcelas e vencimento da 1ª parcela ────────────────────────────────────
//
// Antecipada (preenchida antes do ano letivo): 1ª parcela entre preenchimento
// + 3 dias e o fim do mês M = janeiro do ano letivo − (N−1) meses, de modo que a
// última parcela vença até janeiro. Ano em curso (preenchida no próprio ano
// letivo): só à vista, até o fim do mês do preenchimento, com valor proporcional
// aos meses restantes a partir do mês de início.

export const MAX_PARCELAS_MATRICULA = 5;
export const PRAZO_MINIMO_1A_PARCELA_DIAS = 3;
// Início até fevereiro do ano letivo: valor cheio.
export const ULTIMO_MES_VALOR_CHEIO = 2;

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

function exigirYMD(ymd: string, campo: string): void {
  if (!RE_YMD.test(ymd)) throw new Error(`${campo} inválida (esperado YYYY-MM-DD).`);
}

function parcelasNoIntervalo(parcelas: number): boolean {
  return Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= MAX_PARCELAS_MATRICULA;
}

export function matriculaNoAnoEmCurso(dataPreenchimento: string, anoLetivo: number): boolean {
  exigirYMD(dataPreenchimento, "Data de preenchimento");
  return Number(dataPreenchimento.slice(0, 4)) >= anoLetivo;
}

export function vencimentoMinimoMatricula(dataPreenchimento: string): string {
  exigirYMD(dataPreenchimento, "Data de preenchimento");
  return addDaysYMD(dataPreenchimento, PRAZO_MINIMO_1A_PARCELA_DIAS);
}

// Vencimento lançado: a data escolhida, rolada para o próximo dia útil.
export function vencimentoEfetivoPrimeiraParcela(escolhido: string): string {
  exigirYMD(escolhido, "Vencimento da 1ª parcela");
  return proximoDiaUtil(escolhido);
}

export function ultimoDiaDoMes(ymd: string): string {
  exigirYMD(ymd, "Data");
  const [ano, mes] = ymd.split("-").map(Number);
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ymd.slice(0, 7)}-${String(dias).padStart(2, "0")}`;
}

function fimDoMesAntesDeJaneiro(anoLetivo: number, mesesAntes: number): string {
  const indice = anoLetivo * 12 - mesesAntes;
  const ano = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  return ultimoDiaDoMes(`${ano}-${String(mes).padStart(2, "0")}-01`);
}

export interface LimitesPrimeiroVencimento {
  minimo: string;
  maximo: string;
  // Sem janela de escolha: a data é a mínima (preenchimento + 3 dias).
  semEscolha: boolean;
}

// null = número de parcelas indisponível para o preenchimento/ano letivo.
export function limitesPrimeiroVencimento(
  dataPreenchimento: string,
  anoLetivo: number,
  parcelas: number,
): LimitesPrimeiroVencimento | null {
  const minimo = vencimentoMinimoMatricula(dataPreenchimento);
  if (!parcelasNoIntervalo(parcelas)) return null;
  const maximo = matriculaNoAnoEmCurso(dataPreenchimento, anoLetivo)
    ? parcelas === 1
      ? ultimoDiaDoMes(dataPreenchimento)
      : null
    : fimDoMesAntesDeJaneiro(anoLetivo, parcelas - 1);
  if (maximo === null) return null;
  if (minimo <= maximo) return { minimo, maximo, semEscolha: false };
  return parcelas === 1 ? { minimo, maximo: minimo, semEscolha: true } : null;
}

export function parcelasMatriculaValida(
  parcelas: number,
  dataPreenchimento: string,
  anoLetivo: number,
): boolean {
  return limitesPrimeiroVencimento(dataPreenchimento, anoLetivo, parcelas) !== null;
}

// Mensagem de erro ou "" quando válida. Os limites valem para a data escolhida,
// antes do ajuste para dia útil.
export function validarPrimeiroVencimento(
  vencimento: string,
  dataPreenchimento: string,
  anoLetivo: number,
  parcelas: number,
): string {
  if (!RE_YMD.test(vencimento)) return "Informe a data de vencimento da 1ª parcela.";
  const limites = limitesPrimeiroVencimento(dataPreenchimento, anoLetivo, parcelas);
  if (!limites) return "Escolha uma quantidade de parcelas disponível.";
  if (vencimento < limites.minimo) {
    return `A data não pode ser anterior a ${formatarDataBR(limites.minimo)}.`;
  }
  if (vencimento > limites.maximo) {
    return parcelas > 1
      ? `Em ${parcelas}x, a 1ª parcela deve vencer até ${formatarDataBR(limites.maximo)}, para a última vencer até 31/01/${anoLetivo}.`
      : `A data deve ser até ${formatarDataBR(limites.maximo)}.`;
  }
  return "";
}

export function textoJanelaPrimeiroVencimento(limites: LimitesPrimeiroVencimento): string {
  if (limites.semEscolha) {
    return `A parcela vence em ${formatarDataBR(limites.minimo)} (ou no próximo dia útil).`;
  }
  return `Escolha o vencimento da 1ª parcela entre ${formatarDataBR(limites.minimo)} e ${formatarDataBR(limites.maximo)}. As demais acompanham o vencimento da mensalidade.`;
}

// ─── Valor proporcional no ano em curso ─────────────────────────────────────

export interface ProporcaoMatricula {
  meses: number;
  de: 12;
}

// Mês de início = data de início da rotina (ou o mês do preenchimento, sem data
// válida). Início até fevereiro do ano letivo (ou antes dele): valor cheio.
export function proporcaoMatriculaAnoEmCurso(
  anoLetivo: number,
  dataPreenchimento: string,
  dataInicio?: string | null,
): ProporcaoMatricula | null {
  exigirYMD(dataPreenchimento, "Data de preenchimento");
  const base = dataInicio && RE_YMD.test(dataInicio) ? dataInicio : dataPreenchimento;
  const ano = Number(base.slice(0, 4));
  const mes = Number(base.slice(5, 7));
  if (ano !== anoLetivo || mes <= ULTIMO_MES_VALOR_CHEIO) return null;
  return { meses: 12 - mes + 1, de: 12 };
}

// Arredondado ao centavo, meio para cima.
export function valorMatriculaProporcional(
  valor: number,
  proporcao: ProporcaoMatricula | null,
): number {
  const centavos = Math.round(valor * 100);
  if (!proporcao) return centavos / 100;
  return Math.round((centavos * proporcao.meses) / proporcao.de) / 100;
}

export function textoMatriculaAnoEmCurso(proporcao: ProporcaoMatricula | null): string {
  return proporcao
    ? `Matrícula para o ano letivo em andamento: pagamento à vista, proporcional aos meses restantes (${proporcao.meses} de ${proporcao.de}).`
    : "Matrícula para o ano letivo em andamento: pagamento à vista.";
}

// ─── Opções de parcelamento ─────────────────────────────────────────────────

export interface ParcelaMatriculaOpcao {
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  total: number;
}

// Divide o valor em N parcelas, sobra de centavos na 1ª (mesmo critério do
// material pedagógico).
export function parcelamentoMatricula(valor: number, parcelas: number): ParcelaMatriculaOpcao {
  if (!parcelasNoIntervalo(parcelas)) {
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

export interface OpcaoParcelamentoMatricula extends ParcelaMatriculaOpcao {
  vencimentoMinimo: string;
  vencimentoMaximo: string;
  semEscolha: boolean;
}

export interface ParcelamentoMatriculaDisponivel {
  // Mês (YYYY-MM) da data mínima da 1ª parcela.
  mesReferencia: string;
  anoEmCurso: boolean;
  somenteAVista: boolean;
  maxParcelas: number;
  valorCheio: number;
  // Valor cobrado: proporcional no ano em curso, cheio na antecipada.
  valor: number;
  proporcao: ProporcaoMatricula | null;
  opcoes: OpcaoParcelamentoMatricula[];
}

// Tudo que a tela precisa: as opções cuja janela de 1ª parcela não é vazia, com
// valor e limites de cada uma.
export function parcelamentoMatriculaDisponivel(
  valorCheio: number,
  dataPreenchimento: string,
  anoLetivo: number,
  dataInicio?: string | null,
): ParcelamentoMatriculaDisponivel {
  const anoEmCurso = matriculaNoAnoEmCurso(dataPreenchimento, anoLetivo);
  const proporcao = anoEmCurso
    ? proporcaoMatriculaAnoEmCurso(anoLetivo, dataPreenchimento, dataInicio)
    : null;
  const valor = valorMatriculaProporcional(valorCheio, proporcao);
  const opcoes: OpcaoParcelamentoMatricula[] = [];
  for (let n = 1; n <= MAX_PARCELAS_MATRICULA; n++) {
    const limites = limitesPrimeiroVencimento(dataPreenchimento, anoLetivo, n);
    if (!limites) continue;
    opcoes.push({
      ...parcelamentoMatricula(valor, n),
      vencimentoMinimo: limites.minimo,
      vencimentoMaximo: limites.maximo,
      semEscolha: limites.semEscolha,
    });
  }
  const maxParcelas = Math.max(...opcoes.map((o) => o.parcelas));
  return {
    mesReferencia: vencimentoMinimoMatricula(dataPreenchimento).slice(0, 7),
    anoEmCurso,
    somenteAVista: maxParcelas === 1,
    maxParcelas,
    valorCheio: Math.round(valorCheio * 100) / 100,
    valor,
    proporcao,
    opcoes,
  };
}

// ─── Vencimentos das parcelas 2+ pelas mensalidades reais ───────────────────

// 1ª parcela: a data escolhida pelo responsável, no próximo dia útil. Da 2ª em
// diante (a partir do mês seguinte ao da data escolhida): o
// vencimento real da mensalidade do aluno no mês correspondente; sem
// mensalidade naquele mês (ex.: as do ano seguinte ainda não emitidas), o dia
// habitual da mensalidade do aluno, rolado para o dia útil seguinte. Só sem
// nenhuma mensalidade de referência é que vale o dia da 1ª parcela.
export function vencimentosMatriculaPelasMensalidades<T extends ParcelaAberta>(
  mensalidades: readonly T[],
  primeiroVencimento: string,
  parcelas: number,
): string[] {
  exigirYMD(primeiroVencimento, "Vencimento da 1ª parcela");
  if (!parcelasNoIntervalo(parcelas)) {
    throw new Error(
      `Número de parcelas da matrícula fora do intervalo (1 a ${MAX_PARCELAS_MATRICULA}).`,
    );
  }
  const referencia = mensalidadesDeReferencia(mensalidades);
  const porMes = new Map<string, string>();
  for (const p of referencia) {
    const mes = p.vencimento.slice(0, 7);
    const atual = porMes.get(mes);
    if (!atual || p.vencimento < atual) porMes.set(mes, p.vencimento);
  }
  const diaHabitual = diaVencimentoHabitual(referencia);
  const datas: string[] = [vencimentoEfetivoPrimeiraParcela(primeiroVencimento)];
  for (let i = 1; i < parcelas; i++) {
    const nominal = addMesesYMD(primeiroVencimento, i);
    const mes = nominal.slice(0, 7);
    datas.push(
      porMes.get(mes) ??
        (diaHabitual === null ? nominal : proximoDiaUtil(dataNoMes(mes, diaHabitual))),
    );
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
  if (!serveJantar(serie) && r.refeicoes.dinner.length > 0) {
    r.refeicoes = { ...r.refeicoes, dinner: [] };
  }
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
