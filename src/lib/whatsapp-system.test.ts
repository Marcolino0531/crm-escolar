import { describe, it, expect } from "vitest";
import { parseSystemEvent, decideSystemAction } from "./whatsapp-system";

describe("parseSystemEvent", () => {
  it("detecta troca de número (user_changed_number, wa_id v12+)", () => {
    const e = parseSystemEvent({
      from: "553184364127",
      type: "system",
      system: {
        type: "user_changed_number",
        body: "Contato mudou de número",
        wa_id: "5531984364127",
      },
    });
    expect(e.isSystem).toBe(true);
    expect(e.changeType).toBe("user_changed_number");
    expect(e.oldWaId).toBe("553184364127");
    expect(e.newWaId).toBe("5531984364127");
    expect(e.body).toBe("Contato mudou de número");
  });

  it("aceita o campo legado new_wa_id (v11-) e customer", () => {
    expect(
      parseSystemEvent({
        type: "system",
        system: { type: "user_changed_number", new_wa_id: "5531999999999" },
      }).newWaId,
    ).toBe("5531999999999");
    expect(
      parseSystemEvent({
        type: "system",
        system: { type: "customer_changed_number", customer: "5531988888888" },
      }).newWaId,
    ).toBe("5531988888888");
  });

  it("mudança de identidade não expõe novo número", () => {
    const e = parseSystemEvent({
      from: "553184364127",
      type: "system",
      system: { type: "customer_identity_changed", identity: "abc" } as never,
    });
    expect(e.changeType).toBe("customer_identity_changed");
    expect(e.newWaId).toBeNull();
  });

  it("mensagem que não é system", () => {
    expect(parseSystemEvent({ type: "text", from: "553199" }).isSystem).toBe(false);
  });
});

describe("decideSystemAction", () => {
  it("migra quando há troca de número com origem e destino", () => {
    const d = decideSystemAction({
      isSystem: true,
      changeType: "user_changed_number",
      oldWaId: "553184364127",
      newWaId: "5531984364127",
      body: "Número trocado",
    });
    expect(d).toEqual({
      action: "migrate",
      oldWaId: "553184364127",
      newWaId: "5531984364127",
      note: "Número trocado",
    });
  });

  it("usa nota padrão quando o system.body vem vazio", () => {
    const d = decideSystemAction({
      isSystem: true,
      changeType: "user_changed_number",
      oldWaId: "553184364127",
      newWaId: "5531984364127",
      body: "",
    });
    expect(d).toEqual({
      action: "migrate",
      oldWaId: "553184364127",
      newWaId: "5531984364127",
      note: "Número atualizado de 553184364127 para 5531984364127",
    });
  });

  it("ignora eventos de identidade (sem novo número)", () => {
    expect(
      decideSystemAction({
        isSystem: true,
        changeType: "customer_identity_changed",
        oldWaId: "553184364127",
        newWaId: null,
        body: "Identidade alterada",
      }),
    ).toEqual({ action: "ignore" });
  });

  it("ignora quando falta o número antigo", () => {
    expect(
      decideSystemAction({
        isSystem: true,
        changeType: "user_changed_number",
        oldWaId: "",
        newWaId: "5531984364127",
        body: "",
      }),
    ).toEqual({ action: "ignore" });
  });

  it("ignora mensagens que não são system", () => {
    expect(
      decideSystemAction({
        isSystem: false,
        changeType: null,
        oldWaId: "553184364127",
        newWaId: null,
        body: "",
      }),
    ).toEqual({ action: "ignore" });
  });

  it("end-to-end: caso real (8436-4127, só o rótulo, sem novo número) é ignorado", () => {
    // O payload que criou a conversa fantasma não trazia novo wa_id conhecido:
    // sem destino de migração, o evento é ignorado (não vira conversa/mensagem).
    const d = decideSystemAction(
      parseSystemEvent({ from: "553184364127", type: "system", system: {} }),
    );
    expect(d).toEqual({ action: "ignore" });
  });
});
