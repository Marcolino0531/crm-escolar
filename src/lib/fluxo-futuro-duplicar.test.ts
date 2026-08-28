import { describe, it, expect } from "vitest";
import {
  MARCA_BAIXA_AUTOMATICA,
  duplicarDespesa,
  limparNotaBaixaAutomatica,
  temBaixaAutomatica,
} from "./fluxo-futuro-duplicar";

describe("duplicarDespesa", () => {
  it("copia descrição, categoria, subcategoria, valor e observação", () => {
    const copia = duplicarDespesa({
      description: "Aluguel Bloco B",
      projected_amount: "1234.56",
      cost_center_id: "cc-1",
      sub_cost_center_id: "sub-1",
      notes: "Contrato reajustado em maio",
      status: "pending",
      due_date: "2026-03-10",
    });

    expect(copia).toMatchObject({
      description: "Aluguel Bloco B",
      projected_amount: 1234.56,
      cost_center_id: "cc-1",
      sub_cost_center_id: "sub-1",
      notes: "Contrato reajustado em maio",
    });
  });

  it("não copia o vencimento da despesa original", () => {
    const copia = duplicarDespesa({
      description: "Conta de Luz",
      projected_amount: 900,
      due_date: "2026-03-10",
    });

    expect(copia.due_date).toBe("");
  });

  it('não copia o status "Pago" — a cópia nasce Pendente', () => {
    const copia = duplicarDespesa({
      description: "Conta de Luz",
      projected_amount: 900,
      status: "paid",
      due_date: "2026-03-10",
    });

    expect(copia.status).toBe("pending");
  });

  it("não leva o vínculo de baixa automática, preservando o resto da observação", () => {
    const original = {
      description: "Fornecedor X",
      projected_amount: 500,
      status: "paid",
      due_date: "2026-03-10",
      notes: `Pagamento antecipado\n${MARCA_BAIXA_AUTOMATICA} em 10/03/2026`,
      series_id: "serie-1",
    };
    expect(temBaixaAutomatica(original.notes)).toBe(true);

    const copia = duplicarDespesa(original);

    expect(temBaixaAutomatica(copia.notes)).toBe(false);
    expect(copia.notes).toBe("Pagamento antecipado");
    expect(copia.status).toBe("pending");
    expect(copia.due_date).toBe("");
    expect(copia.series_id).toBeNull();
  });

  it("zera a observação quando ela só continha a marca de baixa automática", () => {
    const copia = duplicarDespesa({
      description: "Fornecedor Y",
      projected_amount: 100,
      notes: `${MARCA_BAIXA_AUTOMATICA} em 10/03/2026`,
    });

    expect(copia.notes).toBeNull();
    expect(limparNotaBaixaAutomatica(null)).toBeNull();
  });
});
