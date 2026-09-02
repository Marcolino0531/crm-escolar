// Faturamento automático da matrícula nova (Fase 3): lógica pura, sem rede.
//
// Matrícula e mensalidade vêm do plano NATIVO do Sponte (GetPlanosCursos), lido
// pelo curso da série e pelo ano letivo escolhido no formulário. Material vem da
// configuração local "Material Pedagógico por Série" com o número de parcelas
// que o responsável escolheu (1 a 8). Alimentação e hora extra vêm da
// configuração própria por unidade, porque o Sponte não tem esses conceitos
// estruturados.
//
// Tudo aqui é planejamento: nenhum valor é lançado sem plano válido, e cada
// lacuna de configuração volta como pendência para a secretaria resolver.

import { proximoDiaUtil } from "@/lib/billing-schedule";
import { addMesesYMD } from "@/lib/confissao-divida";
import { DIAS_UTEIS, REFEICOES_ROTINA, type RefeicoesRotina } from "@/lib/matricula-form";
import {
  CATEGORIA_MATERIAL_SPONTE,
  formatarBRL,
  parcelamentoMaterialPrimeira,
  parcelasMaterialValida,
} from "@/lib/rematricula";
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

function itemUtilizavel(item: ItemPlanoCurso): boolean {
  return (
    Number.isInteger(item.parcelas) &&
    item.parcelas >= 1 &&
    Math.round(item.valorParcela * 100) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.dataInicial)
  );
}

/**
 * Problemas que impedem usar o plano como base do faturamento. Lista vazia = o
 * plano tem matrícula e mensalidade com valor, quantidade e data coerentes.
 */
export function problemasDoPlano(plano: PlanoCursoSponte, anoLetivo: number): string[] {
  const problemas: string[] = [];
  if (!plano.ativo) problemas.push("O plano do curso está inativo no Sponte.");
  if (anoDoPlanoCurso(plano.descricaoPlano) !== anoLetivo) {
    problemas.push(`O plano "${plano.descricaoPlano}" não é do ano letivo ${anoLetivo}.`);
  }
  if (!itemUtilizavel(plano.matricula)) {
    problemas.push("O plano do curso não tem valor de matrícula com data de vencimento.");
  }
  if (!itemUtilizavel(plano.mensalidade)) {
    problemas.push("O plano do curso não tem valor de mensalidade com data de vencimento.");
  }
  return problemas;
}

// ─── Cronogramas ────────────────────────────────────────────────────────────

/** Vencimentos mensais a partir de `primeiro`, um por parcela, sempre em dia útil. */
export function vencimentosMensais(primeiro: string, parcelas: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) {
    throw new Error("Primeiro vencimento inválido (esperado YYYY-MM-DD).");
  }
  const total = Math.trunc(parcelas);
  if (total < 1) return [];
  const datas: string[] = [];
  for (let i = 0; i < total; i++) {
    datas.push(i === 0 ? primeiro : proximoDiaUtil(addMesesYMD(primeiro, i)));
  }
  return datas;
}

/**
 * Mensalidades que ainda serão cobradas: as do cronograma do plano com
 * vencimento a partir de hoje. Mês já vencido não é recobrado — quando o aluno
 * entra depois do vencimento do mês corrente, o mês de entrada vira o
 * proporcional.
 */
export function mensalidadesAVencer(
  plano: PlanoCursoSponte,
  hojeYMD: string,
): { vencimentos: string[]; puladas: string[] } {
  const todos = itemUtilizavel(plano.mensalidade)
    ? vencimentosMensais(plano.mensalidade.dataInicial, plano.mensalidade.parcelas)
    : [];
  return {
    vencimentos: todos.filter((v) => v >= hojeYMD),
    puladas: todos.filter((v) => v < hojeYMD),
  };
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Mensalidade proporcional do mês de entrada: dias restantes (contando o dia da
 * matrícula) ÷ dias do mês × valor da mensalidade. O Sponte não tem cálculo
 * nativo para isso (confirmado na Fase 0), então é lançado como título de uma
 * parcela.
 */
export function mensalidadeProporcional(valorMensalidade: number, dataMatricula: string): number {
  const [ano, mes, dia] = dataMatricula.split("-").map((v) => parseInt(v, 10));
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || !Number.isFinite(dia)) return 0;
  const total = diasNoMes(ano, mes);
  const restantes = Math.max(0, Math.min(total, total - dia + 1));
  return Math.round(valorMensalidade * 100 * (restantes / total)) / 100;
}

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

export type TipoLancamentoMatricula =
  | "matricula"
  | "mensalidade"
  | "proporcional"
  | "material"
  | "alimentacao"
  | "hora_extra";

export interface LancamentoPlanejado {
  tipo: TipoLancamentoMatricula;
  categoria: string;
  parcelas: number;
  // Valor das parcelas iguais (o que vai em nValorParcelas do InsertPlano).
  valorParcela: number;
  // Primeira parcela: absorve a sobra de centavos, como na tela nativa. Exige
  // UpdateParcela quando `ajustaPrimeira`.
  valorPrimeiraParcela: number;
  primeiroVencimento: string;
  total: number;
  ajustaPrimeira: boolean;
  observacao: string;
}

export interface EntradaFaturamentoMatricula {
  plano: PlanoCursoSponte;
  anoLetivo: number;
  // Data da matrícula (YYYY-MM-DD), que também é o "hoje" do cronograma.
  dataMatricula: string;
  serie: string;
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
  pendencias: string[];
}

function parcelado(
  tipo: TipoLancamentoMatricula,
  categoria: string,
  total: number,
  parcelas: number,
  primeiroVencimento: string,
  observacao: string,
): LancamentoPlanejado {
  const totalCentavos = Math.round(total * 100);
  const base = Math.floor(totalCentavos / parcelas);
  const primeira = totalCentavos - base * (parcelas - 1);
  return {
    tipo,
    categoria,
    parcelas,
    valorParcela: base / 100,
    valorPrimeiraParcela: primeira / 100,
    primeiroVencimento,
    total: totalCentavos / 100,
    ajustaPrimeira: primeira !== base,
    observacao,
  };
}

/**
 * Cronograma financeiro completo da matrícula nova. Retorna os títulos a lançar
 * e as pendências do que não pôde ser calculado — sem plano utilizável nada é
 * lançado, para não gerar cobrança errada.
 */
export function montarPlanoFaturamento(e: EntradaFaturamentoMatricula): PlanoFaturamentoMatricula {
  const pendencias = problemasDoPlano(e.plano, e.anoLetivo);
  if (pendencias.length > 0) return { lancamentos: [], pendencias };

  const lancamentos: LancamentoPlanejado[] = [];
  const fimAnoLetivo = `${e.anoLetivo}-12-31`;

  // Matrícula (taxa única do plano do Sponte).
  const vencMatricula = e.plano.matricula.dataInicial;
  lancamentos.push(
    parcelado(
      "matricula",
      CATEGORIA_MATRICULA_SPONTE,
      e.plano.matricula.valorParcela * e.plano.matricula.parcelas,
      e.plano.matricula.parcelas,
      vencMatricula >= e.dataMatricula ? vencMatricula : proximoDiaUtil(e.dataMatricula),
      `Matrícula ${e.anoLetivo} — ${e.serie}`,
    ),
  );

  // Mensalidades do plano, só as que ainda vencem.
  const { vencimentos, puladas } = mensalidadesAVencer(e.plano, e.dataMatricula);
  if (vencimentos.length > 0) {
    lancamentos.push({
      tipo: "mensalidade",
      categoria: CATEGORIA_MENSALIDADE_SPONTE,
      parcelas: vencimentos.length,
      valorParcela: e.plano.mensalidade.valorParcela,
      valorPrimeiraParcela: e.plano.mensalidade.valorParcela,
      primeiroVencimento: vencimentos[0],
      total: Math.round(e.plano.mensalidade.valorParcela * vencimentos.length * 100) / 100,
      ajustaPrimeira: false,
      observacao: `Mensalidade ${e.anoLetivo} — ${e.serie}`,
    });
  }

  // Proporcional: só quando a mensalidade do mês de entrada já venceu e o aluno
  // entra com o mês em curso.
  const mesEntrada = e.dataMatricula.slice(0, 7);
  const mensalidadeDoMesJaVencida = puladas.some((v) => v.slice(0, 7) === mesEntrada);
  if (mensalidadeDoMesJaVencida) {
    const valor = mensalidadeProporcional(e.plano.mensalidade.valorParcela, e.dataMatricula);
    if (Math.round(valor * 100) > 0) {
      lancamentos.push(
        parcelado(
          "proporcional",
          CATEGORIA_MENSALIDADE_SPONTE,
          valor,
          1,
          proximoDiaUtil(e.dataMatricula),
          `Mensalidade proporcional de entrada — ${e.serie}`,
        ),
      );
    }
  }

  // Material: valor anual da configuração local, parcelas escolhidas pelo
  // responsável, sobra de centavos na 1ª parcela.
  if (e.materialValorAnual === null || Math.round(e.materialValorAnual * 100) <= 0) {
    pendencias.push(
      `Material pedagógico da série "${e.serie}" sem valor configurado — lance na mão.`,
    );
  } else if (e.materialParcelas === null || !parcelasMaterialValida(e.materialParcelas)) {
    pendencias.push("Número de parcelas do material inválido — confirme com o responsável.");
  } else {
    const op = parcelamentoMaterialPrimeira(e.materialValorAnual, e.materialParcelas);
    const primeiro = vencimentos[0] ?? proximoDiaUtil(e.dataMatricula);
    lancamentos.push({
      tipo: "material",
      categoria: CATEGORIA_MATERIAL_SPONTE,
      parcelas: op.parcelas,
      valorParcela: op.valorParcela,
      valorPrimeiraParcela: op.valorPrimeiraParcela,
      primeiroVencimento: primeiro,
      total: op.total,
      ajustaPrimeira:
        Math.round(op.valorPrimeiraParcela * 100) !== Math.round(op.valorParcela * 100),
      observacao: `Material pedagógico ${e.anoLetivo} — matrícula em ${op.parcelas}x`,
    });
  }

  // Alimentação: total real das refeições marcadas até o fim do ano letivo,
  // dividido nos meses que ainda vencem.
  const refeicoesContratadas = !e.semRefeicoes;
  if (refeicoesContratadas) {
    const quantidade = contarRefeicoesNoPeriodo(e.refeicoes, e.dataMatricula, fimAnoLetivo);
    if (quantidade > 0) {
      if (e.valorRefeicao === null || Math.round(e.valorRefeicao * 100) <= 0) {
        pendencias.push(
          "Alimentação marcada na rotina, mas a unidade não tem valor por refeição configurado — lance na mão.",
        );
      } else if (vencimentos.length === 0) {
        pendencias.push(
          "Alimentação marcada na rotina, mas não há mensalidade a vencer para ancorar as parcelas — lance na mão.",
        );
      } else {
        lancamentos.push(
          parcelado(
            "alimentacao",
            CATEGORIA_ALIMENTACAO_SPONTE,
            Math.round(quantidade * e.valorRefeicao * 100) / 100,
            vencimentos.length,
            vencimentos[0],
            `Alimentação ${e.anoLetivo} — ${quantidade} refeições (${formatarBRL(e.valorRefeicao)} cada)`,
          ),
        );
      }
    }
  }

  // Hora extra: mensalidade do horário estendido, uma parcela por mês a vencer.
  if (e.horarioEstendido) {
    if (e.valorHoraExtraMensal === null || Math.round(e.valorHoraExtraMensal * 100) <= 0) {
      pendencias.push(
        "Horário estendido contratado, mas a unidade não tem valor de hora extra configurado — lance na mão.",
      );
    } else if (vencimentos.length === 0) {
      pendencias.push(
        "Horário estendido contratado, mas não há mensalidade a vencer para ancorar as parcelas — lance na mão.",
      );
    } else {
      lancamentos.push({
        tipo: "hora_extra",
        categoria: CATEGORIA_HORA_EXTRA_SPONTE,
        parcelas: vencimentos.length,
        valorParcela: e.valorHoraExtraMensal,
        valorPrimeiraParcela: e.valorHoraExtraMensal,
        primeiroVencimento: vencimentos[0],
        total: Math.round(e.valorHoraExtraMensal * vencimentos.length * 100) / 100,
        ajustaPrimeira: false,
        observacao: `Horário estendido ${e.anoLetivo} — ${e.serie}`,
      });
    }
  }

  return { lancamentos, pendencias };
}
