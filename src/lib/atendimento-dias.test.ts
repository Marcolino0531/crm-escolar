import { describe, it, expect } from "vitest";
import { chaveDoDia, rotuloDoDia, agruparPorDia, instanteDaMensagem } from "./atendimento-dias";

const TZ = "America/Sao_Paulo";
// 12/08/2026 10:27 em Brasília.
const AGORA = new Date("2026-08-12T13:27:00Z");

function msg(iso: string | null, created = "2026-08-12T13:00:00Z") {
  return { wa_timestamp: iso, created_at: created, id: iso ?? created };
}

describe("chaveDoDia", () => {
  it("usa o fuso do usuário, não o UTC", () => {
    // 03:00Z de 08/08 ainda é 07/08 em Brasília (UTC-3).
    expect(chaveDoDia("2026-08-08T02:00:00Z", TZ)).toBe("2026-08-07");
    expect(chaveDoDia("2026-08-08T02:00:00Z", "UTC")).toBe("2026-08-08");
  });

  it("devolve vazio para data ausente ou inválida", () => {
    expect(chaveDoDia(null, TZ)).toBe("");
    expect(chaveDoDia("não é data", TZ)).toBe("");
  });
});

describe("rotuloDoDia", () => {
  it("usa Hoje e Ontem", () => {
    expect(rotuloDoDia("2026-08-12", AGORA, TZ)).toBe("Hoje");
    expect(rotuloDoDia("2026-08-11", AGORA, TZ)).toBe("Ontem");
  });

  it("usa a data por extenso nos demais dias", () => {
    expect(rotuloDoDia("2026-08-07", AGORA, TZ)).toBe("07 de agosto de 2026");
    expect(rotuloDoDia("2026-07-31", AGORA, TZ)).toBe("31 de julho de 2026");
  });

  it("não escorrega de dia na virada do mês", () => {
    expect(rotuloDoDia("2026-08-01", AGORA, TZ)).toBe("01 de agosto de 2026");
  });
});

describe("agruparPorDia", () => {
  it("insere divisor antes da primeira mensagem e em cada troca de dia", () => {
    const itens = agruparPorDia(
      [
        msg("2026-07-24T17:34:00Z"),
        msg("2026-07-24T17:35:00Z"),
        msg("2026-08-11T14:10:00Z"),
        msg("2026-08-12T13:07:00Z"),
      ],
      AGORA,
      TZ,
    );
    expect(itens.map((i) => (i.tipo === "divisor" ? i.label : "msg"))).toEqual([
      "24 de julho de 2026",
      "msg",
      "msg",
      "Ontem",
      "msg",
      "Hoje",
      "msg",
    ]);
  });

  it("não repete divisor para várias mensagens do mesmo dia", () => {
    const itens = agruparPorDia(
      [msg("2026-08-12T11:00:00Z"), msg("2026-08-12T12:00:00Z"), msg("2026-08-12T13:00:00Z")],
      AGORA,
      TZ,
    );
    expect(itens.filter((i) => i.tipo === "divisor")).toHaveLength(1);
    expect(itens).toHaveLength(4);
  });

  it("separa mensagens da mesma data UTC que caem em dias diferentes no fuso local", () => {
    const itens = agruparPorDia(
      [msg("2026-08-11T22:00:00Z"), msg("2026-08-12T01:00:00Z")],
      AGORA,
      TZ,
    );
    // 22:00Z é 19:00 de 11/08 e 01:00Z é 22:00 de 11/08 — mesmo dia local.
    expect(itens.filter((i) => i.tipo === "divisor")).toHaveLength(1);
  });

  it("preserva a ordem das mensagens", () => {
    const a = msg("2026-08-11T14:00:00Z");
    const b = msg("2026-08-12T14:00:00Z");
    const itens = agruparPorDia([a, b], AGORA, TZ);
    expect(itens.filter((i) => i.tipo === "mensagem").map((i) => i.msg)).toEqual([a, b]);
  });

  it("cai para created_at quando a Meta não informou o carimbo", () => {
    const semCarimbo = msg(null, "2026-08-10T13:00:00Z");
    expect(instanteDaMensagem(semCarimbo)).toBe("2026-08-10T13:00:00Z");
    const itens = agruparPorDia([semCarimbo], AGORA, TZ);
    expect(itens[0]).toEqual({
      tipo: "divisor",
      dia: "2026-08-10",
      label: "10 de agosto de 2026",
    });
  });

  it("renderiza a mensagem sem divisor quando não há data utilizável", () => {
    const invalida = { wa_timestamp: null, created_at: "inválido" };
    const itens = agruparPorDia([invalida], AGORA, TZ);
    expect(itens).toEqual([{ tipo: "mensagem", msg: invalida }]);
  });

  it("lista vazia não gera divisores", () => {
    expect(agruparPorDia([], AGORA, TZ)).toEqual([]);
  });
});
