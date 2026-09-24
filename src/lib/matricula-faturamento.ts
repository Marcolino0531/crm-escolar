// Faturamento automático da matrícula nova (Fase 3): lógica pura, sem rede.
//
// Cada cobrança tem origem própria e é calculada de forma independente:
// - Matrícula: "Valor da Matrícula" do School Hub (colégio × segmento) com
//   parcelas e 1º vencimento escolhidos pelo responsável;
// - Mensalidade: só o VALOR da parcela do plano do curso no Sponte
//   (GetPlanosCursos); as datas vêm do calendário (dia 05, fev–dez);
// - Material: valor anual do "Material Pedagógico por Série", parcelas do
//   formulário limitadas às mensalidades restantes;
// - Alimentação e hora extra: valores por unidade, nos meses do calendário.
//
// Tudo aqui é planejamento: cada lacuna vira pendência só do seu tipo.

import { addDaysYMD, proximoDiaUtil } from "@/lib/billing-schedule";
import { addMesesYMD } from "@/lib/confissao-divida";
import { DIAS_UTEIS, REFEICOES_ROTINA, type RefeicoesRotina } from "@/lib/matricula-form";
import {
  CATEGORIA_MATERIAL_SPONTE,
  PARCELAS_MATERIAL_MAX,
  formatarBRL,
  parcelasMaterialValida,
} from "@/lib/rematricula";
import { parcelasMatriculaValida, validarPrimeiroVencimento } from "@/lib/rematricula-matricula";
import type { Weekday } from "@/lib/diario";

// Categorias do plano de contas do Sponte usadas nos lançamentos. Os nomes são
// os mesmos nas unidades (os IDs, não), então a resolução continua sendo por
// GetCategorias na unidade da submissão.
export const CATEGORIA_MATRICULA_SPONTE = "Matrícula";
export const CATEGORIA_MENSALIDADE_SPONTE = "Mensalidade";
export const CATEGORIA_ALIMENTACAO_SPONTE = "Alimentação e Integral Extras";
export const CATEGORIA_HORA_EXTRA_SPONTE = "Hora Extra";

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

/**
 * Vencimentos das mensalidades do ano letivo a partir da data de preenchimento:
 * - antes de fevereiro (inclusive o ano anterior): 11, de 05/02 a 05/12;
 * - mês M (fev–dez) até o dia 05: começa em 05/M;
 * - mês M depois do dia 05: a de M vence no próximo dia útil após o
 *   preenchimento, as seguintes no dia 05 até dezembro;
 * - depois do ano letivo: nenhuma.
 */
export function vencimentosMensalidade(anoLetivo: number, dataPreenchimento: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPreenchimento)) {
    throw new Error("Data de preenchimento inválida (esperado YYYY-MM-DD).");
  }
  const [ano, mes, dia] = dataPreenchimento.split("-").map(Number);
  if (ano > anoLetivo) return [];
  const datas: string[] = [];
  let mesInicio = PRIMEIRO_MES_MENSALIDADE;
  if (ano === anoLetivo && mes >= PRIMEIRO_MES_MENSALIDADE) {
    if (dia > DIA_VENCIMENTO_MENSALIDADE) {
      datas.push(proximoDiaUtil(addDaysYMD(dataPreenchimento, 1)));
      mesInicio = mes + 1;
    } else {
      mesInicio = mes;
    }
  }
  for (let m = mesInicio; m <= ULTIMO_MES_MENSALIDADE; m++) datas.push(dia5Util(anoLetivo, m));
  return datas;
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

/** Opções de parcelas do material exibidas no formulário para a data. */
export function opcoesParcelasMaterial(anoLetivo: number, dataPreenchimento: string): number[] {
  const restantes = vencimentosMensalidade(anoLetivo, dataPreenchimento).length;
  if (restantes === 0) return [1];
  const max = maxParcelasMaterial(restantes);
  return Array.from({ length: max }, (_, i) => i + 1);
}

// ─── Rotina ─────────────────────────────────────────────────────────────────

/** Ocorrências de cada refeição marcada entre duas datas, inclusive. */
export function contarRefeicoesNoPeriodo(
  refeicoes: RefeicoesRotina,
  inicioYMD: string,
  fimYMD: string,
): number {
  if (inicioYMD > fimYMD) return 0;
  const porDia = new Map<Weekday, number>();
  for (const meal of REFEICOES_ROTINA) {
    for (const dia of refeicoes[meal]) {
      if (!DIAS_UTEIS.includes(dia)) continue;
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
    }
  }
  if (porDia.size === 0) return 0;

  const [ai, mi, di] = inicioYMD.split("-").map(Number);
  const [af, mf, df] = fimYMD.split("-").map(Number);
  const cursor = new Date(Date.UTC(ai, mi - 1, di));
  const fim = Date.UTC(af, mf - 1, df);
  let total = 0;
  while (cursor.getTime() <= fim) {
    // getUTCDay: 1=segunda … 5=sexta, mesma chave do Diário.
    total += porDia.get(cursor.getUTCDay() as Weekday) ?? 0;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

// ─── Plano de faturamento ───────────────────────────────────────────────────

// "proporcional" fica só por compatibilidade com lançamentos antigos: o
// formulário não gera mais esse tipo.
export type TipoLancamentoMatricula =
  | "matricula"
  | "mensalidade"
  | "proporcional"
  | "material"
  | "alimentacao"
  | "hora_extra";

export const TIPOS_LANCAMENTO_FORMULARIO: readonly TipoLancamentoMatricula[] = [
  "matricula",
  "mensalidade",
  "material",
  "alimentacao",
  "hora_extra",
];

export const ROTULO_TIPO_LANCAMENTO: Record<TipoLancamentoMatricula, string> = {
  matricula: "Matrícula",
  mensalidade: "Mensalidade",
  proporcional: "Mensalidade proporcional",
  material: "Material pedagógico",
  alimentacao: "Alimentação",
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
  // Data do preenchimento (YYYY-MM-DD), que também é o "hoje" do cronograma.
  dataMatricula: string;
  serie: string;
  // Matrícula: valor do School Hub (por colégio e segmento) e escolha do responsável.
  matriculaValor: number | null;
  matriculaParcelas: number | null;
  matriculaPrimeiroVencimento: string | null;
  materialValorAnual: number | null;
  materialParcelas: number | null;
  refeicoes: RefeicoesRotina;
  semRefeicoes: boolean;
  valorRefeicao: number | null;
  horarioEstendido: boolean;
  valorHoraExtraMensal: number | null;
}

export interface PlanoFaturamentoMatricula {
  lancamentos: LancamentoPlanejado[];
  pendencias: PendenciaLancamento[];
}

export const MSG_MATRICULA_SEM_VALOR =
  "O valor da Matrícula ainda não está disponível. A secretaria vai combinar o pagamento com você.";

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

function mensal(
  tipo: TipoLancamentoMatricula,
  categoria: string,
  valorParcela: number,
  vencimentos: string[],
  observacao: string,
): LancamentoPlanejado {
  return {
    tipo,
    categoria,
    parcelas: vencimentos.length,
    valorParcela,
    valorPrimeiraParcela: valorParcela,
    primeiroVencimento: vencimentos[0],
    vencimentos,
    total: Math.round(valorParcela * vencimentos.length * 100) / 100,
    observacao,
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
  const fimAnoLetivo = `${e.anoLetivo}-12-31`;
  const mensalidades = vencimentosMensalidade(e.anoLetivo, e.dataMatricula);

  // Matrícula: valor do School Hub, parcelas e 1º vencimento escolhidos pelo responsável.
  if (e.matriculaValor === null || Math.round(e.matriculaValor * 100) <= 0) {
    pendente(
      "matricula",
      `Valor da Matrícula de ${e.anoLetivo} não cadastrado para a série "${e.serie}" no colégio — combine o pagamento com o responsável.`,
    );
  } else if (
    e.matriculaParcelas === null ||
    !parcelasMatriculaValida(e.matriculaParcelas, e.dataMatricula)
  ) {
    pendente(
      "matricula",
      "Número de parcelas da Matrícula inválido para a data — confirme com o responsável.",
    );
  } else {
    const erroVencimento =
      e.matriculaPrimeiroVencimento === null
        ? "Informe o 1º vencimento."
        : validarPrimeiroVencimento(e.matriculaPrimeiroVencimento, e.dataMatricula);
    if (erroVencimento || e.matriculaPrimeiroVencimento === null) {
      pendente("matricula", `1º vencimento da Matrícula inválido — ${erroVencimento}`);
    } else {
      lancamentos.push(
        parcelado(
          "matricula",
          CATEGORIA_MATRICULA_SPONTE,
          e.matriculaValor,
          vencimentosAPartirDe(e.matriculaPrimeiroVencimento, e.matriculaParcelas),
          `Matrícula ${e.anoLetivo} — ${e.serie}`,
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
        mensalidades,
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

  // Alimentação: total real das refeições marcadas até o fim do ano letivo,
  // dividido nos meses do calendário.
  if (!e.semRefeicoes) {
    const quantidade = contarRefeicoesNoPeriodo(e.refeicoes, e.dataMatricula, fimAnoLetivo);
    if (quantidade > 0) {
      if (e.valorRefeicao === null || Math.round(e.valorRefeicao * 100) <= 0) {
        pendente(
          "alimentacao",
          "Alimentação marcada na rotina, mas a unidade não tem valor por refeição configurado — lance na mão.",
        );
      } else if (mensalidades.length === 0) {
        pendente(
          "alimentacao",
          "Alimentação marcada na rotina, mas não há mês a vencer para as parcelas — lance na mão.",
        );
      } else {
        lancamentos.push(
          parcelado(
            "alimentacao",
            CATEGORIA_ALIMENTACAO_SPONTE,
            Math.round(quantidade * e.valorRefeicao * 100) / 100,
            mensalidades,
            `Alimentação ${e.anoLetivo} — ${quantidade} refeições (${formatarBRL(e.valorRefeicao)} cada)`,
          ),
        );
      }
    }
  }

  // Hora extra: mensalidade do horário estendido, uma parcela por mês do calendário.
  if (e.horarioEstendido) {
    if (e.valorHoraExtraMensal === null || Math.round(e.valorHoraExtraMensal * 100) <= 0) {
      pendente(
        "hora_extra",
        "Horário estendido contratado, mas a unidade não tem valor de hora extra configurado — lance na mão.",
      );
    } else if (mensalidades.length === 0) {
      pendente(
        "hora_extra",
        "Horário estendido contratado, mas não há mês a vencer para as parcelas — lance na mão.",
      );
    } else {
      lancamentos.push(
        mensal(
          "hora_extra",
          CATEGORIA_HORA_EXTRA_SPONTE,
          e.valorHoraExtraMensal,
          mensalidades,
          `Horário estendido ${e.anoLetivo} — ${e.serie}`,
        ),
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
