// Lógica pura de mensagens recebidas do WhatsApp com mídia (imagem, documento e
// áudio).
//
// Separa o PARSING do payload da Meta e a MONTAGEM do registro que vai para o
// banco (`whatsapp_messages`), sem fazer rede nem tocar storage, para ser
// testável isoladamente. O download/upload em si fica em whatsapp.server.ts.

export const IMAGE_DOWNLOAD_ERROR = "Não foi possível carregar esta imagem";
export const DOCUMENT_DOWNLOAD_ERROR = "Não foi possível carregar este documento";
export const AUDIO_DOWNLOAD_ERROR = "Não foi possível carregar este áudio";

// Formato relevante de uma mensagem recebida no webhook da Meta.
export interface WebhookLikeMessage {
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  // Áudio e mensagem de voz (`voice: true`) compartilham o mesmo formato.
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

export type MediaKind = "text" | "image" | "document" | "audio";

// Mensagem de erro gravada no corpo quando o download da mídia falha.
const MEDIA_DOWNLOAD_ERROR: Record<Exclude<MediaKind, "text">, string> = {
  image: IMAGE_DOWNLOAD_ERROR,
  document: DOCUMENT_DOWNLOAD_ERROR,
  audio: AUDIO_DOWNLOAD_ERROR,
};

export interface ParsedIncomingMessage {
  kind: MediaKind;
  // Verdadeiro quando a mensagem carrega uma mídia (imagem, documento ou áudio).
  isMedia: boolean;
  // Texto legível: corpo do texto, legenda da mídia, título do botão/lista,
  // ou o rótulo "[tipo não suportada]" para tipos ainda não tratados.
  text: string;
  // media_id da Meta (só para mídias); usado para baixar o arquivo na hora.
  mediaId: string | null;
  mimeType: string | null;
  // Nome original do arquivo (só para documentos, quando a Meta envia).
  filename: string | null;
}

// Interpreta a mensagem recebida, capturando media_id/mime (imagem, documento e
// áudio) e o filename (documento).
export function parseIncomingMessage(msg: WebhookLikeMessage): ParsedIncomingMessage {
  if (msg.type === "image") {
    return {
      kind: "image",
      isMedia: true,
      text: msg.image?.caption?.trim() ?? "",
      mediaId: msg.image?.id ?? null,
      mimeType: msg.image?.mime_type ?? null,
      filename: null,
    };
  }

  if (msg.type === "document") {
    return {
      kind: "document",
      isMedia: true,
      text: msg.document?.caption?.trim() ?? "",
      mediaId: msg.document?.id ?? null,
      mimeType: msg.document?.mime_type ?? null,
      filename: msg.document?.filename?.trim() || null,
    };
  }

  if (msg.type === "audio") {
    return {
      kind: "audio",
      isMedia: true,
      // A Meta não envia legenda em áudio; o corpo fica vazio e a tela mostra o player.
      text: "",
      mediaId: msg.audio?.id ?? null,
      mimeType: msg.audio?.mime_type ?? null,
      filename: null,
    };
  }

  let text: string;
  if (msg.type === "text") text = msg.text?.body ?? "";
  else if (msg.type === "button") text = msg.button?.text ?? "";
  else if (msg.type === "interactive")
    text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  else text = `[${msg.type ?? "mensagem"} não suportada]`;

  return { kind: "text", isMedia: false, text, mediaId: null, mimeType: null, filename: null };
}

// Campos do registro de mensagem gravado no banco.
export interface MessageMediaFields {
  message_type: MediaKind;
  body: string;
  media_path: string | null;
  media_mime: string | null;
  media_id: string | null;
  media_filename: string | null;
}

// Resultado do upload da mídia no storage do School Hub (null = falhou/expirou).
export interface StoredMedia {
  path: string;
  mime: string | null;
}

// Monta os campos da mensagem a partir do parse e do resultado do armazenamento.
// Para mídias (imagem/documento/áudio): se o upload deu certo, associa o caminho
// definitivo do storage; se falhou (media_id expirado/erro da Meta), grava a
// mensagem de erro no corpo, preservando o media_id para eventual reprocesso.
export function buildMessageFields(
  parsed: ParsedIncomingMessage,
  stored: StoredMedia | null,
): MessageMediaFields {
  if (parsed.kind !== "text") {
    if (stored) {
      return {
        message_type: parsed.kind,
        body: parsed.text,
        media_path: stored.path,
        media_mime: stored.mime,
        media_id: parsed.mediaId,
        media_filename: parsed.filename,
      };
    }
    return {
      message_type: parsed.kind,
      body: MEDIA_DOWNLOAD_ERROR[parsed.kind],
      media_path: null,
      media_mime: parsed.mimeType,
      media_id: parsed.mediaId,
      media_filename: parsed.filename,
    };
  }

  return {
    message_type: "text",
    body: parsed.text,
    media_path: null,
    media_mime: null,
    media_id: null,
    media_filename: null,
  };
}

// Extensão de arquivo a partir de um nome de arquivo (ex.: "recibo.PDF" → "pdf").
export function extFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : null;
}

// Extensão de arquivo a partir do mime-type (fallback .bin). Usada para nomear
// o objeto no storage.
export function extFromMime(mime: string | null | undefined): string {
  switch ((mime ?? "").split(";")[0].trim().toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "application/pdf":
      return "pdf";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.ms-excel":
      return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "text/plain":
      return "txt";
    // Áudio: o WhatsApp manda mensagem de voz em ogg/opus; os demais aparecem
    // quando o responsável encaminha um arquivo de música/gravação.
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/amr":
      return "amr";
    default:
      return "bin";
  }
}

// Caminho determinístico do objeto no bucket, particionado por ano/mês. É
// idempotente por media_id (o webhook pode reentregar o mesmo evento). Para
// documentos, preserva a extensão do nome do arquivo quando disponível.
export function mediaStoragePath(
  mediaId: string,
  mime: string | null | undefined,
  now: Date = new Date(),
  filename?: string | null,
): string {
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extFromFilename(filename) ?? extFromMime(mime);
  return `${ano}/${mes}/${mediaId}.${ext}`;
}
