// Lógica pura de mensagens recebidas do WhatsApp com mídia (imagens).
//
// Separa o PARSING do payload da Meta e a MONTAGEM do registro que vai para o
// banco (`whatsapp_messages`), sem fazer rede nem tocar storage, para ser
// testável isoladamente. O download/upload em si fica em whatsapp.server.ts.

export const IMAGE_DOWNLOAD_ERROR = "Não foi possível carregar esta imagem";

// Formato relevante de uma mensagem recebida no webhook da Meta.
export interface WebhookLikeMessage {
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

export interface ParsedIncomingMessage {
  isImage: boolean;
  // Texto legível: corpo do texto, legenda da imagem, título do botão/lista,
  // ou o rótulo "[tipo não suportada]" para tipos ainda não tratados.
  text: string;
  // media_id da Meta (só para imagens); usado para baixar a mídia na hora.
  mediaId: string | null;
  mimeType: string | null;
}

// Interpreta a mensagem recebida, capturando o media_id quando for imagem.
export function parseIncomingMessage(msg: WebhookLikeMessage): ParsedIncomingMessage {
  if (msg.type === "image") {
    return {
      isImage: true,
      text: msg.image?.caption?.trim() ?? "",
      mediaId: msg.image?.id ?? null,
      mimeType: msg.image?.mime_type ?? null,
    };
  }

  let text: string;
  if (msg.type === "text") text = msg.text?.body ?? "";
  else if (msg.type === "button") text = msg.button?.text ?? "";
  else if (msg.type === "interactive")
    text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  else text = `[${msg.type ?? "mensagem"} não suportada]`;

  return { isImage: false, text, mediaId: null, mimeType: null };
}

// Campos do registro de mensagem gravado no banco.
export interface MessageMediaFields {
  message_type: "text" | "image";
  body: string;
  media_path: string | null;
  media_mime: string | null;
  media_id: string | null;
}

// Resultado do upload da mídia no storage do School Hub (null = falhou/expirou).
export interface StoredMedia {
  path: string;
  mime: string | null;
}

// Monta os campos da mensagem a partir do parse e do resultado do armazenamento.
// Para imagens: se o upload deu certo, associa o caminho definitivo do storage;
// se falhou (media_id expirado/erro da Meta), grava a mensagem de erro no corpo,
// preservando o media_id para eventual reprocessamento.
export function buildMessageFields(
  parsed: ParsedIncomingMessage,
  stored: StoredMedia | null,
): MessageMediaFields {
  if (parsed.isImage) {
    if (stored) {
      return {
        message_type: "image",
        body: parsed.text,
        media_path: stored.path,
        media_mime: stored.mime,
        media_id: parsed.mediaId,
      };
    }
    return {
      message_type: "image",
      body: IMAGE_DOWNLOAD_ERROR,
      media_path: null,
      media_mime: parsed.mimeType,
      media_id: parsed.mediaId,
    };
  }

  return {
    message_type: "text",
    body: parsed.text,
    media_path: null,
    media_mime: null,
    media_id: null,
  };
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
    default:
      return "bin";
  }
}

// Caminho determinístico do objeto no bucket, particionado por ano/mês. É
// idempotente por media_id (o webhook pode reentregar o mesmo evento).
export function mediaStoragePath(
  mediaId: string,
  mime: string | null | undefined,
  now: Date = new Date(),
): string {
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}/${mes}/${mediaId}.${extFromMime(mime)}`;
}
