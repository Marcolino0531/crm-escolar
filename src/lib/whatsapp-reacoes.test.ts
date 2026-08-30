import { describe, it, expect } from "vitest";
import { parseReacao } from "./whatsapp-reacoes";

describe("parseReacao", () => {
  it("extrai o emoji e a mensagem original", () => {
    expect(
      parseReacao({
        type: "reaction",
        reaction: { message_id: "wamid.ABC", emoji: "👍" },
      }),
    ).toEqual({ alvoWamid: "wamid.ABC", emoji: "👍" });
  });

  it("trata emoji ausente ou vazio como remoção da reação", () => {
    expect(
      parseReacao({ type: "reaction", reaction: { message_id: "wamid.ABC", emoji: "" } }),
    ).toEqual({ alvoWamid: "wamid.ABC", emoji: null });
    expect(parseReacao({ type: "reaction", reaction: { message_id: "wamid.ABC" } })).toEqual({
      alvoWamid: "wamid.ABC",
      emoji: null,
    });
  });

  it("ignora reação sem mensagem alvo", () => {
    expect(parseReacao({ type: "reaction", reaction: { emoji: "❤️" } })).toBeNull();
    expect(parseReacao({ type: "reaction" })).toBeNull();
  });

  it("ignora mensagens que não são reação", () => {
    expect(parseReacao({ type: "text" })).toBeNull();
    expect(parseReacao({ type: "image" })).toBeNull();
    expect(parseReacao({})).toBeNull();
  });
});
