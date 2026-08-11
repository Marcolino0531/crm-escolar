import { describe, it, expect } from "vitest";
import { valorBoletoDaParcela, type ParcelaBaixa, type RateioBaixa } from "./sponte-baixa";

function rateio(over: Partial<RateioBaixa> = {}): RateioBaixa {
  return {
    contaCreditada: "Caixa",
    tipoRecebimento: "Cobrança Bancária",
    valorPagoRateado: "100,00",
    ...over,
  };
}

function parcela(over: Partial<ParcelaBaixa> = {}): ParcelaBaixa {
  return {
    // O Sponte devolve "Cobrança Bancária" mesmo quando o boleto foi pago via PIX.
    formaCobranca: "Cobrança Bancária",
    contaCreditar: "Caixa - 489426",
    valorPago: "100,00",
    rateios: [rateio()],
    ...over,
  };
}

describe("valorBoletoDaParcela — unidade de conta única (Vale do Sereno)", () => {
  it("soma o rateio liquidado por boleto", () => {
    expect(
      valorBoletoDaParcela(
        parcela({ valorPago: "396,87", rateios: [rateio({ valorPagoRateado: "396,87" })] }),
        null,
      ),
    ).toBe(396.87);
  });

  it("descarta boleto pago via PIX, mesmo com FormaCobranca = Cobrança Bancária", () => {
    const p = parcela({
      valorPago: "2.492,23",
      rateios: [rateio({ tipoRecebimento: "Pix", valorPagoRateado: "2.492,23" })],
    });
    expect(valorBoletoDaParcela(p, null)).toBe(0);
  });

  it("em rateio misto, soma só a parte liquidada por boleto", () => {
    const p = parcela({
      valorPago: "300,00",
      rateios: [
        rateio({ valorPagoRateado: "200,00" }),
        rateio({ tipoRecebimento: "Pix", valorPagoRateado: "100,00" }),
      ],
    });
    expect(valorBoletoDaParcela(p, null)).toBe(200);
  });

  it("não filtra por conta quando a unidade tem conta única (Conta Creditada sem número)", () => {
    const p = parcela({
      rateios: [rateio({ contaCreditada: "Caixa", valorPagoRateado: "542,10" })],
    });
    expect(valorBoletoDaParcela(p, null)).toBe(542.1);
  });

  it("caso real do Núcleo Vale do Sereno em 07/08/2026: 14 baixas → só os 6 boletos", () => {
    const baixas: ParcelaBaixa[] = [
      // Pagas via PIX (não entram na linha COB COMPE do extrato).
      ["2.492,23", "Pix"],
      ["297,30", "Pix"],
      ["303,50", "Pix"],
      ["182,08", "Pix"],
      ["2.164,30", "Pix"],
      ["0,01", "Pix"],
      ["145,74", "Pix"],
      ["1.449,60", "Pix"],
      // Boletos compensados (a linha do extrato).
      ["396,87", "Cobrança Bancária"],
      ["144,46", "Cobrança Bancária"],
      ["524,68", "Cobrança Bancária"],
      ["123,20", "Cobrança Bancária"],
      ["60,70", "Cobrança Bancária"],
      ["542,10", "Cobrança Bancária"],
    ].map(([valor, tipo]) =>
      parcela({
        valorPago: valor,
        contaCreditar: "Caixa",
        rateios: [
          rateio({ contaCreditada: "Caixa", tipoRecebimento: tipo, valorPagoRateado: valor }),
        ],
      }),
    );

    const total = baixas.reduce((s, p) => s + valorBoletoDaParcela(p, null), 0);
    expect(Math.round(total * 100) / 100).toBe(1792.01);
    expect(baixas.filter((p) => valorBoletoDaParcela(p, null) > 0)).toHaveLength(6);
  });
});

describe("valorBoletoDaParcela — unidades com conta-caixa (CEC, CEC Baby, Belvedere)", () => {
  it("soma apenas o rateio da conta configurada", () => {
    const p = parcela({
      rateios: [
        rateio({ contaCreditada: "Caixa - 489426", valorPagoRateado: "700,00" }),
        rateio({ contaCreditada: "Caixa - 011311", valorPagoRateado: "300,00" }),
      ],
    });
    expect(valorBoletoDaParcela(p, "489426")).toBe(700);
    expect(valorBoletoDaParcela(p, "011311")).toBe(300);
  });

  it("conta certa mas liquidação por PIX não entra", () => {
    const p = parcela({
      rateios: [
        rateio({
          contaCreditada: "Caixa - 9295",
          tipoRecebimento: "Pix",
          valorPagoRateado: "500,00",
        }),
      ],
    });
    expect(valorBoletoDaParcela(p, "9295")).toBe(0);
  });

  it("sem rateio, cai para os campos de topo da parcela", () => {
    const p = parcela({ rateios: [], valorPago: "250,00", contaCreditar: "Caixa - 9295" });
    expect(valorBoletoDaParcela(p, "9295")).toBe(250);
    expect(valorBoletoDaParcela(p, "1137")).toBe(0);
    expect(valorBoletoDaParcela({ ...p, formaCobranca: "Pix" }, "9295")).toBe(0);
    expect(valorBoletoDaParcela(p, null)).toBe(250);
  });
});
