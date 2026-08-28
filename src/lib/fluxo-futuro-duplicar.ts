// Duplicação de despesa prevista (Fluxo Futuro).
//
// A cópia é sempre um lançamento manual novo: leva os dados descritivos e o
// valor da original, mas não o vencimento (o usuário escolhe a nova data), não
// o status "Pago" e não o vínculo de baixa automática — a marca de auditoria da
// conciliação por extrato fica na observação e é removida aqui.

export const MARCA_BAIXA_AUTOMATICA = "Baixado automaticamente via importação de extrato";

export interface DespesaDuplicavel {
  description: string;
  projected_amount: number | string;
  cost_center_id?: string | null;
  sub_cost_center_id?: string | null;
  notes?: string | null;
  status?: string | null;
  due_date?: string | null;
  series_id?: string | null;
}

export interface DuplicacaoDespesa {
  description: string;
  projected_amount: number;
  cost_center_id: string | null;
  sub_cost_center_id: string | null;
  notes: string | null;
  due_date: "";
  status: "pending";
  series_id: null;
}

export function temBaixaAutomatica(notes: string | null | undefined): boolean {
  return (notes ?? "").includes(MARCA_BAIXA_AUTOMATICA);
}

/** Remove as linhas de auditoria da baixa automática, preservando o resto. */
export function limparNotaBaixaAutomatica(notes: string | null | undefined): string | null {
  const restante = (notes ?? "")
    .split("\n")
    .filter((linha) => !linha.includes(MARCA_BAIXA_AUTOMATICA))
    .join("\n")
    .trim();
  return restante || null;
}

export function duplicarDespesa(despesa: DespesaDuplicavel): DuplicacaoDespesa {
  return {
    description: despesa.description,
    projected_amount: Number(despesa.projected_amount),
    cost_center_id: despesa.cost_center_id ?? null,
    sub_cost_center_id: despesa.sub_cost_center_id ?? null,
    notes: limparNotaBaixaAutomatica(despesa.notes),
    due_date: "",
    status: "pending",
    series_id: null,
  };
}
