// Folha de Pagamento importada do Extrato Mensal — regras puras de conferência,
// ajuste manual, restituição do INSS e lote de pagamento. Todo valor em reais é
// somado/subtraído em centavos (extrato-mensal.ts) para não perder centavos.

import {
  CODIGO_INSS,
  deCentavos,
  paraCentavos,
  somaCentavos,
  somaReais,
  somenteDigitos,
  subtraiReais,
  totaisDasRubricas,
  type TipoColaborador,
  type TipoRubrica,
} from "@/lib/extrato-mensal";
import { toTitleCase } from "@/lib/name-format";
import type { ItemValorMensal } from "@/lib/rh-salario";
import type { TipoPessoaLote } from "@/lib/rh-folhas";

export type StatusColaboradorFolha = "confirmado" | "em_conferencia";
export type StatusResumo = "confirmado" | "em_conferencia" | "manual";
export type OrigemRubrica = "pdf" | "manual";

export const ROTULO_STATUS: Record<StatusResumo, string> = {
  confirmado: "Confirmado",
  em_conferencia: "Em conferência",
  manual: "Manual",
};

export type RubricaComparavel = {
  tipo: TipoRubrica;
  codigo: string;
  descricao: string;
  valor: number;
};

export type ColaboradorComparavel = {
  tipo: TipoColaborador;
  codigo: string;
  nome: string;
  cpf: string;
  situacao: string;
  proventos: number;
  descontos: number;
  liquido: number;
  rubricas: readonly RubricaComparavel[];
};

export type TipoDivergencia =
  | "novo"
  | "situacao"
  | "proventos"
  | "liquido"
  | "rubrica_nova"
  | "rubrica_removida"
  | "rubrica_valor";

export type Divergencia = {
  tipo: TipoDivergencia;
  /** Rubrica envolvida ("P 228 HORAS AULAS 2"), quando houver. */
  rubrica?: string;
  antes: string | number | null;
  depois: string | number | null;
  /** depois − antes, em reais (só divergências de valor). */
  diferenca: number | null;
};

export const ROTULO_DIVERGENCIA: Record<TipoDivergencia, string> = {
  novo: "Novo na folha",
  situacao: "Situação mudou",
  proventos: "Bruto (proventos) mudou",
  liquido: "Líquido mudou",
  rubrica_nova: "Rubrica nova",
  rubrica_removida: "Rubrica que sumiu",
  rubrica_valor: "Rubrica com valor diferente",
};

/**
 * Mesmo registro em duas folhas: tipo + código ("empregado:22"). A mesma pessoa
 * pode ter mais de um registro (contratos) com o mesmo CPF; o CPF só vincula ao RH.
 */
export function chaveColaborador(c: { tipo: TipoColaborador; codigo: string }): string {
  return `${c.tipo}:${c.codigo}`;
}

type SomaRubrica = { rotulo: string; centavos: number };

function rubricasPorCodigo(rubricas: readonly RubricaComparavel[]): Map<string, SomaRubrica> {
  const m = new Map<string, SomaRubrica>();
  for (const r of rubricas) {
    const k = `${r.tipo}:${r.codigo}`;
    const atual = m.get(k);
    if (atual) atual.centavos += paraCentavos(r.valor);
    else
      m.set(k, {
        rotulo: `${r.tipo} ${r.codigo} ${r.descricao}`.trim(),
        centavos: paraCentavos(r.valor),
      });
  }
  return m;
}

const diferencaValor = (
  tipo: TipoDivergencia,
  antes: number,
  depois: number,
  rubrica?: string,
): Divergencia | null =>
  paraCentavos(antes) === paraCentavos(depois)
    ? null
    : { tipo, rubrica, antes, depois, diferenca: subtraiReais(depois, antes) };

/** Divergências de um colaborador contra a folha anterior (null = novo na folha). */
export function divergenciasDoColaborador(
  anterior: ColaboradorComparavel | null,
  atual: ColaboradorComparavel,
): Divergencia[] {
  if (!anterior) return [{ tipo: "novo", antes: null, depois: atual.nome, diferenca: null }];
  const out: Divergencia[] = [];
  if (anterior.situacao.trim() !== atual.situacao.trim()) {
    out.push({
      tipo: "situacao",
      antes: anterior.situacao,
      depois: atual.situacao,
      diferenca: null,
    });
  }
  const p = diferencaValor("proventos", anterior.proventos, atual.proventos);
  if (p) out.push(p);
  const l = diferencaValor("liquido", anterior.liquido, atual.liquido);
  if (l) out.push(l);
  const antes = rubricasPorCodigo(anterior.rubricas);
  const depois = rubricasPorCodigo(atual.rubricas);
  for (const [k, d] of depois) {
    const a = antes.get(k);
    if (!a) {
      const v = deCentavos(d.centavos);
      out.push({ tipo: "rubrica_nova", rubrica: d.rotulo, antes: null, depois: v, diferenca: v });
    } else if (a.centavos !== d.centavos) {
      out.push({
        tipo: "rubrica_valor",
        rubrica: d.rotulo,
        antes: deCentavos(a.centavos),
        depois: deCentavos(d.centavos),
        diferenca: deCentavos(d.centavos - a.centavos),
      });
    }
  }
  for (const [k, a] of antes) {
    if (depois.has(k)) continue;
    const v = deCentavos(a.centavos);
    out.push({
      tipo: "rubrica_removida",
      rubrica: a.rotulo,
      antes: v,
      depois: null,
      diferenca: -v,
    });
  }
  return out;
}

export type ComparacaoFolhas<T extends ColaboradorComparavel> = {
  /** Mesmo índice de `atual`. */
  porColaborador: { colaborador: T; divergencias: Divergencia[] }[];
  /** Estavam na folha anterior e não estão nesta. */
  ausentes: ColaboradorComparavel[];
  /** Sem folha anterior: não há comparação. */
  primeiraImportacao: boolean;
};

export function compararFolhas<T extends ColaboradorComparavel>(
  anterior: readonly ColaboradorComparavel[] | null,
  atual: readonly T[],
): ComparacaoFolhas<T> {
  if (!anterior) {
    return {
      porColaborador: atual.map((c) => ({ colaborador: c, divergencias: [] })),
      ausentes: [],
      primeiraImportacao: true,
    };
  }
  const mapa = new Map(anterior.map((c) => [chaveColaborador(c), c]));
  const chavesAtuais = new Set(atual.map(chaveColaborador));
  return {
    porColaborador: atual.map((c) => ({
      colaborador: c,
      divergencias: divergenciasDoColaborador(mapa.get(chaveColaborador(c)) ?? null, c),
    })),
    ausentes: anterior.filter((c) => !chavesAtuais.has(chaveColaborador(c))),
    primeiraImportacao: false,
  };
}

/** Pré-seleção (por chaveColaborador): sem divergência vem marcado; com divergência, desmarcado. */
export function preSelecao<T extends ColaboradorComparavel>(cmp: ComparacaoFolhas<T>): Set<string> {
  if (cmp.primeiraImportacao) return new Set();
  return new Set(
    cmp.porColaborador
      .filter((p) => p.divergencias.length === 0)
      .map((p) => chaveColaborador(p.colaborador)),
  );
}

// ---------- Reimportação da mesma competência ----------

export type PlanoReimportacao<T extends ColaboradorComparavel> = {
  /** Iguais ao gravado (dados do PDF): nada muda. */
  iguais: T[];
  /** Diferentes do gravado: serão substituídos (e voltam para Em conferência). */
  substituidos: { colaborador: T; divergencias: Divergencia[]; tinhaAjusteManual: boolean }[];
  /** Não estavam gravados. */
  novos: T[];
  /** Estavam gravados e não vêm no PDF novo: saem da folha. */
  retirados: ColaboradorComparavel[];
};

/** Compara o PDF novo com o PDF gravado (original, sem os ajustes manuais). */
export function planejarReimportacao<T extends ColaboradorComparavel>(
  gravados: readonly (ColaboradorComparavel & { ajustadoManualmente: boolean })[],
  novo: readonly T[],
): PlanoReimportacao<T> {
  const mapa = new Map(gravados.map((g) => [chaveColaborador(g), g]));
  const plano: PlanoReimportacao<T> = { iguais: [], substituidos: [], novos: [], retirados: [] };
  const vistos = new Set<string>();
  for (const c of novo) {
    const k = chaveColaborador(c);
    vistos.add(k);
    const g = mapa.get(k);
    if (!g) {
      plano.novos.push(c);
      continue;
    }
    const div = divergenciasDoColaborador(g, c);
    const descontosIguais = paraCentavos(g.descontos) === paraCentavos(c.descontos);
    if (div.length === 0 && descontosIguais && g.nome === c.nome) plano.iguais.push(c);
    else
      plano.substituidos.push({
        colaborador: c,
        divergencias: div,
        tinhaAjusteManual: g.ajustadoManualmente,
      });
  }
  plano.retirados = gravados.filter((g) => !vistos.has(chaveColaborador(g)));
  return plano;
}

type ComLiquidoManual = {
  tipo: TipoColaborador;
  codigo: string;
  liquidoManual?: number | null;
};

type Chaveavel = { tipo: TipoColaborador; codigo: string };

export type LiquidoManualAplicado = { valor: number; herdado: boolean };

/**
 * Líquido manual de cada registro do PDF (por chaveColaborador). O líquido manual
 * é um valor fixo do colaborador: o registro novo herda o da importação anterior
 * do mesmo CNPJ (mesma chave), e o já gravado (substituído ou igual) mantém o
 * que tinha. Sem valor = fica fora do mapa (grava nulo).
 */
export function liquidosManuaisDaImportacao(
  anteriores: readonly ComLiquidoManual[],
  gravados: readonly ComLiquidoManual[],
  plano: {
    novos: readonly Chaveavel[];
    substituidos: readonly { colaborador: Chaveavel }[];
    iguais?: readonly Chaveavel[];
  },
): Map<string, LiquidoManualAplicado> {
  const valorPorChave = (rs: readonly ComLiquidoManual[]) =>
    new Map(
      rs.flatMap((r) => (r.liquidoManual != null ? [[chaveColaborador(r), r.liquidoManual]] : [])),
    );
  const doAnterior = valorPorChave(anteriores);
  const doGravado = valorPorChave(gravados);
  const out = new Map<string, LiquidoManualAplicado>();
  for (const c of plano.novos) {
    const k = chaveColaborador(c);
    const v = doAnterior.get(k);
    if (v != null) out.set(k, { valor: v, herdado: true });
  }
  for (const c of [...plano.substituidos.map((s) => s.colaborador), ...(plano.iguais ?? [])]) {
    const k = chaveColaborador(c);
    const v = doGravado.get(k);
    if (v != null) out.set(k, { valor: v, herdado: false });
  }
  return out;
}

// ---------- Ajuste manual ----------

export type RubricaFolha = RubricaComparavel & {
  referencia: string;
  origem: OrigemRubrica;
  /** Valor lido do PDF (null nas rubricas incluídas à mão). */
  valorOriginal: number | null;
  /** Rubrica do PDF retirada no ajuste: fica guardada, fora dos totais. */
  removida: boolean;
};

export type AjusteRubrica =
  | { op: "editar"; indice: number; valor: number }
  | { op: "incluir"; tipo: TipoRubrica; codigo: string; descricao: string; valor: number }
  | { op: "remover"; indice: number };

export function aplicarAjuste(
  rubricas: readonly RubricaFolha[],
  ajuste: AjusteRubrica,
): RubricaFolha[] {
  const out = rubricas.map((r) => ({ ...r }));
  if (ajuste.op === "incluir") {
    if (!ajuste.descricao.trim()) throw new Error("Informe a descrição da rubrica.");
    if (!(ajuste.valor >= 0)) throw new Error("Valor inválido.");
    out.push({
      tipo: ajuste.tipo,
      codigo: ajuste.codigo.trim(),
      descricao: ajuste.descricao.trim(),
      referencia: "",
      valor: deCentavos(paraCentavos(ajuste.valor)),
      origem: "manual",
      valorOriginal: null,
      removida: false,
    });
    return out;
  }
  const r = out[ajuste.indice];
  if (!r) throw new Error("Rubrica não encontrada.");
  if (ajuste.op === "editar") {
    if (!(ajuste.valor >= 0)) throw new Error("Valor inválido.");
    r.valor = deCentavos(paraCentavos(ajuste.valor));
    r.removida = false;
    return out;
  }
  if (r.origem === "manual") return out.filter((_, i) => i !== ajuste.indice);
  r.removida = true;
  return out;
}

export const rubricasVigentes = <T extends { removida: boolean }>(rubricas: readonly T[]) =>
  rubricas.filter((r) => !r.removida);

/** Totais depois do ajuste: proventos = Σ P; descontos = Σ D; líquido = proventos − descontos. */
export function totaisAjustados(rubricas: readonly RubricaFolha[]) {
  return totaisDasRubricas(rubricasVigentes(rubricas));
}

/** Houve alteração em relação ao PDF? */
export function foiAjustada(rubricas: readonly RubricaFolha[]): boolean {
  return rubricas.some(
    (r) =>
      r.origem === "manual" ||
      r.removida ||
      (r.valorOriginal != null && paraCentavos(r.valorOriginal) !== paraCentavos(r.valor)),
  );
}

export type RubricaDoPdf = RubricaComparavel & { referencia: string; valorHora?: string };

/**
 * Reimportação: reaplica o ajuste manual das rubricas gravadas sobre as do PDF
 * novo. Casa por tipo + código (repetidas, pela ordem de ocorrência). Removida
 * continua removida; valor editado prevalece (valorOriginal = valor do PDF novo);
 * rubricas incluídas à mão são mantidas no fim; ajuste de rubrica que saiu do PDF
 * é descartado.
 */
export function reaplicarAjusteManual(
  gravadas: readonly RubricaFolha[],
  novas: readonly RubricaDoPdf[],
): (RubricaFolha & { valorHora?: string })[] {
  const chave = (r: { tipo: TipoRubrica; codigo: string }) => `${r.tipo}:${r.codigo}`;
  const fila = new Map<string, RubricaFolha[]>();
  for (const g of gravadas) {
    if (g.origem !== "pdf") continue;
    const k = chave(g);
    fila.set(k, [...(fila.get(k) ?? []), g]);
  }
  const doPdf = novas.map((n) => {
    const g = fila.get(chave(n))?.shift();
    const editada =
      g != null &&
      g.valorOriginal != null &&
      paraCentavos(g.valorOriginal) !== paraCentavos(g.valor);
    return {
      ...n,
      valor: editada ? g.valor : n.valor,
      origem: "pdf" as const,
      valorOriginal: n.valor,
      removida: g?.removida ?? false,
    };
  });
  const manuais = gravadas
    .filter((g) => g.origem === "manual")
    .map((g) => ({ ...g, valorOriginal: null, removida: false }));
  return [...doPdf, ...manuais];
}

// ---------- Restituição do INSS ----------

/** INSS do mês = rubricas de DESCONTO de código 998 vigentes (não entram 826, 989, 843…). */
export function inssDoMes(
  rubricas: readonly (Pick<RubricaComparavel, "tipo" | "codigo" | "valor"> & {
    removida?: boolean;
  })[],
): number {
  return somaReais(
    rubricas
      .filter((r) => !r.removida && r.tipo === "D" && r.codigo === CODIGO_INSS)
      .map((r) => r.valor),
  );
}

export type ColaboradorRestituicao = {
  id: string;
  funcionarioId: string | null;
  rubricas: readonly (Pick<RubricaComparavel, "tipo" | "codigo" | "valor"> & {
    removida?: boolean;
  })[];
  /** Valor gravado no fechamento (null enquanto a competência está aberta). */
  restituicaoGravada: number | null;
};

export type LinhaRestituicao = { id: string; inss: number; restituicao: number; marcado: boolean };

/**
 * Restituição = INSS 998 do mês, só para quem está marcado. Competência
 * fechada usa o valor gravado no fechamento, mesmo que a marcação mude depois.
 */
export function restituicoesDaCompetencia(
  colaboradores: readonly ColaboradorRestituicao[],
  marcados: ReadonlySet<string>,
  fechada: boolean,
): { linhas: LinhaRestituicao[]; total: number } {
  const linhas = colaboradores.map((c) => {
    const inss = inssDoMes(c.rubricas);
    const marcado = c.funcionarioId != null && marcados.has(c.funcionarioId);
    const restituicao = fechada ? (c.restituicaoGravada ?? 0) : marcado ? inss : 0;
    return { id: c.id, inss, restituicao, marcado };
  });
  return { linhas, total: deCentavos(somaCentavos(linhas.map((l) => l.restituicao))) };
}

// ---------- Pessoa com mais de um registro (contratos) ----------

export type GrupoPessoa<T> = { chave: string; funcionarioId: string | null; registros: T[] };

/**
 * Registros da folha por pessoa: os vinculados ao mesmo funcionário do RH ficam
 * juntos; registro sem vínculo fica sozinho. Mantém a ordem da primeira aparição.
 */
export function agruparPorPessoa<T extends { id: string; funcionarioId: string | null }>(
  registros: readonly T[],
): GrupoPessoa<T>[] {
  const grupos = new Map<string, GrupoPessoa<T>>();
  for (const r of registros) {
    const chave = r.funcionarioId ? `func:${r.funcionarioId}` : `reg:${r.id}`;
    const g = grupos.get(chave);
    if (g) g.registros.push(r);
    else grupos.set(chave, { chave, funcionarioId: r.funcionarioId, registros: [r] });
  }
  return [...grupos.values()];
}

/** Quantos registros cada CPF tem na competência (para o indicador "2 contratos"). */
export function registrosPorCpf(registros: readonly { cpf: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of registros) {
    const cpf = somenteDigitos(r.cpf);
    if (cpf) m.set(cpf, (m.get(cpf) ?? 0) + 1);
  }
  return m;
}

type RegistroValores = {
  id: string;
  funcionarioId: string | null;
  status: StatusColaboradorFolha;
  proventos: number;
  liquido: number;
  /** Líquido a pagar digitado no Ajustar (nulo = paga o líquido da folha). */
  liquidoManual?: number | null;
};

/** Valor realmente pago ao registro: o líquido manual, se houver, senão o da folha. */
export function valorPago(r: { liquido: number; liquidoManual?: number | null }): number {
  return r.liquidoManual ?? r.liquido;
}

/**
 * Líquido manual a gravar no Ajustar: nulo quando igual (em centavos) ao líquido
 * calculado das rubricas; nunca negativo.
 */
export function liquidoManualDoAjuste(digitado: number, calculado: number): number | null {
  if (!Number.isFinite(digitado) || digitado < 0) {
    throw new Error("O líquido a pagar não pode ser negativo.");
  }
  const c = paraCentavos(digitado);
  return c === paraCentavos(calculado) ? null : deCentavos(c);
}

/** Lote x folha: o valor da pessoa no lote tem de ser a soma do valor pago de cada registro. */
export function conferirValorNoLote(
  registros: readonly (RegistroValores & { nome: string })[],
  totalAmount: number,
): void {
  const nome = registros[0]?.nome ?? "";
  if (registros.some((c) => c.status !== "confirmado")) {
    throw new Error(`${nome} está Em conferência e não pode entrar no lote.`);
  }
  if (somaCentavos(registros.map(valorPago)) !== paraCentavos(totalAmount)) {
    throw new Error(`O valor de ${nome} no lote difere do líquido confirmado na folha.`);
  }
}

export type SalarioDaFolha = { funcionarioId: string; valor: number; valorLiquido: number };

/**
 * funcionarios_salarios: uma linha por funcionário, com a soma dos proventos e
 * dos líquidos de TODOS os registros dele, só quando todos estão Confirmados.
 * Quem tem algum registro Em conferência não entra (a linha dele não muda).
 */
export function salariosDaFolha(registros: readonly RegistroValores[]): SalarioDaFolha[] {
  return agruparPorPessoa(registros).flatMap((g) =>
    g.funcionarioId && g.registros.every((r) => r.status === "confirmado")
      ? [
          {
            funcionarioId: g.funcionarioId,
            valor: somaReais(g.registros.map((r) => r.proventos)),
            valorLiquido: somaReais(g.registros.map(valorPago)),
          },
        ]
      : [],
  );
}

export type LinhaRestituicaoPessoa = {
  chave: string;
  funcionarioId: string | null;
  nome: string;
  contratos: number;
  inss: number;
  restituicao: number;
};

/** Aba Restituição por pessoa: INSS 998 e restituição somados de todos os registros dela. */
export function restituicoesPorPessoa(
  registros: readonly { id: string; funcionarioId: string | null; nome: string }[],
  linhas: readonly LinhaRestituicao[],
): LinhaRestituicaoPessoa[] {
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return agruparPorPessoa(registros).map((g) => {
    const ls = g.registros.map((r) => porId.get(r.id));
    return {
      chave: g.chave,
      funcionarioId: g.funcionarioId,
      nome: g.registros[0].nome,
      contratos: g.registros.length,
      inss: somaReais(ls.map((l) => l?.inss ?? 0)),
      restituicao: somaReais(ls.map((l) => l?.restituicao ?? 0)),
    };
  });
}

// ---------- Resumo e lote de pagamento ----------

export type LinhaResumo = {
  chave: string;
  funcionarioId: string | null;
  nome: string;
  status: StatusResumo;
  bruto: number;
  /** Valor pago (líquido manual, quando houver, senão o líquido da folha). */
  liquido: number;
  /** Algum registro da pessoa tem líquido manual. */
  liquidoManual?: boolean;
  restituicao: number;
  /** Registros da pessoa na folha (mais de 1 = mais de um contrato). */
  contratos?: number;
};

/**
 * Aba Resumo: uma linha por pessoa vinculada ao RH (Bruto, Líquido e Restituição
 * somados; Confirmado só com todos os registros confirmados). Sem vínculo: linha própria.
 */
export function resumoDaFolha(
  registros: readonly (RegistroValores & { nome: string })[],
  restituicaoPorId: ReadonlyMap<string, number>,
): LinhaResumo[] {
  return agruparPorPessoa(registros).map((g) => ({
    chave: g.chave,
    funcionarioId: g.funcionarioId,
    nome: g.registros[0].nome,
    status: g.registros.every((r) => r.status === "confirmado") ? "confirmado" : "em_conferencia",
    bruto: somaReais(g.registros.map((r) => r.proventos)),
    liquido: somaReais(g.registros.map(valorPago)),
    liquidoManual: g.registros.some((r) => r.liquidoManual != null),
    restituicao: somaReais(g.registros.map((r) => restituicaoPorId.get(r.id) ?? 0)),
    contratos: g.registros.length,
  }));
}

/**
 * Resumo e Restituição: uma única lista em ordem alfabética pelo nome padronizado
 * (toTitleCase), misturando linhas da folha e de salário manual. Só apresentação.
 */
export function emOrdemAlfabetica<T extends { nome: string }>(
  linhas: readonly T[],
  comparar: (a: string, b: string) => number,
): T[] {
  return linhas
    .map((l) => ({ ...l, nome: toTitleCase(l.nome) }))
    .sort((a, b) => comparar(a.nome, b.nome));
}

export function totaisResumo(linhas: readonly LinhaResumo[]) {
  return {
    bruto: somaReais(linhas.map((l) => l.bruto)),
    liquido: somaReais(linhas.map((l) => l.liquido)),
    restituicao: somaReais(linhas.map((l) => l.restituicao)),
  };
}

/** Terceirizados e Extras no Resumo: Bruto = Líquido = valor; sem restituição. */
export function linhasDeValoresMensais(itens: readonly ItemValorMensal[]): LinhaResumo[] {
  return itens.map((i) => ({
    chave: `${i.tipo}:${i.pessoaId}`,
    funcionarioId: null,
    nome: i.nome,
    status: "manual" as const,
    bruto: i.valor,
    liquido: i.valor,
    restituicao: 0,
  }));
}

export type BlocoResumo = {
  tipo: TipoPessoaLote;
  linhas: LinhaResumo[];
  subtotal: ReturnType<typeof totaisResumo>;
};

/**
 * Aba Resumo em blocos (Efetivos, Terceirizados, Extras), cada um em ordem
 * alfabética e com subtotal; bloco vazio não aparece. Total geral = soma dos subtotais.
 */
export function blocosResumo(
  porTipo: Record<TipoPessoaLote, readonly LinhaResumo[]>,
  comparar: (a: string, b: string) => number,
): { blocos: BlocoResumo[]; total: ReturnType<typeof totaisResumo> } {
  const blocos = (["efetivo", "terceirizado", "extra"] as const)
    .map((tipo) => {
      const linhas = emOrdemAlfabetica(porTipo[tipo], comparar);
      return { tipo, linhas, subtotal: totaisResumo(linhas) };
    })
    .filter((b) => b.linhas.length > 0);
  const soma = (k: "bruto" | "liquido" | "restituicao") =>
    somaReais(blocos.map((b) => b.subtotal[k]));
  return {
    blocos,
    total: { bruto: soma("bruto"), liquido: soma("liquido"), restituicao: soma("restituicao") },
  };
}

export type ItemLote = { employee_id: string; employee_name: string; total_amount: number };

/**
 * Lote de Folhas Salvas: só Confirmados e Manuais, pelo líquido; restituição
 * não entra. Fica de fora quem está Em conferência, quem não tem cadastro no
 * RH (o lote é por funcionário) e quem tem líquido zero.
 */
export function montarLoteFolha(linhas: readonly LinhaResumo[]): {
  itens: ItemLote[];
  total: number;
  emConferencia: string[];
  semCadastro: string[];
} {
  const itens: ItemLote[] = [];
  const emConferencia: string[] = [];
  const semCadastro: string[] = [];
  for (const l of linhas) {
    if (l.status === "em_conferencia") {
      emConferencia.push(l.nome);
      continue;
    }
    if (!l.funcionarioId) {
      semCadastro.push(l.nome);
      continue;
    }
    if (paraCentavos(l.liquido) <= 0) continue;
    itens.push({
      employee_id: l.funcionarioId,
      employee_name: toTitleCase(l.nome),
      total_amount: l.liquido,
    });
  }
  return { itens, total: somaReais(itens.map((i) => i.total_amount)), emConferencia, semCadastro };
}

/** Funcionário do RH correspondente pelo CPF (só dígitos), incluindo desligados. */
export function casarPorCpf<F extends { id: string; cpf?: string | null }>(
  funcionarios: readonly F[],
  cpf: string,
): F | null {
  const alvo = somenteDigitos(cpf);
  if (!alvo) return null;
  return funcionarios.find((f) => somenteDigitos(f.cpf) === alvo) ?? null;
}

// ---------- Competência aberta/fechada ----------

export type StatusCompetencia = "aberta" | "fechada";

/** Competência fechada é somente leitura: nada grava, nada reimporta. */
export function exigirCompetenciaAberta(status: StatusCompetencia): void {
  if (status === "fechada") throw new Error("Competência fechada: somente leitura.");
}

/** Só fecha quando ninguém está Em conferência; devolve os nomes que impedem. */
export function pendentesParaFechar(
  colaboradores: readonly { nome: string; status: StatusColaboradorFolha }[],
): string[] {
  return colaboradores.filter((c) => c.status === "em_conferencia").map((c) => c.nome);
}

// ---------- Várias empresas (CNPJ) no mesmo colégio ----------
// Cada PDF é a folha de UMA empresa: a importação é única por colégio +
// competência + CNPJ (comparado só pelos dígitos, porque é gravado como vem no PDF).

/** CNPJ com 14 dígitos e dígitos verificadores corretos. */
export function cnpjValido(cnpj: string): boolean {
  const d = somenteDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(d[i]) * (((ate - 1 - i) % 8) + 2);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

/** 00.000.000/0000-00 quando tem 14 dígitos; senão, como veio. */
export function formatarCnpj(cnpj: string): string {
  const d = somenteDigitos(cnpj);
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : cnpj;
}

/** Mesmo CNPJ (só dígitos); vazio nunca é igual a nada. */
export function mesmoCnpj(a: string, b: string): boolean {
  const d = somenteDigitos(a);
  return d !== "" && d === somenteDigitos(b);
}

/** O CNPJ do PDF está entre os aceitos do colégio (o do cadastro do colégio + os adicionais). */
export function cnpjAceito(cnpj: string, aceitos: readonly string[]): boolean {
  return aceitos.some((a) => mesmoCnpj(cnpj, a));
}

export function mensagemCnpjNaoCadastrado(cnpj: string, empresa: string, colegio: string): string {
  return `O CNPJ ${cnpj || "vazio"} (${empresa || "empresa sem nome"}) não está cadastrado para ${colegio}. Cadastre em Configurações > Cadastros Gerais > CNPJs Folha de Pagamento.`;
}

type ImportacaoEmpresa = { cnpj: string; empresa: string; competencia: string };

/** Importação da competência que é DESTA empresa (reimportação), ou null (importação nova). */
export function importacaoDoCnpj<T extends { cnpj: string }>(
  importacoes: readonly T[],
  cnpj: string,
): T | null {
  return importacoes.find((i) => mesmoCnpj(i.cnpj, cnpj)) ?? null;
}

/** Importação anterior mais recente do MESMO CNPJ (null = primeira importação desta empresa). */
export function importacaoAnteriorDoCnpj<T extends ImportacaoEmpresa>(
  importacoes: readonly T[],
  competencia: string,
  cnpj: string,
): T | null {
  let melhor: T | null = null;
  for (const i of importacoes) {
    if (i.competencia >= competencia || !mesmoCnpj(i.cnpj, cnpj)) continue;
    if (!melhor || i.competencia > melhor.competencia) melhor = i;
  }
  return melhor;
}

/**
 * Empresas importadas na competência anterior (a mais recente com folha, antes
 * desta) que ainda não foram importadas nesta. Usado no aviso antes de fechar.
 */
export function empresasNaoImportadas<T extends ImportacaoEmpresa>(
  todas: readonly T[],
  competencia: string,
): T[] {
  const anteriores = todas.filter((i) => i.competencia < competencia);
  if (!anteriores.length) return [];
  const ultima = anteriores.reduce((m, i) => (i.competencia > m ? i.competencia : m), "");
  const atuais = todas.filter((i) => i.competencia === competencia);
  return anteriores.filter(
    (i) => i.competencia === ultima && !atuais.some((a) => mesmoCnpj(a.cnpj, i.cnpj)),
  );
}

/** Competência fechada quando qualquer empresa dela está fechada (fecham e reabrem juntas). */
export function competenciaFechada(importacoes: readonly { status: StatusCompetencia }[]): boolean {
  return importacoes.some((i) => i.status === "fechada");
}

/**
 * Totais exibidos (de uma empresa ou do colégio) = soma dos registros gravados.
 * Os totais do PDF guardados na importação servem só à conferência de integridade.
 */
export function totaisDasEmpresas(
  registros: readonly { proventos: number; descontos: number; liquido: number }[],
) {
  return {
    proventos: somaReais(registros.map((r) => r.proventos)),
    descontos: somaReais(registros.map((r) => r.descontos)),
    liquido: somaReais(registros.map((r) => r.liquido)),
    colaboradores: registros.length,
  };
}

/**
 * Vínculo com o RH: o funcionário só pode receber registros da folha (de
 * qualquer empresa da competência) com o MESMO CPF. Compara com os CPFs dos
 * registros já ligados a ele, não com o CPF do cadastro do RH (que pode estar vazio).
 * Devolve a mensagem de recusa, ou null quando pode vincular.
 */
export function conflitoVinculoCpf(
  registros: readonly { id: string; nome: string; cpf: string; funcionarioId: string | null }[],
  registroId: string,
  funcionarioId: string,
): string | null {
  const alvo = registros.find((r) => r.id === registroId);
  if (!alvo) return null;
  const cpf = somenteDigitos(alvo.cpf);
  const outro = registros.find(
    (r) =>
      r.id !== registroId && r.funcionarioId === funcionarioId && somenteDigitos(r.cpf) !== cpf,
  );
  return outro
    ? `Este funcionário já está ligado a ${outro.nome}, com outro CPF, nesta folha. Só registros com o mesmo CPF podem ir para o mesmo cadastro do RH.`
    : null;
}

// ---------- Exclusão de colaborador da folha (só admin) ----------
// O registro excluído é apagado da folha gravada. A exclusão guarda a
// identidade (empresa, tipo, código, CPF e nome), o motivo, quem e quando e,
// só no servidor, o retrato do registro, que o "Desfazer" devolve à folha.

/**
 * Exclusão de uma competência (empresa + tipo + código) ou fixa do colégio:
 * por CPF; sem CPF, por empresa + tipo + código.
 */
export type ExclusaoFolha = {
  fixa: boolean;
  competencia: string | null;
  cnpj: string;
  tipo: TipoColaborador;
  codigo: string;
  cpf: string;
};

type IdentidadeRegistro = { tipo: TipoColaborador; codigo: string; cpf: string };

/**
 * O registro do PDF desta empresa/competência está excluído da folha?
 * A exclusão da competência vale sempre. A fixa só descarta o que NÃO está
 * gravado na importação atual da empresa (`gravados`, chaves tipo:código):
 * registro já gravado só sai por exclusão explícita.
 */
export function registroExcluido(
  r: IdentidadeRegistro,
  exclusoes: readonly ExclusaoFolha[],
  folha: { competencia: string; cnpj: string },
  gravados: ReadonlySet<string> = new Set(),
): boolean {
  const cpf = somenteDigitos(r.cpf);
  const jaGravado = gravados.has(chaveColaborador(r));
  return exclusoes.some((e) => {
    const mesmoRegistro =
      mesmoCnpj(e.cnpj, folha.cnpj) && e.tipo === r.tipo && e.codigo === r.codigo;
    if (!e.fixa) return e.competencia === folha.competencia && mesmoRegistro;
    if (jaGravado) return false;
    const cpfFixo = somenteDigitos(e.cpf);
    return cpfFixo ? cpfFixo === cpf : mesmoRegistro;
  });
}

/** Chaves tipo:código dos registros do PDF a descartar antes de gravar. */
export function chavesExcluidas(
  registros: readonly IdentidadeRegistro[],
  exclusoes: readonly ExclusaoFolha[],
  folha: { competencia: string; cnpj: string },
  gravados: Iterable<string> = [],
): string[] {
  const jaGravados = new Set(gravados);
  return registros
    .filter((r) => registroExcluido(r, exclusoes, folha, jaGravados))
    .map((r) => chaveColaborador(r));
}

/** Registros sem os descartados (pelas chaves tipo:código). */
export function semDescartados<T extends { tipo: TipoColaborador; codigo: string }>(
  registros: readonly T[],
  descartar: Iterable<string>,
): T[] {
  const fora = new Set(descartar);
  return registros.filter((r) => !fora.has(chaveColaborador(r)));
}

/**
 * funcionarios_salarios do funcionário depois de excluir um registro dele:
 * recalculada com os que ficaram quando todos estão Confirmados; removida
 * quando não sobra registro ou algum dos que ficaram está Em conferência
 * (volta a ser gravada ao confirmar).
 */
export function salarioAposExclusao(
  restantes: readonly RegistroValores[],
  funcionarioId: string,
): { acao: "gravar"; valor: number; valorLiquido: number } | { acao: "remover" } {
  const s = salariosDaFolha(restantes.filter((r) => r.funcionarioId === funcionarioId))[0];
  return s ? { acao: "gravar", valor: s.valor, valorLiquido: s.valorLiquido } : { acao: "remover" };
}

type RegistroDaImportacao = Parameters<typeof salariosDaFolha>[0][number] & {
  importacaoId: string;
  proventos: number;
  descontos: number;
  liquido: number;
};

/**
 * Excluir a importação inteira de uma empresa: totais do que sai (registro da
 * exclusão) e, para cada funcionário que tinha registro nela, a decisão de
 * salarioAposExclusao com o que restou nas outras empresas da competência.
 * Funcionário com salário manual na competência fica de fora: a linha manual
 * nunca é tocada.
 */
export function planoExclusaoImportacao<T extends RegistroDaImportacao>(
  registros: readonly T[],
  importacaoId: string,
  comSalarioManual: ReadonlySet<string> = new Set(),
) {
  const apagados = registros.filter((r) => r.importacaoId === importacaoId);
  const restantes = registros.filter((r) => r.importacaoId !== importacaoId);
  const funcionarios = [
    ...new Set(apagados.flatMap((r) => (r.funcionarioId ? [r.funcionarioId] : []))),
  ];
  return {
    totais: totaisDasEmpresas(apagados),
    salarios: funcionarios
      .filter((f) => !comSalarioManual.has(f))
      .map((funcionarioId) => ({
        funcionarioId,
        ...salarioAposExclusao(restantes, funcionarioId),
      })),
  };
}

/** Aviso da tela depois de "Desfazer" uma exclusão da folha. */
export function avisoDesfazerExclusao(r: { restaurado: boolean; semCopia: boolean }): string {
  if (r.restaurado) return "Exclusão desfeita: o registro voltou para a folha.";
  if (r.semCopia) {
    return "Exclusão desfeita. Este registro não tinha cópia guardada: importe de novo o PDF deste mês para ele voltar à folha.";
  }
  return "Exclusão desfeita.";
}
