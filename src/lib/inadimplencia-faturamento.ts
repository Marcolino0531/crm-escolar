// Faturamento usado como denominador dos índices de Inadimplência (mensal e
// anual). Regras puras, compartilhadas com o Fechamento do Mês do Dashboard
// para que o critério de "o que é faturamento" nunca divirja entre as telas.

import { ehReceitaOperacional, type IdsFinanceiros } from "./dashboard-financeiro";

export interface ReceitaExtrato {
  amount: number | string | null;
  description: string | null;
  revenue_category_id: string | null;
}

/**
 * Soma as entradas do extrato que contam como faturamento: ignora marcadores
 * "SALDO DIA", placeholders de importação (valor 1) e, pelo mesmo critério do
 * Dashboard, resgates de fundo de investimento e aportes recebidos de outra
 * unidade. As linhas já devem vir sem transação-pai desmembrada.
 */
export function faturamentoRecebido(rows: readonly ReceitaExtrato[], ids: IdsFinanceiros): number {
  return rows.reduce((sum, t) => {
    const desc = String(t.description ?? "")
      .trim()
      .toUpperCase();
    const amt = Number(t.amount ?? 0);
    if (desc.includes("SALDO DIA")) return sum;
    if (amt === 1) return sum;
    const operacional = ehReceitaOperacional(
      {
        id: "",
        school_id: "",
        date: "",
        type: "entrada",
        amount: amt,
        cost_center_id: null,
        revenue_category_id: t.revenue_category_id,
        parent_transaction_id: null,
      },
      ids,
    );
    if (!operacional) return sum;
    return sum + amt;
  }, 0);
}

/** Primeiro ano com Extrato Bancário; nele o extrato só começa em junho. */
export const ANO_INICIO_EXTRATO = 2026;
export const MES_INICIO_EXTRATO_YMD = `${ANO_INICIO_EXTRATO}-06-01`;

export interface JanelaAnual {
  /** 1º de janeiro do ano selecionado (numerador do Sponte). */
  inicioYMD: string;
  /** Hoje no ano corrente; 31/12 em ano já encerrado. */
  fimYMD: string;
  /** Início da busca de receitas no extrato (01/06 em 2026; 01/01 depois). */
  receitasDesdeYMD: string;
  /** Só 2026 soma faturamento_retroativo_jan_mai ao extrato. */
  usaRetroativo: boolean;
  /** Antes de 2026 não há extrato nem retroativo: card mostra "sem dados". */
  semDados: boolean;
}

export function janelaAnual(ano: number, hojeYMD: string): JanelaAnual {
  const anoHoje = Number(hojeYMD.slice(0, 4));
  const inicioYMD = `${ano}-01-01`;
  const fimYMD = ano >= anoHoje ? hojeYMD : `${ano}-12-31`;
  return {
    inicioYMD,
    fimYMD,
    receitasDesdeYMD: ano === ANO_INICIO_EXTRATO ? MES_INICIO_EXTRATO_YMD : inicioYMD,
    usaRetroativo: ano === ANO_INICIO_EXTRATO,
    semDados: ano < ANO_INICIO_EXTRATO,
  };
}

/** Anos oferecidos no seletor: do primeiro ano com extrato até o corrente. */
export function anosDisponiveis(anoAtual: number): number[] {
  const anos: number[] = [];
  for (let a = anoAtual; a >= ANO_INICIO_EXTRATO; a--) anos.push(a);
  return anos;
}

export function indiceInadimplencia(inadimplente: number, faturamento: number): number {
  return faturamento > 0 ? (inadimplente / faturamento) * 100 : 0;
}
