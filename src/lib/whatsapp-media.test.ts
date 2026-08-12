import { describe, it, expect } from "vitest";
import {
  parseIncomingMessage,
  buildMessageFields,
  extFromMime,
  extFromFilename,
  mediaStoragePath,
  IMAGE_DOWNLOAD_ERROR,
  DOCUMENT_DOWNLOAD_ERROR,
  AUDIO_DOWNLOAD_ERROR,
} from "./whatsapp-media";

describe("parseIncomingMessage", () => {
  it("captura o media_id e o mime de uma mensagem de imagem", () => {
    const p = parseIncomingMessage({
      type: "image",
      image: { id: "MEDIA123", mime_type: "image/jpeg", caption: " comprovante " },
    });
    expect(p).toEqual({
      kind: "image",
      isMedia: true,
      text: "comprovante",
      mediaId: "MEDIA123",
      mimeType: "image/jpeg",
      filename: null,
    });
  });

  it("imagem sem legenda resulta em texto vazio", () => {
    const p = parseIncomingMessage({ type: "image", image: { id: "M1", mime_type: "image/png" } });
    expect(p.kind).toBe("image");
    expect(p.isMedia).toBe(true);
    expect(p.text).toBe("");
    expect(p.mediaId).toBe("M1");
  });

  it("captura media_id, mime e filename de uma mensagem de documento", () => {
    const p = parseIncomingMessage({
      type: "document",
      document: {
        id: "DOC123",
        mime_type: "application/pdf",
        caption: " comprovante ",
        filename: " boleto.pdf ",
      },
    });
    expect(p).toEqual({
      kind: "document",
      isMedia: true,
      text: "comprovante",
      mediaId: "DOC123",
      mimeType: "application/pdf",
      filename: "boleto.pdf",
    });
  });

  it("documento sem filename e sem legenda mantém filename nulo e texto vazio", () => {
    const p = parseIncomingMessage({
      type: "document",
      document: { id: "DOC9", mime_type: "application/pdf" },
    });
    expect(p.kind).toBe("document");
    expect(p.isMedia).toBe(true);
    expect(p.text).toBe("");
    expect(p.filename).toBeNull();
    expect(p.mediaId).toBe("DOC9");
  });

  it("mensagem de texto não é mídia", () => {
    const p = parseIncomingMessage({ type: "text", text: { body: "olá" } });
    expect(p).toEqual({
      kind: "text",
      isMedia: false,
      text: "olá",
      mediaId: null,
      mimeType: null,
      filename: null,
    });
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

  it("captura media_id e mime de uma mensagem de voz (ogg/opus)", () => {
    const p = parseIncomingMessage({
      type: "audio",
      audio: { id: "AUD123", mime_type: "audio/ogg; codecs=opus", voice: true },
    });
    expect(p).toEqual({
      kind: "audio",
      isMedia: true,
      text: "",
      mediaId: "AUD123",
      mimeType: "audio/ogg; codecs=opus",
      filename: null,
    });
  });

  it("áudio encaminhado (arquivo, sem voice) também é tratado como mídia", () => {
    const p = parseIncomingMessage({
      type: "audio",
      audio: { id: "AUD9", mime_type: "audio/mpeg" },
    });
    expect(p.kind).toBe("audio");
    expect(p.isMedia).toBe(true);
    expect(p.mediaId).toBe("AUD9");
    expect(p.mimeType).toBe("audio/mpeg");
  });

  it("áudio sem media_id não dispara download (mediaId nulo)", () => {
    const p = parseIncomingMessage({ type: "audio", audio: { mime_type: "audio/ogg" } });
    expect(p.kind).toBe("audio");
    expect(p.mediaId).toBeNull();
  });

  it("tipo não tratado cai no rótulo genérico e não é mídia", () => {
    const p = parseIncomingMessage({ type: "sticker" });
    expect(p.isMedia).toBe(false);
    expect(p.kind).toBe("text");
    expect(p.text).toBe("[sticker não suportada]");
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
      media_filename: null,
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
      media_filename: null,
    });
  });

  it("documento com upload bem-sucedido associa caminho e filename", () => {
    const parsed = parseIncomingMessage({
      type: "document",
      document: { id: "D1", mime_type: "application/pdf", filename: "boleto.pdf" },
    });
    const fields = buildMessageFields(parsed, { path: "2026/06/D1.pdf", mime: "application/pdf" });
    expect(fields).toEqual({
      message_type: "document",
      body: "",
      media_path: "2026/06/D1.pdf",
      media_mime: "application/pdf",
      media_id: "D1",
      media_filename: "boleto.pdf",
    });
  });

  it("documento com falha grava a mensagem de erro e preserva media_id e filename", () => {
    const parsed = parseIncomingMessage({
      type: "document",
      document: { id: "D1", mime_type: "application/pdf", filename: "boleto.pdf" },
    });
    const fields = buildMessageFields(parsed, null);
    expect(fields).toEqual({
      message_type: "document",
      body: DOCUMENT_DOWNLOAD_ERROR,
      media_path: null,
      media_mime: "application/pdf",
      media_id: "D1",
      media_filename: "boleto.pdf",
    });
  });

  it("documento não-PDF (ex.: docx) é tratado genericamente sem quebrar", () => {
    const parsed = parseIncomingMessage({
      type: "document",
      document: {
        id: "D2",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "contrato.docx",
      },
    });
    const fields = buildMessageFields(parsed, { path: "2026/06/D2.docx", mime: parsed.mimeType });
    expect(fields.message_type).toBe("document");
    expect(fields.media_path).toBe("2026/06/D2.docx");
    expect(fields.media_filename).toBe("contrato.docx");
  });

  it("áudio com upload bem-sucedido associa a URL do storage ao registro", () => {
    const parsed = parseIncomingMessage({
      type: "audio",
      audio: { id: "AUD1", mime_type: "audio/ogg; codecs=opus", voice: true },
    });
    const stored = {
      path: mediaStoragePath("AUD1", "audio/ogg; codecs=opus", new Date("2026-06-18T03:59:00Z")),
      mime: "audio/ogg; codecs=opus",
    };
    const fields = buildMessageFields(parsed, stored);
    expect(fields).toEqual({
      message_type: "audio",
      body: "",
      media_path: "2026/06/AUD1.ogg",
      media_mime: "audio/ogg; codecs=opus",
      media_id: "AUD1",
      media_filename: null,
    });
  });

  it("áudio com falha no download grava a mensagem de erro e preserva o media_id", () => {
    const parsed = parseIncomingMessage({
      type: "audio",
      audio: { id: "AUD1", mime_type: "audio/ogg" },
    });
    const fields = buildMessageFields(parsed, null);
    expect(fields).toEqual({
      message_type: "audio",
      body: AUDIO_DOWNLOAD_ERROR,
      media_path: null,
      media_mime: "audio/ogg",
      media_id: "AUD1",
      media_filename: null,
    });
    // O corpo não volta a ser o "[audio não suportada]" de antes.
    expect(fields.body).not.toContain("não suportada");
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
      media_filename: null,
    });
  });
});

describe("extFromMime / extFromFilename / mediaStoragePath", () => {
  it("mapeia mimes de imagem conhecidos", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/jpeg; codecs=foo")).toBe("jpg");
    expect(extFromMime(null)).toBe("bin");
  });

  it("mapeia mimes de áudio conhecidos (voz do WhatsApp é ogg/opus)", () => {
    expect(extFromMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extFromMime("audio/opus")).toBe("ogg");
    expect(extFromMime("audio/mpeg")).toBe("mp3");
    expect(extFromMime("audio/mp4")).toBe("m4a");
    expect(extFromMime("audio/aac")).toBe("aac");
    expect(extFromMime("audio/amr")).toBe("amr");
  });

  it("caminho do áudio no storage é idempotente por media_id", () => {
    const now = new Date("2026-06-18T03:59:00Z");
    expect(mediaStoragePath("AUD7", "audio/ogg; codecs=opus", now)).toBe("2026/06/AUD7.ogg");
    expect(mediaStoragePath("AUD7", "audio/ogg; codecs=opus", now)).toBe("2026/06/AUD7.ogg");
  });

  it("mapeia mimes de documento conhecidos", () => {
    expect(extFromMime("application/pdf")).toBe("pdf");
    expect(extFromMime("application/msword")).toBe("doc");
    expect(
      extFromMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("docx");
    expect(extFromMime("application/vnd.ms-excel")).toBe("xls");
    expect(extFromMime("text/plain")).toBe("txt");
    expect(extFromMime("application/zip")).toBe("bin");
  });

  it("extrai a extensão do nome do arquivo (case-insensitive)", () => {
    expect(extFromFilename("boleto.PDF")).toBe("pdf");
    expect(extFromFilename("relatorio.final.docx")).toBe("docx");
    expect(extFromFilename("semextensao")).toBeNull();
    expect(extFromFilename(null)).toBeNull();
  });

  it("gera caminho determinístico e idempotente por media_id", () => {
    const now = new Date("2026-06-18T03:59:00Z");
    expect(mediaStoragePath("MEDIA123", "image/jpeg", now)).toBe("2026/06/MEDIA123.jpg");
    expect(mediaStoragePath("MEDIA123", "image/jpeg", now)).toBe("2026/06/MEDIA123.jpg");
  });

  it("documento preserva a extensão do filename quando disponível", () => {
    const now = new Date("2026-06-18T03:59:00Z");
    expect(mediaStoragePath("DOC1", "application/pdf", now, "boleto.pdf")).toBe("2026/06/DOC1.pdf");
    // Sem filename, cai no mime.
    expect(mediaStoragePath("DOC1", "application/pdf", now)).toBe("2026/06/DOC1.pdf");
    // Filename tem prioridade sobre um mime genérico/ausente.
    expect(mediaStoragePath("DOC2", null, now, "planilha.xlsx")).toBe("2026/06/DOC2.xlsx");
  });
});
