import { describe, expect, it } from "vitest";
import {
  caminhoMidiaSaida,
  estadoJanela24h,
  extDoMime,
  JANELA_ATENDIMENTO_MS,
  LIMITE_ENVIO,
  montarPayloadMidia,
  nomePadrao,
  previewMidia,
  tipoDoMime,
  validarArquivoEnvio,
} from "./whatsapp-send-media";

describe("tipoDoMime", () => {
  it("classifica os formatos aceitos por tipo de mensagem da Meta", () => {
    expect(tipoDoMime("image/jpeg")).toBe("image");
    expect(tipoDoMime("image/png")).toBe("image");
    expect(tipoDoMime("application/pdf")).toBe("document");
    expect(tipoDoMime("audio/mpeg")).toBe("audio");
    expect(tipoDoMime("audio/ogg; codecs=opus")).toBe("audio");
  });

  it("recusa formatos que a Cloud API não aceita nesses tipos", () => {
    // webm é o que o Chrome grava por padrão, e a Meta o recusa.
    expect(tipoDoMime("audio/webm;codecs=opus")).toBeNull();
    expect(tipoDoMime("image/webp")).toBeNull();
    expect(tipoDoMime("application/msword")).toBeNull();
    expect(tipoDoMime("")).toBeNull();
    expect(tipoDoMime(null)).toBeNull();
  });
});

describe("validarArquivoEnvio", () => {
  it("aceita imagem dentro do limite e devolve tipo e mime normalizados", () => {
    const r = validarArquivoEnvio({ name: "foto.JPG", type: "image/jpeg", size: 1024 });
    expect(r).toEqual({ ok: true, tipo: "image", mime: "image/jpeg", filename: "foto.JPG" });
  });

  it("aceita PDF e áudio", () => {
    expect(
      validarArquivoEnvio({ name: "boleto.pdf", type: "application/pdf", size: 2048 }),
    ).toEqual({ ok: true, tipo: "document", mime: "application/pdf", filename: "boleto.pdf" });
    expect(
      validarArquivoEnvio({ name: "recado.m4a", type: "audio/mp4", size: 3000 }),
    ).toMatchObject({ ok: true, tipo: "audio" });
  });

  it("nomeia o arquivo quando o navegador não informa nome (gravação)", () => {
    const r = validarArquivoEnvio({ name: "", type: "audio/ogg;codecs=opus", size: 500 });
    expect(r).toEqual({ ok: true, tipo: "audio", mime: "audio/ogg", filename: "audio.ogg" });
  });

  it("recusa formato não suportado com mensagem que nomeia o mime", () => {
    const r = validarArquivoEnvio({ name: "clip.webm", type: "audio/webm", size: 500 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("audio/webm");
      expect(r.erro).toContain("Formato não suportado");
    }
  });

  it("recusa arquivo acima do limite do tipo, citando os dois tamanhos", () => {
    const r = validarArquivoEnvio({
      name: "foto.png",
      type: "image/png",
      size: LIMITE_ENVIO.image + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("5.0 MB");
      expect(r.erro).toContain("Imagem");
    }
  });

  it("aplica limite por tipo: 6 MB é grande para imagem e pequeno para áudio", () => {
    const seisMb = 6 * 1024 * 1024;
    expect(validarArquivoEnvio({ name: "a.png", type: "image/png", size: seisMb }).ok).toBe(false);
    expect(validarArquivoEnvio({ name: "a.mp3", type: "audio/mpeg", size: seisMb }).ok).toBe(true);
  });

  it("recusa arquivo vazio", () => {
    const r = validarArquivoEnvio({ name: "a.png", type: "image/png", size: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("Arquivo vazio.");
  });
});

describe("montarPayloadMidia", () => {
  it("monta imagem com legenda", () => {
    expect(
      montarPayloadMidia({
        to: "5531999999999",
        tipo: "image",
        mediaId: "MEDIA-1",
        caption: "  Segue o comprovante  ",
      }),
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5531999999999",
      type: "image",
      image: { id: "MEDIA-1", caption: "Segue o comprovante" },
    });
  });

  it("omite a legenda da imagem quando vazia (a Meta rejeita caption vazio)", () => {
    const p = montarPayloadMidia({
      to: "5531999999999",
      tipo: "image",
      mediaId: "MEDIA-1",
      caption: "   ",
    });
    expect(p.image).toEqual({ id: "MEDIA-1" });
  });

  it("monta documento com filename e legenda", () => {
    const p = montarPayloadMidia({
      to: "5531999999999",
      tipo: "document",
      mediaId: "MEDIA-2",
      filename: "boleto-agosto.pdf",
      caption: "Boleto de agosto",
    });
    expect(p.type).toBe("document");
    expect(p.document).toEqual({
      id: "MEDIA-2",
      filename: "boleto-agosto.pdf",
      caption: "Boleto de agosto",
    });
  });

  it("monta áudio sem legenda nem filename (a Cloud API não aceita nos dois casos)", () => {
    const p = montarPayloadMidia({
      to: "5531999999999",
      tipo: "audio",
      mediaId: "MEDIA-3",
      caption: "isto seria ignorado",
      filename: "audio.ogg",
    });
    expect(p).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5531999999999",
      type: "audio",
      audio: { id: "MEDIA-3" },
    });
  });

  it("nunca envia `link`: a mídia vai sempre por media id", () => {
    const p = montarPayloadMidia({ to: "5531999999999", tipo: "image", mediaId: "MEDIA-4" });
    expect(JSON.stringify(p)).not.toContain("link");
  });
});

describe("previewMidia", () => {
  it("usa a legenda quando existe e o rótulo do tipo quando não", () => {
    expect(previewMidia("image", null, "Comprovante")).toBe("Comprovante");
    expect(previewMidia("image", null)).toBe("📷 Imagem");
    expect(previewMidia("audio", null)).toBe("🎤 Áudio");
    expect(previewMidia("document", "boleto.pdf")).toBe("📄 boleto.pdf");
    expect(previewMidia("document", null)).toBe("📄 Documento");
  });
});

describe("caminhoMidiaSaida", () => {
  it("particiona por ano/mês sob o prefixo de saída, com extensão do mime", () => {
    const path = caminhoMidiaSaida("abc-123", "application/pdf", new Date("2026-08-20T12:00:00Z"));
    expect(path).toBe("saida/2026/08/abc-123.pdf");
  });

  it("cai para .bin quando o mime é desconhecido", () => {
    expect(extDoMime("application/zip")).toBe("bin");
    expect(nomePadrao("document", "application/zip")).toBe("documento.bin");
  });
});

describe("estadoJanela24h", () => {
  const agora = new Date("2026-08-20T12:00:00Z");
  const msg = (direction: "in" | "out", iso: string) => ({
    direction,
    wa_timestamp: iso,
    created_at: iso,
  });

  it("está aberta quando a última mensagem recebida tem menos de 24h", () => {
    const r = estadoJanela24h([msg("in", "2026-08-20T09:00:00Z")], agora);
    expect(r.estado).toBe("aberta");
    if (r.estado === "aberta") {
      expect(r.expiraEm.toISOString()).toBe(
        new Date(new Date("2026-08-20T09:00:00Z").getTime() + JANELA_ATENDIMENTO_MS).toISOString(),
      );
    }
  });

  it("fecha quando a última mensagem recebida passou de 24h", () => {
    const r = estadoJanela24h(
      [msg("in", "2026-08-19T08:00:00Z"), msg("out", "2026-08-20T11:00:00Z")],
      agora,
    );
    expect(r.estado).toBe("fechada");
    if (r.estado === "fechada") {
      expect(r.ultimaEntrada.toISOString()).toBe("2026-08-19T08:00:00.000Z");
    }
  });

  it("conta da última mensagem RECEBIDA, não da última da conversa", () => {
    const r = estadoJanela24h(
      [msg("in", "2026-08-20T11:30:00Z"), msg("in", "2026-08-18T11:30:00Z")],
      agora,
    );
    expect(r.estado).toBe("aberta");
  });

  it("fica indeterminada sem mensagem recebida (conversa aberta por cobrança)", () => {
    expect(estadoJanela24h([msg("out", "2026-08-20T11:00:00Z")], agora).estado).toBe(
      "indeterminada",
    );
    expect(estadoJanela24h([], agora).estado).toBe("indeterminada");
  });

  it("ignora carimbo inválido em vez de tratá-lo como agora", () => {
    const r = estadoJanela24h(
      [{ direction: "in", wa_timestamp: "não-é-data", created_at: "não-é-data" }],
      agora,
    );
    expect(r.estado).toBe("indeterminada");
  });
});
