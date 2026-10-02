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
  type TipoRubrica,
} from "@/lib/extrato-mensal";

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

/** Mesma pessoa em duas folhas: CPF (só dígitos) ou, sem CPF, o código na folha. */
export function chaveColaborador(c: { cpf: string; codigo: string }): string {
  const cpf = somenteDigitos(c.cpf);
  return cpf ? `cpf:${cpf}` : `cod:${c.codigo}`;
}

type SomaRubrica = { rotulo: string; centavos: number };

function rubricasPorCodigo(rubricas: readonly RubricaComparavel[]): Map<string, SomaRubrica> {
  const m = new Map<string, SomaRubrica>();
  for (const r of rubricas) {
    const k = `${r.tipo}:${r.codigo}`;
    const atual = m.get(k);
    if (atual) atual.centavos += paraCentavos(r.valor);
    else m.set(k, { rotulo: `${r.tipo} ${r.codigo} ${r.descricao}`.trim(), centavos: paraCentavos(r.valor) });
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
    out.push({ tipo: "situacao", antes: anterior.situacao, depois: atual.situacao, diferenca: null });
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
    out.push({ tipo: "rubrica_removida", rubrica: a.rotulo, antes: v, depois: null, diferenca: -v });
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

/** Pré-seleção: sem divergência vem marcado; com divergência vem desmarcado. */
export function preSelecao<T extends ColaboradorComparavel>(cmp: ComparacaoFolhas<T>): Set<string> {
  if (cmp.primeiraImportacao) return new Set();
  return new Set(
    cmp.porColaborador.filter((p) => p.divergencias.length === 0).map((p) => p.colaborador.codigo),
  );
}

// ---------- Reimportação da mesma competência ----------

export type PlanoReimportacao<T extends ColaboradorComparavel> = {
  /** Iguais ao gravado (dados do PDF): nada muda. */
  iguais: T[];
  /** Diferentes do gravado: serão substituídos (e voltam para Em conferência). */
  substituidos: { colaborador: T; divergencias: Divergencia[]; perdeAjusteManual: boolean }[];
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
    else plano.substituidos.push({ colaborador: c, divergencias: div, perdeAjusteManual: g.ajustadoManualmente });
  }
  plano.retirados = gravados.filter((g) => !vistos.has(chaveColaborador(g)));
  return plano;
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

export function aplicarAjuste(rubricas: readonly RubricaFolha[], ajuste: AjusteRubrica): RubricaFolha[] {
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

// ---------- Restituição do INSS ----------

/** INSS do mês = rubricas de DESCONTO de código 998 vigentes (não entram 826, 989, 843…). */
export function inssDoMes(rubricas: readonly (Pick<RubricaComparavel, "tipo" | "codigo" | "valor"> & { removida?: boolean })[]): number {
  return somaReais(
    rubricas.filter((r) => !r.removida && r.tipo === "D" && r.codigo === CODIGO_INSS).map((r) => r.valor),
  );
}

export type ColaboradorRestituicao = {
  id: string;
  funcionarioId: string | null;
  rubricas: readonly (Pick<RubricaComparavel, "tipo" | "codigo" | "valor"> & { removida?: boolean })[];
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

// ---------- Resumo e lote de pagamento ----------

export type LinhaResumo = {
  chave: string;
  funcionarioId: string | null;
  nome: string;
  status: StatusResumo;
  bruto: number;
  liquido: number;
  restituicao: number;
};

export function totaisResumo(linhas: readonly LinhaResumo[]) {
  return {
    bruto: somaReais(linhas.map((l) => l.bruto)),
    liquido: somaReais(linhas.map((l) => l.liquido)),
    restituicao: somaReais(linhas.map((l) => l.restituicao)),
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
    itens.push({ employee_id: l.funcionarioId, employee_name: l.nome, total_amount: l.liquido });
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
