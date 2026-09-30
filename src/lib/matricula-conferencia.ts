// Conferência de uma submissão do formulário de matrícula contra o Sponte
// ("Verificar no Sponte" na tela Matrículas). Tudo aqui é puro: o esperado vem
// só do próprio envio (rotina gravada da submissão e linhas de
// matricula_faturamento_lancamentos) e o encontrado vem de leituras do Sponte
// feitas pelo servidor. Nada é recalculado com a configuração atual.

import { formatarBRL } from "@/lib/atendimento-ia";
import { normalizarCategoria } from "@/lib/diario-auditoria";
import { dataBR } from "@/lib/matricula-integracao";
import {
  CATEGORIA_SPONTE_POR_ITEM,
  ITEM_POR_REFEICAO,
  type ItemPacoteExtras,
} from "@/lib/pacotes-extras";
import { cursoIdDaSerie, type CursoSponte, type TurmaSponte } from "@/lib/matricula-turma";
import { CATEGORIA_MATERIAL_SPONTE } from "@/lib/rematricula";
import type { MealKey } from "@/lib/diario";

export type TipoConferencia = "matricula" | "mensalidade" | "material" | ItemPacoteExtras;

export const TIPOS_CONFERENCIA: readonly TipoConferencia[] = [
  "matricula",
  "mensalidade",
  "material",
  "lanche_manha",
  "almoco",
  "lanche_tarde",
  "jantar",
  "hora_extra",
];

export const CATEGORIA_CONFERENCIA: Record<TipoConferencia, string> = {
  matricula: "Matrícula",
  mensalidade: "Mensalidade",
  material: CATEGORIA_MATERIAL_SPONTE,
  ...CATEGORIA_SPONTE_POR_ITEM,
};

export function ehTipoConferencia(tipo: string): tipo is TipoConferencia {
  return (TIPOS_CONFERENCIA as readonly string[]).includes(tipo);
}

// ─── Esperado (do próprio envio) ────────────────────────────────────────────

export interface PlanoEsperado {
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  total: number;
  primeiroVencimento: string | null;
}

export interface JanelaVencimento {
  de: string;
  ate: string;
}

export interface ItemEsperado {
  tipo: TipoConferencia;
  categoria: string;
  /** Situação do item no envio: status da linha de lançamento ou "sem_registro". */
  situacaoNoEnvio: string;
  plano: PlanoEsperado | null;
  janela: JanelaVencimento;
}

export interface LancamentoEnvio {
  tipo: string;
  parcelas: number | null;
  valor_parcela: number | null;
  valor_primeira_parcela: number | null;
  total: number | null;
  primeiro_vencimento: string | null;
  status: string;
}

export interface RotinaEnvio {
  semRefeicoes: boolean;
  refeicoes: Partial<Record<MealKey, number[]>> | Record<string, number[]>;
  horarioEstendido: boolean;
}

/**
 * Janela de vencimento aceita para o item: o ano letivo inteiro; para a
 * Matrícula, do preenchimento até 31/01 do ano letivo (até 31/12 quando o
 * preenchimento já é no ano letivo em curso).
 */
export function janelaDoItem(
  tipo: TipoConferencia,
  anoLetivo: number,
  dataPreenchimento: string,
): JanelaVencimento {
  const anoTodo = { de: `${anoLetivo}-01-01`, ate: `${anoLetivo}-12-31` };
  if (tipo !== "matricula") return anoTodo;
  const ate = dataPreenchimento >= `${anoLetivo}-01-01` ? anoTodo.ate : `${anoLetivo}-01-31`;
  return { de: dataPreenchimento, ate };
}

function planoDaLinha(l: LancamentoEnvio): PlanoEsperado | null {
  const parcelas = Math.trunc(Number(l.parcelas ?? 0));
  const total = Number(l.total ?? 0);
  if (parcelas < 1 || !(total > 0)) return null;
  return {
    parcelas,
    valorParcela: Number(l.valor_parcela ?? 0),
    valorPrimeiraParcela: Number(l.valor_primeira_parcela ?? l.valor_parcela ?? 0),
    total,
    primeiroVencimento: l.primeiro_vencimento ? l.primeiro_vencimento.slice(0, 10) : null,
  };
}

/**
 * Itens esperados do envio: Matrícula, Mensalidade e Material sempre; cada
 * refeição marcada na rotina gravada; Hora Extra quando a rotina é estendida;
 * e qualquer outro item que tenha linha de lançamento na submissão.
 */
export function montarEsperadoConferencia(entrada: {
  anoLetivo: number;
  dataPreenchimento: string;
  rotina: RotinaEnvio | null;
  lancamentos: readonly LancamentoEnvio[];
}): ItemEsperado[] {
  const tipos = new Set<TipoConferencia>(["matricula", "mensalidade", "material"]);
  const rotina = entrada.rotina;
  if (rotina && !rotina.semRefeicoes) {
    for (const [refeicao, dias] of Object.entries(rotina.refeicoes ?? {})) {
      const item = ITEM_POR_REFEICAO[refeicao as MealKey];
      if (item && Array.isArray(dias) && dias.length > 0) tipos.add(item);
    }
  }
  if (rotina?.horarioEstendido) tipos.add("hora_extra");
  const linhas = new Map<TipoConferencia, LancamentoEnvio>();
  for (const l of entrada.lancamentos) {
    if (!ehTipoConferencia(l.tipo)) continue;
    tipos.add(l.tipo);
    linhas.set(l.tipo, l);
  }

  return TIPOS_CONFERENCIA.filter((t) => tipos.has(t)).map((tipo) => {
    const linha = linhas.get(tipo);
    return {
      tipo,
      categoria: CATEGORIA_CONFERENCIA[tipo],
      situacaoNoEnvio: linha?.status ?? "sem_registro",
      plano: linha ? planoDaLinha(linha) : null,
      janela: janelaDoItem(tipo, entrada.anoLetivo, entrada.dataPreenchimento),
    };
  });
}

// ─── Encontrado no Sponte ───────────────────────────────────────────────────

export interface ParcelaSponte {
  contaReceberId: string;
  numeroParcela: string;
  vencimento: string; // YYYY-MM-DD
  categoria: string;
  valor: number;
  situacao: string;
}

export interface MatriculaSponteAluno {
  contratoId: number | null;
  turmaId: number | null;
  turma: string;
  situacao: string;
}

// ─── Resultado ──────────────────────────────────────────────────────────────

/** ok = encontrado igual ao plano; aviso = encontrado com diferença (também aceito). */
export type SituacaoItemConferencia = "ok" | "aviso" | "faltando" | "dispensado";

export interface EncontradoItem {
  parcelas: number;
  total: number;
  valores: number[];
  vencimentos: string[];
  contasReceber: string[];
}

export interface ItemConferido {
  tipo: TipoConferencia;
  categoria: string;
  situacao: SituacaoItemConferencia;
  situacaoNoEnvio: string;
  janela: JanelaVencimento;
  esperado: PlanoEsperado | null;
  encontrado: EncontradoItem | null;
  avisos: string[];
  motivoDispensa: string | null;
}

export interface TurmaConferida {
  ok: boolean;
  serie: string;
  anoLetivo: number;
  turmaNome: string | null;
  turmaId: number | null;
  contratoId: number | null;
  mensagem: string;
}

export interface ResultadoConferencia {
  versao: 1;
  verificadoEm: string;
  verificadoPor: string;
  turma: TurmaConferida;
  itens: ItemConferido[];
  /** Turma ok e todos os itens ok, com aviso ou dispensados. */
  fixavel: boolean;
  faltando: string[];
  avisos: string[];
}

export const MENSAGEM_CONFERIDO = "Conferido: turma e cobranças de acordo com o Sponte.";

/** Colunas da submissão que nenhuma rotina automática altera depois de conferida. */
export const CAMPOS_FIXADOS_CONFERENCIA: readonly string[] = [
  "turma_status",
  "turma_nome",
  "turma_pendencia",
  "faturamento_status",
  "faturamento_pendencia",
  "pendencia_resolvida_em",
  "pendencia_resolvida_por",
];

export function tocaCamposFixados(campos: Record<string, unknown>): boolean {
  return Object.keys(campos).some((k) => CAMPOS_FIXADOS_CONFERENCIA.includes(k));
}

export function mensagemTurmaNaoEncontrada(serie: string, anoLetivo: number): string {
  return `Turma não encontrada no Sponte para ${serie} ${anoLetivo}`;
}

function contratoVigente(situacao: string): boolean {
  return normalizarCategoria(situacao) === "vigente";
}

/**
 * Turma do envio: contrato vigente do aluno numa turma do ano letivo cujo
 * curso é o da série do envio.
 */
export function conferirTurma(entrada: {
  serie: string;
  anoLetivo: number;
  matriculas: readonly MatriculaSponteAluno[];
  turmasDoAno: readonly TurmaSponte[];
  cursos: readonly CursoSponte[];
}): TurmaConferida {
  const base = { serie: entrada.serie, anoLetivo: entrada.anoLetivo };
  const cursoId = cursoIdDaSerie(entrada.serie, entrada.cursos);
  const turmasDaSerie = new Map(
    entrada.turmasDoAno
      .filter((t) => cursoId !== null && t.cursoId === cursoId)
      .filter((t) => t.anoLetivo === null || t.anoLetivo === entrada.anoLetivo)
      .map((t) => [t.turmaId, t]),
  );
  const achados = entrada.matriculas
    .filter(
      (m) => contratoVigente(m.situacao) && m.turmaId !== null && turmasDaSerie.has(m.turmaId),
    )
    .sort((a, b) => (b.contratoId ?? 0) - (a.contratoId ?? 0));
  const m = achados[0];
  if (!m || m.turmaId === null) {
    return {
      ...base,
      ok: false,
      turmaNome: null,
      turmaId: null,
      contratoId: null,
      mensagem: mensagemTurmaNaoEncontrada(entrada.serie, entrada.anoLetivo),
    };
  }
  const nome = m.turma || turmasDaSerie.get(m.turmaId)?.nome || `Turma ${m.turmaId}`;
  return {
    ...base,
    ok: true,
    turmaNome: nome,
    turmaId: m.turmaId,
    contratoId: m.contratoId,
    mensagem: `Matriculado em ${nome}`,
  };
}

const centavos = (v: number) => Math.round(v * 100);

function descreverValores(valores: readonly number[], total: number): string {
  if (valores.length === 0) return "nenhuma parcela";
  const n = valores.length;
  const [primeira, ...demais] = valores;
  const iguais = valores.every((v) => centavos(v) === centavos(primeira));
  const partes = iguais
    ? `${n}x de ${formatarBRL(primeira)}`
    : demais.every((v) => centavos(v) === centavos(demais[0]))
      ? `1ª de ${formatarBRL(primeira)} + ${demais.length}x de ${formatarBRL(demais[0])}`
      : valores.map(formatarBRL).join(" + ");
  return `${partes} (total ${formatarBRL(total)})`;
}

function valoresDoPlano(p: PlanoEsperado): number[] {
  return Array.from({ length: p.parcelas }, (_, i) =>
    i === 0 ? p.valorPrimeiraParcela : p.valorParcela,
  );
}

/** Diferenças entre o plano do School Hub e o encontrado no Sponte (viram aviso). */
export function avisosDoItem(plano: PlanoEsperado | null, encontrado: EncontradoItem): string[] {
  const achado = descreverValores(encontrado.valores, encontrado.total);
  if (!plano) {
    return [
      `Sem plano do School Hub para comparar (item pendente no envio). Encontrado: ${achado}.`,
    ];
  }
  const avisos: string[] = [];
  if (plano.parcelas !== encontrado.parcelas) {
    avisos.push(`Parcelas: esperado ${plano.parcelas}x, encontrado ${encontrado.parcelas}x.`);
  }
  const esperadoValores = valoresDoPlano(plano);
  const valoresDiferentes =
    centavos(plano.total) !== centavos(encontrado.total) ||
    (esperadoValores.length === encontrado.valores.length &&
      esperadoValores.some((v, i) => centavos(v) !== centavos(encontrado.valores[i])));
  if (valoresDiferentes) {
    avisos.push(
      `Valor: esperado ${descreverValores(esperadoValores, plano.total)}, encontrado ${achado}.`,
    );
  }
  const primeiroAchado = encontrado.vencimentos[0] ?? null;
  if (plano.primeiroVencimento && primeiroAchado && plano.primeiroVencimento !== primeiroAchado) {
    avisos.push(
      `1º vencimento: esperado ${dataBR(plano.primeiroVencimento)}, encontrado ${dataBR(primeiroAchado)}.`,
    );
  }
  return avisos;
}

/**
 * Cada item esperado contra as parcelas do Sponte: mesma categoria e
 * vencimento dentro da janela do item. Encontrado = ok (ou aviso, se diferente
 * do plano); não encontrado = faltando, ou dispensado com motivo.
 */
export function conferirCobrancas(
  esperados: readonly ItemEsperado[],
  parcelas: readonly ParcelaSponte[],
  dispensas: Partial<Record<TipoConferencia, string>> = {},
): ItemConferido[] {
  return esperados.map((e) => {
    const alvo = normalizarCategoria(e.categoria);
    const doItem = parcelas
      .filter(
        (p) =>
          normalizarCategoria(p.categoria) === alvo &&
          p.vencimento >= e.janela.de &&
          p.vencimento <= e.janela.ate,
      )
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const base = {
      tipo: e.tipo,
      categoria: e.categoria,
      situacaoNoEnvio: e.situacaoNoEnvio,
      janela: e.janela,
      esperado: e.plano,
    };
    if (doItem.length === 0) {
      const motivo = (dispensas[e.tipo] ?? "").trim();
      return {
        ...base,
        situacao: motivo ? "dispensado" : "faltando",
        encontrado: null,
        avisos: [],
        motivoDispensa: motivo || null,
      };
    }
    const valores = doItem.map((p) => p.valor);
    const encontrado: EncontradoItem = {
      parcelas: doItem.length,
      total: Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100,
      valores,
      vencimentos: doItem.map((p) => p.vencimento),
      contasReceber: doItem.map((p) => p.contaReceberId).filter(Boolean),
    };
    const avisos = avisosDoItem(e.plano, encontrado);
    return {
      ...base,
      situacao: avisos.length > 0 ? "aviso" : "ok",
      encontrado,
      avisos,
      motivoDispensa: null,
    };
  });
}

export function itemAceito(item: Pick<ItemConferido, "situacao">): boolean {
  return item.situacao !== "faltando";
}

export function montarResultadoConferencia(entrada: {
  turma: TurmaConferida;
  itens: ItemConferido[];
  verificadoEm: string;
  verificadoPor: string;
}): ResultadoConferencia {
  const { turma, itens } = entrada;
  const faltando = [
    ...(turma.ok ? [] : [turma.mensagem]),
    ...itens
      .filter((i) => !itemAceito(i))
      .map(
        (i) =>
          `${i.categoria}: não encontrada no Sponte (${dataBR(i.janela.de)} a ${dataBR(i.janela.ate)})`,
      ),
  ];
  return {
    versao: 1,
    verificadoEm: entrada.verificadoEm,
    verificadoPor: entrada.verificadoPor,
    turma,
    itens,
    fixavel: turma.ok && itens.every(itemAceito),
    faltando,
    avisos: itens.flatMap((i) => i.avisos.map((a) => `${i.categoria}: ${a}`)),
  };
}

export const ROTULO_SITUACAO_ITEM: Record<SituacaoItemConferencia, string> = {
  ok: "OK",
  aviso: "AVISO",
  faltando: "FALTANDO",
  dispensado: "DISPENSADO",
};
