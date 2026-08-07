import { describe, it, expect } from "vitest";
import {
  parseIncomingMessage,
  buildMessageFields,
  extFromMime,
  mediaStoragePath,
  IMAGE_DOWNLOAD_ERROR,
} from "./whatsapp-media";

describe("parseIncomingMessage", () => {
  it("captura o media_id e o mime de uma mensagem de imagem", () => {
    const p = parseIncomingMessage({
      type: "image",
      image: { id: "MEDIA123", mime_type: "image/jpeg", caption: " comprovante " },
    });
    expect(p).toEqual({
      isImage: true,
      text: "comprovante",
      mediaId: "MEDIA123",
      mimeType: "image/jpeg",
    });
  });

  it("imagem sem legenda resulta em texto vazio", () => {
    const p = parseIncomingMessage({ type: "image", image: { id: "M1", mime_type: "image/png" } });
    expect(p.isImage).toBe(true);
    expect(p.text).toBe("");
    expect(p.mediaId).toBe("M1");
  });

  it("mensagem de texto não é imagem", () => {
    const p = parseIncomingMessage({ type: "text", text: { body: "olá" } });
    expect(p).toEqual({ isImage: false, text: "olá", mediaId: null, mimeType: null });
  });

  it("botão e interativo extraem o título", () => {
    expect(parseIncomingMessage({ type: "button", button: { text: "Sim" } }).text).toBe("Sim");
    expect(
      parseIncomingMessage({
        type: "interactive",
        interactive: { list_reply: { title: "Opção A" } },
      }).text,
    ).toBe("Opção A");
  });

  it("tipo não tratado cai no rótulo genérico e não é imagem", () => {
    const p = parseIncomingMessage({ type: "audio" });
    expect(p.isImage).toBe(false);
    expect(p.text).toBe("[audio não suportada]");
    expect(p.mediaId).toBeNull();
  });
});

describe("buildMessageFields", () => {
  it("imagem com upload bem-sucedido associa o caminho do storage", () => {
    const parsed = parseIncomingMessage({
      type: "image",
      image: { id: "M9", mime_type: "image/jpeg", caption: "recibo" },
    });
    const fields = buildMessageFields(parsed, { path: "2026/06/M9.jpg", mime: "image/jpeg" });
    expect(fields).toEqual({
      message_type: "image",
      body: "recibo",
      media_path: "2026/06/M9.jpg",
      media_mime: "image/jpeg",
      media_id: "M9",
    });
  });

  it("imagem com falha no download grava a mensagem de erro e preserva o media_id", () => {
    const parsed = parseIncomingMessage({
      type: "image",
      image: { id: "M9", mime_type: "image/jpeg" },
    });
    const fields = buildMessageFields(parsed, null);
    expect(fields).toEqual({
      message_type: "image",
      body: IMAGE_DOWNLOAD_ERROR,
      media_path: null,
      media_mime: "image/jpeg",
      media_id: "M9",
    });
  });

  it("mensagem de texto não recebe campos de mídia", () => {
    const parsed = parseIncomingMessage({ type: "text", text: { body: "oi" } });
    const fields = buildMessageFields(parsed, null);
    expect(fields).toEqual({
      message_type: "text",
      body: "oi",
      media_path: null,
      media_mime: null,
      media_id: null,
    });
  });
});

describe("extFromMime / mediaStoragePath", () => {
  it("mapeia mimes de imagem conhecidos", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/jpeg; codecs=foo")).toBe("jpg");
    expect(extFromMime(null)).toBe("bin");
  });

  it("gera caminho determinístico e idempotente por media_id", () => {
    const now = new Date("2026-06-18T03:59:00Z");
    expect(mediaStoragePath("MEDIA123", "image/jpeg", now)).toBe("2026/06/MEDIA123.jpg");
    expect(mediaStoragePath("MEDIA123", "image/jpeg", now)).toBe("2026/06/MEDIA123.jpg");
  });
});
