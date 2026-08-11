// Agregação das pendências financeiras exibidas no sininho de notificações.
// Um aviso por colégio + mês (nunca por transação), derivado ao vivo dos dados:
// resolver a pendência remove o aviso na próxima leitura, sem marcar como lido.

export interface TransacaoPendencia {
  id: string;
  school_id: string;
  date: string; // YYYY-MM-DD
  type: string; // "entrada" | "saida"
  cost_center_id: string | null;
  revenue_category_id: string | null;
  parent_transaction_id: string | null;
  description: string | null;
  amount: number;
}

export interface PendenciaMensal {
  schoolId: string;
  monthKey: string; // YYYY-MM
}

const MESES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function monthKeyOf(date: string): string {
  return String(date ?? "").slice(0, 7);
}

/** "2026-08" → "agosto/2026". */
export function formatarCompetencia(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(monthKey);
  if (!m) return monthKey;
  const mes = MESES_PT[Number(m[2]) - 1] ?? m[2];
  return `${mes}/${m[1]}`;
}

/** Transação desmembrada em filhas não é cobrada: quem categoriza são as filhas. */
function idsDePaisDesmembrados(txs: TransacaoPendencia[]): Set<string> {
  const set = new Set<string>();
  for (const t of txs) {
    if (t.parent_transaction_id) set.add(t.parent_transaction_id);
  }
  return set;
}

/** Mesma regra do Extrato Bancário: entrada precisa de categoria de receita; saída, de centro de custo. */
export function semCategoria(t: TransacaoPendencia): boolean {
  return t.type === "entrada" ? !t.revenue_category_id : !t.cost_center_id;
}

function ordenar(pendencias: PendenciaMensal[]): PendenciaMensal[] {
  return pendencias.sort(
    (a, b) => b.monthKey.localeCompare(a.monthKey) || a.schoolId.localeCompare(b.schoolId),
  );
}

function agrupar(txs: TransacaoPendencia[]): PendenciaMensal[] {
  const chaves = new Map<string, PendenciaMensal>();
  for (const t of txs) {
    const monthKey = monthKeyOf(t.date);
    if (!monthKey) continue;
    const chave = `${t.school_id}|${monthKey}`;
    if (chaves.has(chave)) continue;
    chaves.set(chave, { schoolId: t.school_id, monthKey });
  }
  return ordenar([...chaves.values()]);
}

/** Um aviso por colégio/mês com pelo menos uma transação sem categoria. */
export function pendenciasCategorizacao(txs: TransacaoPendencia[]): PendenciaMensal[] {
  const pais = idsDePaisDesmembrados(txs);
  return agrupar(txs.filter((t) => !pais.has(t.id) && semCategoria(t)));
}

/**
 * Linhas que aparecem em "Receitas do Período" na tela de Faturamento: entradas
 * originais, fora as marcações de saldo e os centavos de controle.
 */
export function ehLinhaDeFaturamento(t: TransacaoPendencia): boolean {
  if (t.type !== "entrada") return false;
  if (t.parent_transaction_id) return false;
  const desc = String(t.description ?? "")
    .trim()
    .toUpperCase();
  if (desc.includes("SALDO DIA")) return false;
  return Number(t.amount ?? 1) !== 1;
}

/** Um aviso por colégio/mês com pelo menos uma receita ainda não conciliada. */
export function pendenciasConciliacao(
  txs: TransacaoPendencia[],
  conciliadas: Iterable<string>,
): PendenciaMensal[] {
  const feitas = new Set(conciliadas);
  return agrupar(txs.filter((t) => ehLinhaDeFaturamento(t) && !feitas.has(t.id)));
}

export function mensagemCategorizacao(colegio: string, monthKey: string): string {
  return `Colégio ${colegio} possui transação no extrato bancário do mês ${formatarCompetencia(monthKey)} sem categorização.`;
}

export function mensagemConciliacao(colegio: string, monthKey: string): string {
  return `Colégio ${colegio} possui faturamento do mês ${formatarCompetencia(monthKey)} sem conciliação.`;
}
