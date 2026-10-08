// Faturamento automático da matrícula nova (Fase 3): lógica pura, sem rede.
//
// Cada cobrança tem origem própria e é calculada de forma independente:
// - Matrícula: "Valor da Matrícula" do School Hub (colégio × segmento) com
//   parcelas e 1º vencimento escolhidos pelo responsável;
// - Mensalidade: só o VALOR da parcela do plano do curso no Sponte
//   (GetPlanosCursos); as datas vêm do calendário (dia 05, fev–dez);
// - Material: valor anual do "Material Pedagógico por Série", parcelas do
//   formulário limitadas às mensalidades restantes;
// - Refeições: pacote mensal (5 dias) de "Valor Pacotes Extras" ÷ 5 × dias
//   marcados na semana, um lançamento por item;
// - Hora extra: pacote = valor mensal de 1 hora extra por dia, 5 dias por semana;
//   valor mensal = pacote × (minutos extras da semana ÷ 60) ÷ 5.
//
// As cobranças mensais começam no mês de início da rotina (nunca antes), com o
// primeiro mês proporcional por dias corridos quando o início não é dia 01
// (fevereiro do ano letivo, ou início antes dele, é cobrado cheio).
//
// Tudo aqui é planejamento: cada lacuna vira pendência só do seu tipo.

import { addDaysYMD, proximoDiaUtil } from "@/lib/billing-schedule";
import { addMesesYMD } from "@/lib/confissao-divida";
import {
  DIAS_UTEIS,
  HORARIOS_PADRAO,
  segmentoDaSerie,
  type HorariosRotina,
  type RefeicoesRotina,
} from "@/lib/matricula-form";
import {
  CATEGORIA_SPONTE_POR_ITEM,
  ITEM_POR_REFEICAO,
  REFEICOES_PACOTE,
  arredondarCentavo,
  mensagemPacoteSemValor,
  pacoteSemValor,
  valorMensalPacote,
  type ItemPacoteExtras,
  type PacotesExtras,
} from "@/lib/pacotes-extras";
import {
  CATEGORIA_MATERIAL_SPONTE,
  PARCELAS_MATERIAL_MAX,
  formatarBRL,
  parcelasMaterialValida,
} from "@/lib/rematricula";
import {
  parcelamentoMatriculaDisponivel,
  parcelasMatriculaValida,
  serveJantar,
  validarPrimeiroVencimento,
  vencimentoEfetivoPrimeiraParcela,
} from "@/lib/rematricula-matricula";
import type { Weekday } from "@/lib/diario";

// Categorias do plano de contas do Sponte usadas nos lançamentos. Os nomes são
// os mesmos nas unidades (os IDs, não), então a resolução continua sendo por
// GetCategorias na unidade da submissão.
export const CATEGORIA_MATRICULA_SPONTE = "Matrícula";
export const CATEGORIA_MENSALIDADE_SPONTE = "Mensalidade";

// ─── Plano do curso (GetPlanosCursos) ───────────────────────────────────────

export interface ItemPlanoCurso {
  parcelas: number;
  valorParcela: number;
  // Primeiro vencimento do item, em YYYY-MM-DD ("" quando o plano não informa).
  dataInicial: string;
  planoContaId: number;
  descricaoPlanoConta: string;
}

export interface PlanoCursoSponte {
  cursoId: number;
  planoCursoId: number;
  descricaoPlano: string;
  ativo: boolean;
  padrao: boolean;
  matricula: ItemPlanoCurso;
  mensalidade: ItemPlanoCurso;
  material: ItemPlanoCurso;
  outros: ItemPlanoCurso;
}

export const ITEM_PLANO_VAZIO: ItemPlanoCurso = {
  parcelas: 0,
  valorParcela: 0,
  dataInicial: "",
  planoContaId: 0,
  descricaoPlanoConta: "",
};

/** Ano letivo que o plano representa, lido da descrição ("2026", "Plano 2026"). */
export function anoDoPlanoCurso(descricaoPlano: string): number | null {
  const m = /(20\d{2})/.exec(descricaoPlano);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Plano do ano letivo pedido. Só entram planos daquele ano: um plano de outro
 * ano ou sem ano na descrição nunca é aceito no lugar. Entre os do ano, ativo e
 * padrão tem prioridade, depois ativo, e por último o maior PlanoCursoID (o
 * cadastro mais recente).
 */
export function escolherPlanoDoAnoLetivo(
  planos: readonly PlanoCursoSponte[],
  anoLetivo: number,
): PlanoCursoSponte | null {
  const doAno = planos.filter((p) => anoDoPlanoCurso(p.descricaoPlano) === anoLetivo);
  if (doAno.length === 0) return null;
  const peso = (p: PlanoCursoSponte): number => (p.ativo ? 2 : 0) + (p.padrao ? 1 : 0);
  return [...doAno].sort((a, b) => peso(b) - peso(a) || b.planoCursoId - a.planoCursoId)[0];
}

function itemComValor(item: ItemPlanoCurso): boolean {
  return Math.round(item.valorParcela * 100) > 0;
}

// ─── Calendário (dia 05, fevereiro a dezembro, dia útil de Brasília) ────────

export const DIA_VENCIMENTO_MENSALIDADE = 5;
export const PRIMEIRO_MES_MENSALIDADE = 2;
export const ULTIMO_MES_MENSALIDADE = 12;

function ymd(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Dia 05 do mês, rolado para o próximo dia útil quando cai em fim de semana ou feriado. */
export function dia5Util(ano: number, mes: number): string {
  return proximoDiaUtil(ymd(ano, mes, DIA_VENCIMENTO_MENSALIDADE));
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Mês do cronograma: vencimento e, no primeiro mês proporcional, a fração de dias corridos. */
export interface MesCronograma {
  vencimento: string;
  // null = mês cheio; senão dias cobrados / dias do mês (ex.: 13/31).
  proporcao: { dias: number; diasMes: number } | null;
}

/**
 * Cronograma das cobranças mensais (mensalidade, refeições e hora extra):
 * - começa no MÊS DE INÍCIO da rotina (`dataInicio`), nunca antes; sem data
 *   de início válida, a data de preenchimento é o início;
 * - início antes de fevereiro do ano letivo: 11 meses cheios, de fev a dez;
 * - início no dia 01 (ou fevereiro): mês cheio, vence no dia 05 útil; se o
 *   preenchimento for depois disso, no próximo dia útil após o preenchimento;
 * - início em outro dia: mês proporcional por dias corridos (início → fim do
 *   mês), vencendo na data de início (dia útil) ou, se ela já passou no
 *   preenchimento, no próximo dia útil após o preenchimento;
 * - meses seguintes: dia 05 útil até dezembro;
 * - início depois do ano letivo: nenhum mês.
 */
export function cronogramaMensal(
  anoLetivo: number,
  dataPreenchimento: string,
  dataInicio?: string | null,
): MesCronograma[] {
  if (!YMD.test(dataPreenchimento)) {
    throw new Error("Data de preenchimento inválida (esperado YYYY-MM-DD).");
  }
  const inicio = dataInicio && YMD.test(dataInicio) ? dataInicio : dataPreenchimento;
  const [ano, mes, dia] = inicio.split("-").map(Number);
  if (ano > anoLetivo) return [];
  const aposPreenchimento = proximoDiaUtil(addDaysYMD(dataPreenchimento, 1));
  const naoAntesDoPreenchimento = (v: string) => (v >= dataPreenchimento ? v : aposPreenchimento);

  const meses: MesCronograma[] = [];
  let mesInicio = PRIMEIRO_MES_MENSALIDADE;
  if (ano === anoLetivo && mes > PRIMEIRO_MES_MENSALIDADE) {
    mesInicio = mes;
    if (dia !== 1) {
      const diasMes = diasNoMes(ano, mes);
      meses.push({
        vencimento: naoAntesDoPreenchimento(proximoDiaUtil(inicio)),
        proporcao: { dias: diasMes - dia + 1, diasMes },
      });
      mesInicio = mes + 1;
    }
  }
  for (let m = mesInicio; m <= ULTIMO_MES_MENSALIDADE; m++) {
    meses.push({
      vencimento: naoAntesDoPreenchimento(dia5Util(anoLetivo, m)),
      proporcao: null,
    });
  }
  return meses;
}

/** Vencimentos das cobranças mensais (ver `cronogramaMensal`). */
export function vencimentosMensalidade(
  anoLetivo: number,
  dataPreenchimento: string,
  dataInicio?: string | null,
): string[] {
  return cronogramaMensal(anoLetivo, dataPreenchimento, dataInicio).map((m) => m.vencimento);
}

/** Valor de um mês do cronograma: cheio ou proporcional por dias corridos (centavo, meio para cima). */
export function valorDoMes(valorMensal: number, mes: MesCronograma): number {
  if (!mes.proporcao) return arredondarCentavo(valorMensal);
  return arredondarCentavo((valorMensal * mes.proporcao.dias) / mes.proporcao.diasMes);
}

/**
 * Vencimentos de um título que segue a mensalidade: a 1ª parcela em `primeiro`
 * e as demais no dia 05 dos meses seguintes ao mês de `primeiro`.
 */
export function vencimentosAPartirDe(primeiro: string, parcelas: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) {
    throw new Error("Primeiro vencimento inválido (esperado YYYY-MM-DD).");
  }
  const total = Math.trunc(parcelas);
  if (total < 1) return [];
  const [ano, mes] = primeiro.split("-").map(Number);
  const datas = [primeiro];
  for (let i = 1; i < total; i++) {
    const mesAbs = mes - 1 + i;
    datas.push(dia5Util(ano + Math.floor(mesAbs / 12), (mesAbs % 12) + 1));
  }
  return datas;
}

/** Parcelas do material permitidas: no máximo as mensalidades restantes (1 a 8). */
export function maxParcelasMaterial(mensalidadesRestantes: number): number {
  return Math.max(1, Math.min(PARCELAS_MATERIAL_MAX, Math.trunc(mensalidadesRestantes)));
}

/** Opções de parcelas do material exibidas no formulário para a data (início da rotina, se já informado). */
export function opcoesParcelasMaterial(
  anoLetivo: number,
  dataPreenchimento: string,
  dataInicio?: string | null,
): number[] {
  const restantes = vencimentosMensalidade(anoLetivo, dataPreenchimento, dataInicio).length;
  if (restantes === 0) return [1];
  const max = maxParcelasMaterial(restantes);
  return Array.from({ length: max }, (_, i) => i + 1);
}

// ─── Rotina ─────────────────────────────────────────────────────────────────

/** Dias úteis (seg–sex) marcados, sem repetição. */
export function diasUteisMarcados(dias: readonly Weekday[]): number {
  return new Set(dias.filter((d) => DIAS_UTEIS.includes(d))).size;
}

/** Duração do turno regular do segmento da série, em minutos (Infantil 270, Fundamental 320). */
export function minutosTurnoRegular(serie: string): number {
  const manha = HORARIOS_PADRAO[segmentoDaSerie(serie)].manha;
  return (hhmmMinutos(manha.saida) ?? 0) - (hhmmMinutos(manha.entrada) ?? 0);
}

function hhmmMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Minutos extras de cada dia útil com horário: (saída − entrada) − turno
 * regular do segmento, nunca negativo. Dias sem horário válido não entram.
 */
export function minutosExtrasPorDia(
  horarios: HorariosRotina,
  serie: string,
): Partial<Record<Weekday, number>> {
  const turno = minutosTurnoRegular(serie);
  const resultado: Partial<Record<Weekday, number>> = {};
  for (const dia of DIAS_UTEIS) {
    const h = horarios[dia];
    if (!h) continue;
    const entrada = hhmmMinutos(h.entrada);
    const saida = hhmmMinutos(h.saida);
    if (entrada === null || saida === null) continue;
    resultado[dia] = Math.max(0, saida - entrada - turno);
  }
  return resultado;
}

/**
 * Valor mensal da hora extra: pacote (1 hora extra por dia, 5 dias por semana)
 * × (minutos extras da semana ÷ 60) ÷ 5, arredondado ao centavo só no final.
 */
export function valorMensalHoraExtra(pacote: number, minutosExtrasSemana: number): number {
  if (minutosExtrasSemana <= 0) return 0;
  return arredondarCentavo((pacote * (minutosExtrasSemana / 60)) / 5);
}

function horasEmTexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

// ─── Plano de faturamento ───────────────────────────────────────────────────

// "proporcional" e "alimentacao" ficam só por compatibilidade com lançamentos
// antigos: o formulário não gera mais esses tipos.
export type TipoLancamentoMatricula =
  | "matricula"
  | "mensalidade"
  | "proporcional"
  | "material"
  | "alimentacao"
  | ItemPacoteExtras;

export const TIPOS_LANCAMENTO_FORMULARIO: readonly TipoLancamentoMatricula[] = [
  "matricula",
  "mensalidade",
  "material",
  "lanche_manha",
  "almoco",
  "lanche_tarde",
  "jantar",
  "hora_extra",
];

export const ROTULO_TIPO_LANCAMENTO: Record<TipoLancamentoMatricula, string> = {
  matricula: "Matrícula",
  mensalidade: "Mensalidade",
  proporcional: "Mensalidade proporcional",
  material: "Material pedagógico",
  alimentacao: "Alimentação",
  lanche_manha: "Lanche da Manhã",
  almoco: "Almoço",
  lanche_tarde: "Lanche da Tarde",
  jantar: "Jantar",
  hora_extra: "Hora extra",
};

export interface LancamentoPlanejado {
  tipo: TipoLancamentoMatricula;
  categoria: string;
  parcelas: number;
  // Valor das parcelas iguais (o que vai em nValorParcelas do InsertPlano).
  valorParcela: number;
  // Primeira parcela: absorve a sobra de centavos, como na tela nativa.
  valorPrimeiraParcela: number;
  primeiroVencimento: string;
  // Vencimento real de cada parcela (o Sponte gera mês a mês a partir do 1º;
  // o que divergir é corrigido com UpdateParcela).
  vencimentos: string[];
  total: number;
  observacao: string;
}

/** Pendência de um tipo: o que impediu o cálculo, para a secretaria lançar na mão. */
export interface PendenciaLancamento {
  tipo: TipoLancamentoMatricula;
  motivo: string;
}

export interface EntradaFaturamentoMatricula {
  // Plano do curso no Sponte (só o VALOR da mensalidade é usado); null = sem plano.
  plano: PlanoCursoSponte | null;
  anoLetivo: number;
  // Data do preenchimento (YYYY-MM-DD): o "hoje" do cronograma.
  dataMatricula: string;
  // Data de início da rotina (YYYY-MM-DD): mês em que as cobranças mensais
  // começam. Vazia/inválida = usa a data de preenchimento.
  dataInicio?: string | null;
  serie: string;
  // Matrícula: valor do School Hub (por colégio e segmento) e escolha do responsável.
  matriculaValor: number | null;
  matriculaParcelas: number | null;
  matriculaPrimeiroVencimento: string | null;
  materialValorAnual: number | null;
  materialParcelas: number | null;
  refeicoes: RefeicoesRotina;
  semRefeicoes: boolean;
  horarioEstendido: boolean;
  // Dias úteis ativos da rotina.
  diasAtivos: readonly Weekday[];
  // Horários efetivos (entrada/saída) por dia ativo; base das horas extras.
  horarios?: HorariosRotina;
  // Pacotes mensais (5 dias) do colégio × ano letivo; null = sem linha
  // cadastrada (ou tabela ainda inexistente): vira pendência de cada item marcado.
  pacotes: PacotesExtras | null;
}

export interface PlanoFaturamentoMatricula {
  lancamentos: LancamentoPlanejado[];
  pendencias: PendenciaLancamento[];
}

export const MSG_MATRICULA_SEM_VALOR =
  "O valor da Matrícula ainda não está disponível. A secretaria vai combinar o pagamento com você.";

export const MSG_ESTENDIDO_SEM_HORA_EXTRA =
  "Horário estendido sem horas além do turno regular. Confira a rotina.";

function parcelado(
  tipo: TipoLancamentoMatricula,
  categoria: string,
  total: number,
  vencimentos: string[],
  observacao: string,
): LancamentoPlanejado {
  const parcelas = vencimentos.length;
  const totalCentavos = Math.round(total * 100);
  const base = Math.floor(totalCentavos / parcelas);
  const primeira = totalCentavos - base * (parcelas - 1);
  return {
    tipo,
    categoria,
    parcelas,
    valorParcela: base / 100,
    valorPrimeiraParcela: primeira / 100,
    primeiroVencimento: vencimentos[0],
    vencimentos,
    total: totalCentavos / 100,
    observacao,
  };
}

/**
 * Cobrança mensal pelo cronograma: valor cheio em cada mês, salvo o primeiro
 * quando proporcional (vai em `valorPrimeiraParcela`; a observação indica a
 * proporção). Com um único mês proporcional, ele é a própria parcela.
 */
function mensal(
  tipo: TipoLancamentoMatricula,
  categoria: string,
  valorMensal: number,
  cronograma: readonly MesCronograma[],
  observacao: string,
): LancamentoPlanejado {
  const valores = cronograma.map((m) => Math.round(valorDoMes(valorMensal, m) * 100));
  const primeira = valores[0];
  const cheia = cronograma.length > 1 ? valores[1] : primeira;
  const total = valores.reduce((s, v) => s + v, 0);
  const p = cronograma[0].proporcao;
  return {
    tipo,
    categoria,
    parcelas: cronograma.length,
    valorParcela: cheia / 100,
    valorPrimeiraParcela: primeira / 100,
    primeiroVencimento: cronograma[0].vencimento,
    vencimentos: cronograma.map((m) => m.vencimento),
    total: total / 100,
    observacao: p
      ? `${observacao} — 1ª parcela proporcional ${p.dias}/${p.diasMes} dias`
      : observacao,
  };
}

/** Motivo pelo qual o plano do Sponte não serve para a mensalidade (null = serve). */
export function problemaMensalidadeDoPlano(
  plano: PlanoCursoSponte | null,
  anoLetivo: number,
): string | null {
  if (!plano) return `Nenhum plano de curso de ${anoLetivo} encontrado no Sponte para a série.`;
  if (anoDoPlanoCurso(plano.descricaoPlano) !== anoLetivo) {
    return `O plano "${plano.descricaoPlano}" não é do ano letivo ${anoLetivo}.`;
  }
  if (!plano.ativo) return "O plano do curso está inativo no Sponte.";
  if (!itemComValor(plano.mensalidade)) return "O plano do curso não tem valor de mensalidade.";
  return null;
}

/** Rotina e pacotes que definem os Extras (refeições e hora extra). */
export type EntradaExtrasRotina = Pick<
  EntradaFaturamentoMatricula,
  | "anoLetivo"
  | "serie"
  | "refeicoes"
  | "semRefeicoes"
  | "horarioEstendido"
  | "diasAtivos"
  | "horarios"
  | "pacotes"
>;

/** Valor mensal de um Extra pela rotina, ou a pendência que impede o cálculo. */
export type ExtraPelaRotina = {
  tipo: ItemPacoteExtras;
  categoria: string;
} & (
  | { valorMensal: number; observacao: string; pendencia: null }
  | { valorMensal: null; observacao: null; pendencia: string }
);

/**
 * Extras marcados na rotina, na ordem dos lançamentos: refeições (pacote ÷ 5 ×
 * dias marcados; Jantar só para série que serve jantar) e hora extra (minutos
 * além do turno regular nos dias ativos com horário estendido). Pacote sem
 * valor vira pendência daquele item.
 */
export function calcularExtrasPelaRotina(e: EntradaExtrasRotina): ExtraPelaRotina[] {
  const extras: ExtraPelaRotina[] = [];
  const pendente = (tipo: ItemPacoteExtras, pendencia: string) =>
    extras.push({
      tipo,
      categoria: CATEGORIA_SPONTE_POR_ITEM[tipo],
      valorMensal: null,
      observacao: null,
      pendencia,
    });
  const itemExtra = (
    tipo: ItemPacoteExtras,
    valorMensal: (pacote: number) => number,
    observacao: (pacote: number) => string,
  ) => {
    const pacote = e.pacotes?.[tipo] ?? null;
    if (pacote === null || pacoteSemValor(pacote)) {
      pendente(tipo, mensagemPacoteSemValor(tipo, e.anoLetivo));
    } else {
      extras.push({
        tipo,
        categoria: CATEGORIA_SPONTE_POR_ITEM[tipo],
        valorMensal: valorMensal(pacote),
        observacao: observacao(pacote),
        pendencia: null,
      });
    }
  };

  // Refeições: pacote mensal (5 dias) ÷ 5 × dias marcados na semana.
  if (!e.semRefeicoes) {
    for (const refeicao of REFEICOES_PACOTE) {
      const item = ITEM_POR_REFEICAO[refeicao];
      if (item === "jantar" && !serveJantar(e.serie)) continue;
      const dias = diasUteisMarcados(e.refeicoes[refeicao]);
      if (dias <= 0) continue;
      itemExtra(
        item,
        (pacote) => valorMensalPacote(pacote, dias),
        (pacote) =>
          `${CATEGORIA_SPONTE_POR_ITEM[item]} ${e.anoLetivo} — ${dias}x por semana — pacote ${formatarBRL(pacote)}`,
      );
    }
  }

  // Hora extra: pacote = 1 hora extra por dia, 5 dias por semana; cobra os
  // minutos além do turno regular em cada dia ativo com horário estendido.
  if (e.horarioEstendido) {
    const ativos = new Set(e.diasAtivos);
    const porDia = minutosExtrasPorDia(e.horarios ?? {}, e.serie);
    const minutosDias = DIAS_UTEIS.filter((d) => ativos.has(d))
      .map((d) => porDia[d] ?? 0)
      .filter((m) => m > 0);
    const minutosSemana = minutosDias.reduce((s, m) => s + m, 0);
    if (minutosSemana <= 0) {
      pendente("hora_extra", MSG_ESTENDIDO_SEM_HORA_EXTRA);
    } else {
      const diasSemana = minutosDias.length;
      const porDiaTexto = minutosDias.every((m) => m === minutosDias[0])
        ? `${horasEmTexto(minutosDias[0])} por dia`
        : `${horasEmTexto(minutosSemana)} por semana`;
      itemExtra(
        "hora_extra",
        (pacote) => valorMensalHoraExtra(pacote, minutosSemana),
        (pacote) =>
          `${CATEGORIA_SPONTE_POR_ITEM.hora_extra} ${e.anoLetivo} — ${porDiaTexto}, ${diasSemana}x por semana — ${formatarBRL(pacote)} por hora`,
      );
    }
  }

  return extras;
}

/**
 * Cronograma financeiro da matrícula nova. Cada tipo é calculado de forma
 * independente: o que faltar vira pendência só daquele tipo, e os demais são
 * lançados normalmente. As datas vêm do calendário (dia 05, fev–dez), nunca do
 * plano do Sponte.
 */
export function montarPlanoFaturamento(e: EntradaFaturamentoMatricula): PlanoFaturamentoMatricula {
  const lancamentos: LancamentoPlanejado[] = [];
  const pendencias: PendenciaLancamento[] = [];
  const pendente = (tipo: TipoLancamentoMatricula, motivo: string) =>
    pendencias.push({ tipo, motivo });
  const cronograma = cronogramaMensal(e.anoLetivo, e.dataMatricula, e.dataInicio);
  const mensalidades = cronograma.map((m) => m.vencimento);

  // Matrícula: valor do School Hub, parcelas e 1º vencimento escolhidos pelo responsável.
  if (e.matriculaValor === null || Math.round(e.matriculaValor * 100) <= 0) {
    pendente(
      "matricula",
      `Valor da Matrícula de ${e.anoLetivo} não cadastrado para a série "${e.serie}" no colégio — combine o pagamento com o responsável.`,
    );
  } else if (
    e.matriculaParcelas === null ||
    !parcelasMatriculaValida(e.matriculaParcelas, e.dataMatricula, e.anoLetivo)
  ) {
    pendente(
      "matricula",
      "Número de parcelas da Matrícula inválido para a data — confirme com o responsável.",
    );
  } else {
    const erroVencimento =
      e.matriculaPrimeiroVencimento === null
        ? "Informe o 1º vencimento."
        : validarPrimeiroVencimento(
            e.matriculaPrimeiroVencimento,
            e.dataMatricula,
            e.anoLetivo,
            e.matriculaParcelas,
          );
    if (erroVencimento || e.matriculaPrimeiroVencimento === null) {
      pendente("matricula", `1º vencimento da Matrícula inválido — ${erroVencimento}`);
    } else {
      // Ano em curso: valor proporcional aos meses restantes a partir do início.
      const { valor, proporcao } = parcelamentoMatriculaDisponivel(
        e.matriculaValor,
        e.dataMatricula,
        e.anoLetivo,
        e.dataInicio,
      );
      const [, ...demais] = vencimentosAPartirDe(
        e.matriculaPrimeiroVencimento,
        e.matriculaParcelas,
      );
      lancamentos.push(
        parcelado(
          "matricula",
          CATEGORIA_MATRICULA_SPONTE,
          valor,
          [vencimentoEfetivoPrimeiraParcela(e.matriculaPrimeiroVencimento), ...demais],
          `Matrícula ${e.anoLetivo} — ${e.serie}` +
            (proporcao ? ` — proporcional ${proporcao.meses}/${proporcao.de}` : ""),
        ),
      );
    }
  }

  // Mensalidade: só o valor vem do plano do Sponte; datas do calendário.
  const problemaMensalidade = problemaMensalidadeDoPlano(e.plano, e.anoLetivo);
  if (problemaMensalidade) {
    pendente("mensalidade", problemaMensalidade);
  } else if (mensalidades.length === 0) {
    pendente(
      "mensalidade",
      `Não há mensalidade de ${e.anoLetivo} a vencer após ${e.dataMatricula}.`,
    );
  } else if (e.plano) {
    lancamentos.push(
      mensal(
        "mensalidade",
        CATEGORIA_MENSALIDADE_SPONTE,
        e.plano.mensalidade.valorParcela,
        cronograma,
        `Mensalidade ${e.anoLetivo} — ${e.serie}`,
      ),
    );
  }

  // Material: valor anual do School Hub, parcelas limitadas às mensalidades
  // restantes, 1ª na data da 1ª mensalidade do calendário.
  if (e.materialValorAnual === null || Math.round(e.materialValorAnual * 100) <= 0) {
    pendente(
      "material",
      `Material pedagógico da série "${e.serie}" sem valor configurado — lance na mão.`,
    );
  } else if (e.materialParcelas === null || !parcelasMaterialValida(e.materialParcelas)) {
    pendente("material", "Número de parcelas do material inválido — confirme com o responsável.");
  } else if (mensalidades.length === 0) {
    pendente(
      "material",
      `Não há mês de ${e.anoLetivo} a vencer para ancorar o material — lance na mão.`,
    );
  } else {
    const parcelas = Math.min(e.materialParcelas, maxParcelasMaterial(mensalidades.length));
    lancamentos.push(
      parcelado(
        "material",
        CATEGORIA_MATERIAL_SPONTE,
        e.materialValorAnual,
        mensalidades.slice(0, parcelas),
        `Material pedagógico ${e.anoLetivo} — matrícula em ${parcelas}x`,
      ),
    );
  }

  // Refeições e hora extra: um lançamento mensal por item pelo mesmo
  // cronograma da mensalidade (1º mês proporcional quando for o caso).
  for (const extra of calcularExtrasPelaRotina(e)) {
    if (extra.pendencia !== null) {
      pendente(extra.tipo, extra.pendencia);
    } else if (cronograma.length === 0) {
      pendente(
        extra.tipo,
        `${extra.categoria} marcado na rotina, mas não há mês de ${e.anoLetivo} a vencer — lance na mão.`,
      );
    } else {
      lancamentos.push(
        mensal(extra.tipo, extra.categoria, extra.valorMensal, cronograma, extra.observacao),
      );
    }
  }

  return { lancamentos, pendencias };
}

export type StatusFaturamentoGeral = "lancado" | "parcial" | "sem_lancamento";

/**
 * Status geral do conjunto: `lancado` (todos os tipos aplicáveis lançados),
 * `parcial` (algum lançado e algum pendente/erro) ou `sem_lancamento` (nenhum).
 */
export function statusGeralFaturamento(
  lancados: number,
  comProblema: number,
): StatusFaturamentoGeral {
  if (lancados === 0) return "sem_lancamento";
  return comProblema === 0 ? "lancado" : "parcial";
}

/** Ajustes parcela a parcela: o que difere do que o Sponte gera a partir do 1º vencimento. */
export function parcelasComAjuste(
  l: LancamentoPlanejado,
): { numero: number; valor: number; vencimento: string }[] {
  const ajustes: { numero: number; valor: number; vencimento: string }[] = [];
  for (let i = 0; i < l.parcelas; i++) {
    const valor = i === 0 ? l.valorPrimeiraParcela : l.valorParcela;
    const vencimentoNominal = i === 0 ? l.primeiroVencimento : addMesesYMD(l.primeiroVencimento, i);
    const vencimento = l.vencimentos[i] ?? vencimentoNominal;
    if (
      Math.round(valor * 100) !== Math.round(l.valorParcela * 100) ||
      vencimento !== vencimentoNominal
    ) {
      ajustes.push({ numero: i + 1, valor, vencimento });
    }
  }
  return ajustes;
}
