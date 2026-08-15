// Lógica pura do ENVIO de mídia pelo Atendimento (imagem, PDF e áudio).
//
// Cuida de três decisões que não dependem de rede nem de React: se o arquivo
// escolhido é aceitável (tipo e tamanho, pelas regras da Meta), qual o payload
// exato do endpoint /messages para cada tipo, e o estado da janela de 24h. O
// upload e o POST ficam em whatsapp.server.ts; o recebimento fica em
// whatsapp-media.ts.

import { instanteDaMensagem, type MensagemComData } from "./atendimento-dias";

// Tipos de mídia que o School Hub envia. Espelha `MediaKind` do recebimento,
// sem "text" (texto tem endpoint próprio) e sem sticker/vídeo, fora do escopo.
export type MediaEnvioTipo = "image" | "document" | "audio";

// Limites de tamanho da Cloud API, por tipo (bytes). Documento chega a 100 MB na
// Meta, mas o teto aqui é menor de propósito: o arquivo passa pelo storage e pela
// função serverless antes de chegar à Meta.
export const LIMITE_ENVIO: Record<MediaEnvioTipo, number> = {
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 20 * 1024 * 1024,
};

// Mime-types aceitos pela Meta em cada tipo de mensagem. A lista é fechada de
// propósito: mandar um mime fora dela devolve erro genérico da Graph API, que
// não ajuda quem está atendendo.
const MIMES_IMAGEM = new Set(["image/jpeg", "image/jpg", "image/png"]);
const MIMES_DOCUMENTO = new Set(["application/pdf"]);
const MIMES_AUDIO = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
  "audio/opus",
  // Gravação do navegador: o Chrome produz "audio/webm;codecs=opus", que a Meta
  // não aceita — a conversão para ogg/opus acontece antes de chegar aqui.
]);

export const MIMES_ACEITOS_LABEL = "JPG, PNG, PDF ou áudio (MP3, AAC, M4A, OGG/Opus, AMR)";

// Normaliza o mime removendo parâmetros ("audio/ogg; codecs=opus" → "audio/ogg").
export function mimeBase(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

// Tipo de mensagem da Meta correspondente ao mime, ou null quando o formato não
// é suportado no envio.
export function tipoDoMime(mime: string | null | undefined): MediaEnvioTipo | null {
  const m = mimeBase(mime);
  if (MIMES_IMAGEM.has(m)) return "image";
  if (MIMES_DOCUMENTO.has(m)) return "document";
  if (MIMES_AUDIO.has(m)) return "audio";
  return null;
}

function formatarTamanho(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const ROTULO_TIPO: Record<MediaEnvioTipo, string> = {
  image: "Imagem",
  document: "PDF",
  audio: "Áudio",
};

export type ArquivoEnvio = {
  name?: string | null;
  type?: string | null;
  size: number;
};

export type ValidacaoEnvio =
  | { ok: true; tipo: MediaEnvioTipo; mime: string; filename: string }
  | { ok: false; erro: string };

// Valida o arquivo escolhido antes de qualquer upload, devolvendo mensagem
// pronta para a tela quando recusado. Roda também no servidor, sobre o arquivo
// realmente recebido, porque o mime declarado pelo navegador não é confiável.
export function validarArquivoEnvio(arquivo: ArquivoEnvio): ValidacaoEnvio {
  const mime = mimeBase(arquivo.type);
  const tipo = tipoDoMime(mime);
  if (!tipo) {
    return {
      ok: false,
      erro: `Formato não suportado pelo WhatsApp${mime ? ` (${mime})` : ""}. Envie ${MIMES_ACEITOS_LABEL}.`,
    };
  }
  if (arquivo.size <= 0) {
    return { ok: false, erro: "Arquivo vazio." };
  }
  const limite = LIMITE_ENVIO[tipo];
  if (arquivo.size > limite) {
    return {
      ok: false,
      erro: `${ROTULO_TIPO[tipo]} de ${formatarTamanho(arquivo.size)} excede o limite de ${formatarTamanho(limite)} do WhatsApp.`,
    };
  }
  return { ok: true, tipo, mime, filename: (arquivo.name ?? "").trim() || nomePadrao(tipo, mime) };
}

// Nome usado quando o arquivo não tem um (gravação de áudio, colagem de imagem).
export function nomePadrao(tipo: MediaEnvioTipo, mime: string | null | undefined): string {
  const ext = extDoMime(mime);
  if (tipo === "audio") return `audio.${ext}`;
  if (tipo === "image") return `imagem.${ext}`;
  return `documento.${ext}`;
}

// Extensão a partir do mime, restrita aos formatos que o envio aceita.
export function extDoMime(mime: string | null | undefined): string {
  switch (mimeBase(mime)) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "application/pdf":
      return "pdf";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/amr":
      return "amr";
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    default:
      return "bin";
  }
}

// Caminho do objeto no bucket para a mídia ENVIADA. Fica sob "saida/", separado
// da mídia recebida (indexada pelo media_id da Meta), porque é o prefixo que o
// operador tem permissão de escrever pelo navegador.
export function caminhoMidiaSaida(
  id: string,
  mime: string | null | undefined,
  now: Date = new Date(),
): string {
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `saida/${ano}/${mes}/${id}.${extDoMime(mime)}`;
}

// Payload do endpoint /messages para mídia já carregada na Meta (media id).
// Diferenças que a API impõe entre os tipos: áudio não aceita legenda, e só
// documento carrega o nome do arquivo (é o que o destinatário vê no card).
export function montarPayloadMidia(input: {
  to: string;
  tipo: MediaEnvioTipo;
  mediaId: string;
  caption?: string | null;
  filename?: string | null;
}): Record<string, unknown> {
  const legenda = (input.caption ?? "").trim();
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: input.tipo,
  };

  if (input.tipo === "audio") {
    return { ...base, audio: { id: input.mediaId } };
  }
  if (input.tipo === "image") {
    return {
      ...base,
      image: legenda ? { id: input.mediaId, caption: legenda } : { id: input.mediaId },
    };
  }
  const doc: Record<string, unknown> = { id: input.mediaId };
  const nome = (input.filename ?? "").trim();
  if (nome) doc.filename = nome;
  if (legenda) doc.caption = legenda;
  return { ...base, document: doc };
}

// Prévia da conversa na lista lateral, no mesmo padrão já usado para a mídia
// recebida. Legenda, quando existe, ganha do rótulo.
export function previewMidia(
  tipo: MediaEnvioTipo,
  filename: string | null,
  caption?: string | null,
): string {
  const legenda = (caption ?? "").trim();
  if (legenda) return legenda;
  if (tipo === "image") return "📷 Imagem";
  if (tipo === "audio") return "🎤 Áudio";
  return `📄 ${(filename ?? "").trim() || "Documento"}`;
}

// ─── Janela de atendimento de 24h ────────────────────────────────────────────
// Fora dela a Meta não entrega texto livre nem mídia (só template aprovado). A
// contagem vale da ÚLTIMA mensagem recebida do responsável, não da última
// mensagem da conversa.

export const JANELA_ATENDIMENTO_MS = 24 * 60 * 60 * 1000;

export type MensagemDirecionada = MensagemComData & { direction: "in" | "out" };

export type EstadoJanela =
  | { estado: "aberta"; expiraEm: Date }
  // Nenhuma mensagem recebida: não há janela aberta, mas também não há como
  // afirmar que fechou (conversa criada por cobrança, histórico incompleto).
  | { estado: "indeterminada" }
  | { estado: "fechada"; ultimaEntrada: Date };

export function estadoJanela24h(
  mensagens: MensagemDirecionada[],
  agora: Date = new Date(),
): EstadoJanela {
  let ultima: number | null = null;
  for (const m of mensagens) {
    if (m.direction !== "in") continue;
    const t = new Date(instanteDaMensagem(m)).getTime();
    if (Number.isNaN(t)) continue;
    if (ultima === null || t > ultima) ultima = t;
  }
  if (ultima === null) return { estado: "indeterminada" };
  const limite = ultima + JANELA_ATENDIMENTO_MS;
  if (limite > agora.getTime()) return { estado: "aberta", expiraEm: new Date(limite) };
  return { estado: "fechada", ultimaEntrada: new Date(ultima) };
}
