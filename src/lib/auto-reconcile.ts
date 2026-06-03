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
