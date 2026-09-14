// Fechamento mensal financeiro do Dashboard: Receita/Despesa/Resultado do mês,
// investimentos, transferências entre unidades e o comparativo por unidade.
// Regras puras (sem Supabase) para serem testáveis; a tela só busca e exibe.
//
// Aportes/resgates do fundo e transferências entre unidades passam pela conta
// corrente como entrada/saída normais, mas não são faturamento nem custo
// operacional: ficam fora de Receita e Despesa e ganham cards próprios.

import { idsDePaisDesmembrados } from "./extrato-lista";

export interface TransacaoFinanceira {
  id: string;
  school_id: string;
  date: string; // YYYY-MM-DD
  type: string; // "entrada" | "saida"
  amount: number;
  cost_center_id: string | null;
  revenue_category_id: string | null;
  parent_transaction_id: string | null;
}

/** Nomes exatos em produção (revenue_categories / cost_centers). */
export const NOMES_FINANCEIROS = {
  resgateInvestimento: "Resgate Fundo de Investimento", // receita
  aporteInvestimento: "Aporte em Investimento", // centro de custo
  transferenciaRecebida: "Aporte Financeiro", // receita
  transferenciaEnviada: "Aporte Financeiro", // centro de custo
} as const;

export interface IdsFinanceiros {
  resgateInvestimento: string | null;
  aporteInvestimento: string | null;
  transferenciaRecebida: string | null;
  transferenciaEnviada: string | null;
}

export const IDS_VAZIOS: IdsFinanceiros = {
  resgateInvestimento: null,
  aporteInvestimento: null,
  transferenciaRecebida: null,
  transferenciaEnviada: null,
};

type Nomeado = { id: string; name: string };

function idPorNome(lista: readonly Nomeado[], nome: string): string | null {
  const alvo = nome.trim().toLowerCase();
  return (
    lista.find(
      (x) =>
        String(x.name ?? "")
          .trim()
          .toLowerCase() === alvo,
    )?.id ?? null
  );
}

export function resolverIdsFinanceiros(
  categorias: readonly Nomeado[],
  centros: readonly Nomeado[],
): IdsFinanceiros {
  return {
    resgateInvestimento: idPorNome(categorias, NOMES_FINANCEIROS.resgateInvestimento),
    aporteInvestimento: idPorNome(centros, NOMES_FINANCEIROS.aporteInvestimento),
    transferenciaRecebida: idPorNome(categorias, NOMES_FINANCEIROS.transferenciaRecebida),
    transferenciaEnviada: idPorNome(centros, NOMES_FINANCEIROS.transferenciaEnviada),
  };
}

export interface FechamentoMensal {
  receita: number;
  despesa: number;
  resultado: number;
  aportadoFundo: number;
  resgatadoFundo: number;
  enviadoOutras: number;
  recebidoOutras: number;
  saldoTransferencias: number;
}

export const FECHAMENTO_ZERADO: FechamentoMensal = {
  receita: 0,
  despesa: 0,
  resultado: 0,
  aportadoFundo: 0,
  resgatadoFundo: 0,
  enviadoOutras: 0,
  recebidoOutras: 0,
  saldoTransferencias: 0,
};

function valor(t: TransacaoFinanceira): number {
  return Number(t.amount ?? 0) || 0;
}

function ehResgateFundo(t: TransacaoFinanceira, ids: IdsFinanceiros): boolean {
  return (
    t.type === "entrada" &&
    ids.resgateInvestimento !== null &&
    t.revenue_category_id === ids.resgateInvestimento
  );
}
function ehTransferenciaRecebida(t: TransacaoFinanceira, ids: IdsFinanceiros): boolean {
  return (
    t.type === "entrada" &&
    ids.transferenciaRecebida !== null &&
    t.revenue_category_id === ids.transferenciaRecebida
  );
}
function ehAporteFundo(t: TransacaoFinanceira, ids: IdsFinanceiros): boolean {
  return (
    t.type === "saida" &&
    ids.aporteInvestimento !== null &&
    t.cost_center_id === ids.aporteInvestimento
  );
}
function ehTransferenciaEnviada(t: TransacaoFinanceira, ids: IdsFinanceiros): boolean {
  return (
    t.type === "saida" &&
    ids.transferenciaEnviada !== null &&
    t.cost_center_id === ids.transferenciaEnviada
  );
}

/** Receita operacional: entrada que não é resgate de fundo nem transferência recebida. */
export function ehReceitaOperacional(t: TransacaoFinanceira, ids: IdsFinanceiros): boolean {
  return t.type === "entrada" && !ehResgateFundo(t, ids) && !ehTransferenciaRecebida(t, ids);
}

/** Despesa operacional: saída que não é aporte no fundo nem transferência enviada. */
export function ehDespesaOperacional(t: TransacaoFinanceira, ids: IdsFinanceiros): boolean {
  return t.type === "saida" && !ehAporteFundo(t, ids) && !ehTransferenciaEnviada(t, ids);
}

/** Linhas efetivamente contadas: sem as transações-pai desmembradas. */
export function linhasContaveis(txs: readonly TransacaoFinanceira[]): TransacaoFinanceira[] {
  const pais = idsDePaisDesmembrados(txs);
  return txs.filter((t) => !pais.has(t.id));
}

export function fechamentoMensal(
  txs: readonly TransacaoFinanceira[],
  ids: IdsFinanceiros,
): FechamentoMensal {
  const r = { ...FECHAMENTO_ZERADO };
  for (const t of linhasContaveis(txs)) {
    const v = valor(t);
    if (ehReceitaOperacional(t, ids)) r.receita += v;
    if (ehDespesaOperacional(t, ids)) r.despesa += v;
    if (ehResgateFundo(t, ids)) r.resgatadoFundo += v;
    if (ehAporteFundo(t, ids)) r.aportadoFundo += v;
    if (ehTransferenciaRecebida(t, ids)) r.recebidoOutras += v;
    if (ehTransferenciaEnviada(t, ids)) r.enviadoOutras += v;
  }
  r.resultado = r.receita - r.despesa;
  r.saldoTransferencias = r.recebidoOutras - r.enviadoOutras;
  return r;
}

export interface FatiaCentroCusto {
  id: string | null;
  name: string;
  value: number;
}

export const SEM_CENTRO_CUSTO = "Sem centro de custo";

/** Despesa operacional do período agrupada por centro de custo, maior primeiro. */
export function despesaPorCentroCusto(
  txs: readonly TransacaoFinanceira[],
  ids: IdsFinanceiros,
  nomes: ReadonlyMap<string, string>,
): FatiaCentroCusto[] {
  const soma = new Map<string | null, number>();
  for (const t of linhasContaveis(txs)) {
    if (!ehDespesaOperacional(t, ids)) continue;
    const k = t.cost_center_id;
    soma.set(k, (soma.get(k) ?? 0) + valor(t));
  }
  return [...soma.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, value]) => ({
      id,
      name: id === null ? SEM_CENTRO_CUSTO : (nomes.get(id) ?? SEM_CENTRO_CUSTO),
      value,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR"));
}

export interface LinhaComparativa extends FechamentoMensal {
  schoolId: string;
  schoolName: string;
}

/** Uma linha por unidade (na ordem recebida); unidade sem transações sai zerada. */
export function fechamentoPorUnidade(
  txs: readonly TransacaoFinanceira[],
  ids: IdsFinanceiros,
  unidades: readonly { id: string; name: string }[],
): LinhaComparativa[] {
  return unidades.map((u) => ({
    schoolId: u.id,
    schoolName: u.name,
    ...fechamentoMensal(
      txs.filter((t) => t.school_id === u.id),
      ids,
    ),
  }));
}
