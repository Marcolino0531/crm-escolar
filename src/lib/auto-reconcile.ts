import { supabase } from "@/integrations/supabase/client";

// Transações candidatas à conciliação automática por subcategoria única.
export interface AutoReconcileTx {
  id: string;
  amount: number;
  revenue_category_id: string | null;
  revenue_subcategory_id: string | null;
}

export interface SubcategoryRef {
  id: string;
  name: string;
  revenue_category_id: string | null;
}

/**
 * Concilia automaticamente transações de receita que já possuem uma
 * subcategoria única definida (ex.: "Little Kickers", "Cantina") no momento da
 * importação do extrato. Como o valor total já pertence a essa subcategoria, a
 * transação não precisa de desmembramento manual: gravamos uma conciliação com
 * um único item (valor integral → subcategoria), o que faz a linha aparecer
 * como "Conciliada" na tela de Conciliação de Faturamento, em vez de "Pendente".
 *
 * Idempotente do ponto de vista do chamador: só processa as transações
 * informadas que ainda não possuem conciliação. Retorna quantas foram criadas.
 */
export async function autoReconcileSubcategorized(
  txs: AutoReconcileTx[],
  subs: SubcategoryRef[],
  schoolId: string,
  sourceFilename = "Subcategoria automática (importação)",
): Promise<number> {
  const elegiveis = txs.filter((t) => !!t.revenue_subcategory_id);
  if (elegiveis.length === 0) return 0;

  const headerRows = elegiveis.map((t) => ({
    transaction_id: t.id,
    school_id: schoolId,
    source_filename: sourceFilename,
    total_amount: Math.round(Number(t.amount) * 100) / 100,
  }));

  const { data: recs, error: recErr } = await supabase
    .from("boleto_reconciliations")
    .insert(headerRows)
    .select("id, transaction_id");
  if (recErr || !recs) {
    throw new Error(recErr?.message ?? "Falha ao criar conciliações automáticas.");
  }

  const recIdByTx = new Map(recs.map((r) => [r.transaction_id, r.id]));
  const itemRows = elegiveis.map((t) => {
    const sub = subs.find((s) => s.id === t.revenue_subcategory_id);
    return {
      reconciliation_id: recIdByTx.get(t.id)!,
      subcategory_label: sub?.name ?? "Subcategoria",
      amount: Math.round(Number(t.amount) * 100) / 100,
      revenue_category_id: t.revenue_category_id ?? sub?.revenue_category_id ?? null,
      revenue_subcategory_id: t.revenue_subcategory_id,
      transaction_id: null,
    };
  });

  const { error: itErr } = await supabase.from("boleto_reconciliation_items").insert(itemRows);
  if (itErr) throw new Error(itErr.message);

  return elegiveis.length;
}

// Despesa (saída) do extrato usada para dar baixa em uma previsão do Fluxo Futuro.
export interface ExpenseTx {
  date: string; // vencimento/lançamento no formato YYYY-MM-DD
  amount: number; // magnitude positiva (sem sinal)
}

const centavos = (n: number): number => Math.round(Number(n) * 100);

/**
 * Conciliação bancária automática (Fluxo Futuro × Extrato).
 *
 * Para cada SAÍDA importada, procura no Fluxo Futuro (`recurring_forecasts`) uma
 * previsão AINDA NÃO paga da mesma escola com a MESMA data de vencimento
 * (`due_date`) e o MESMO valor (`projected_amount`). Havendo correspondência
 * exata, marca a previsão como "Pago" e registra uma nota de auditoria
 * ("Baixado automaticamente via importação de extrato em DD/MM/AAAA").
 *
 * Cada previsão é baixada no máximo uma vez por chamada (uma saída → uma
 * previsão), evitando quitar duas previsões idênticas com uma única transação.
 * Retorna a quantidade de previsões baixadas.
 */
export async function autoBaixaForecastsPorExtrato(
  expenses: ExpenseTx[],
  schoolId: string,
): Promise<number> {
  const datas = [...new Set(expenses.map((e) => e.date).filter(Boolean))];
  if (datas.length === 0) return 0;

  const { data: forecasts, error } = await supabase
    .from("recurring_forecasts")
    .select("id, due_date, projected_amount, status, notes")
    .eq("school_id", schoolId)
    .neq("status", "paid")
    .in("due_date", datas);
  if (error) throw new Error(error.message);
  if (!forecasts || forecasts.length === 0) return 0;

  const disponiveis = forecasts.map((f) => ({ ...f, consumido: false }));
  const hoje = new Date().toLocaleDateString("pt-BR");
  const notaAuditoria = `Baixado automaticamente via importação de extrato em ${hoje}`;

  const aBaixar: Array<{ id: string; notes: string | null }> = [];
  for (const e of expenses) {
    const alvo = centavos(e.amount);
    const match = disponiveis.find(
      (f) => !f.consumido && f.due_date === e.date && centavos(f.projected_amount) === alvo,
    );
    if (!match) continue;
    match.consumido = true;
    const notesAtual = (match.notes ?? "").trim();
    aBaixar.push({
      id: match.id,
      notes: notesAtual ? `${notesAtual}\n${notaAuditoria}` : notaAuditoria,
    });
  }
  if (aBaixar.length === 0) return 0;

  await Promise.all(
    aBaixar.map((f) =>
      supabase
        .from("recurring_forecasts")
        .update({ status: "paid", notes: f.notes })
        .eq("id", f.id),
    ),
  );
  return aBaixar.length;
}
