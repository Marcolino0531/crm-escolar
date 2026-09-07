import { describe, expect, it } from "vitest";
import {
  contratoCancelavel,
  corpoRecusaZapSign,
  statusZapSignRecusado,
  validarMotivoCancelamento,
} from "./contrato-cancelamento";

describe("validarMotivoCancelamento", () => {
  it("exige motivo", () => {
    expect(validarMotivoCancelamento("")).toBe("Informe o motivo do cancelamento.");
    expect(validarMotivoCancelamento("   ")).toBe("Informe o motivo do cancelamento.");
  });

  it("exige tamanho mínimo e respeita o máximo", () => {
    expect(validarMotivoCancelamento("abc")).toMatch(/pelo menos 5/);
    expect(validarMotivoCancelamento("x".repeat(501))).toMatch(/no máximo 500/);
    expect(validarMotivoCancelamento("Valor da mensalidade errado")).toBeNull();
  });
});

describe("contratoCancelavel", () => {
  it("só contrato enviado com documento ainda em andamento", () => {
    expect(contratoCancelavel("enviado", "pending")).toBe(true);
    expect(contratoCancelavel("enviado", "link_opened")).toBe(true);
    expect(contratoCancelavel("enviado", "signed")).toBe(false);
    expect(contratoCancelavel("enviado", "refused")).toBe(false);
    expect(contratoCancelavel("enviado", null)).toBe(false);
    expect(contratoCancelavel("gerando", "pending")).toBe(false);
    expect(contratoCancelavel("erro", "pending")).toBe(false);
    expect(contratoCancelavel("cancelado", "pending")).toBe(false);
  });
});

describe("corpoRecusaZapSign", () => {
  it("monta o corpo do POST /refuse/ com notify_signer explícito", () => {
    expect(
      corpoRecusaZapSign("tok", {
        motivo: "  Gerado com valor errado ",
        notificarSignatarios: false,
      }),
    ).toEqual({
      doc_token: "tok",
      rejected_reason: "Gerado com valor errado",
      notify_signer: false,
    });
    expect(
      corpoRecusaZapSign("tok", { motivo: "x", notificarSignatarios: true }).notify_signer,
    ).toBe(true);
  });
});

describe("statusZapSignRecusado", () => {
  it("reconhece só refused", () => {
    expect(statusZapSignRecusado("refused")).toBe(true);
    expect(statusZapSignRecusado("pending")).toBe(false);
    expect(statusZapSignRecusado(null)).toBe(false);
  });
});
