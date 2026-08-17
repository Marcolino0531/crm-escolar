// Cliente da WhatsApp Cloud API (API Oficial da Meta) — uso server-side apenas.
//
// Envia mensagens usando um "Message Template" pré-aprovado, passando as
// variáveis dinâmicas na ordem do corpo do template:
//   {{1}} Nome do Responsável · {{2}} Nome do Aluno · {{3}} Valor · {{4}} Vencimento
//
// Configuração por env (nunca commitar segredos):
//   WHATSAPP_TOKEN            — token de acesso permanente do app da Meta
//   WHATSAPP_PHONE_NUMBER_ID  — ID do número remetente (Phone Number ID)
//   WHATSAPP_TEMPLATE_NAME    — nome do template aprovado (ex.: "cobranca_lembrete")
//   WHATSAPP_TEMPLATE_LANG    — código de idioma do template (default "pt_BR")
//   WHATSAPP_GRAPH_VERSION    — versão do Graph API (default "v21.0")

import { onlyDigits } from "@/lib/phone";

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  templateName: string;
  // Template para responsáveis com MÚLTIPLOS boletos em aberto (mês vigente +
  // meses anteriores). Configurável por env; default "aviso_cobranca_multipla".
  templateMultiplaName: string;
  // Template PREVENTIVO (lembrete antes do vencimento). Configurável por env;
  // default "lembrete_vencimento_boleto".
  templateLembreteName: string;
  templateLang: string;
  graphVersion: string;
}

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!token || !phoneNumberId || !templateName) return null;
  return {
    token,
    phoneNumberId,
    templateName,
    templateMultiplaName: process.env.WHATSAPP_TEMPLATE_MULTIPLA_NAME || "aviso_cobranca_multipla",
    templateLembreteName:
      process.env.WHATSAPP_TEMPLATE_LEMBRETE_NAME || "lembrete_vencimento_boleto",
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v21.0",
  };
}

// Config mínima para ENVIAR mensagens de texto livre (chat de atendimento):
// não depende de template aprovado, apenas do token + Phone Number ID.
export interface WhatsAppSendConfig {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
}

export function getWhatsAppSendConfig(): WhatsAppSendConfig | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v21.0",
  };
}

// Envia uma mensagem de TEXTO LIVRE pelo endpoint padrão da Cloud API. Só
// funciona dentro da janela de atendimento de 24h (após uma mensagem do
// contato); fora dela a Meta exige template. Lança em caso de erro.
export async function sendTextMessage(
  cfg: WhatsAppSendConfig,
  to: string,
  body: string,
): Promise<SendResult> {
  const dest = toMetaPhone(to);
  if (!dest) throw new Error("Telefone do destinatário ausente ou inválido.");
  const text = body.trim();
  if (!text) throw new Error("Mensagem vazia.");

  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: dest,
    type: "text",
    text: { preview_url: false, body: text },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const respBody = (await resp.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  } | null;

  if (!resp.ok || !respBody?.messages?.[0]?.id) {
    const detail =
      respBody?.error?.error_data?.details ||
      respBody?.error?.message ||
      `HTTP ${resp.status} ao chamar a WhatsApp Cloud API.`;
    throw new Error(detail);
  }

  return { messageId: respBody.messages[0].id };
}

// ─── Envio de mídia (imagem, PDF e áudio) ────────────────────────────────────
// Fluxo em duas etapas, como a Meta exige: (1) sobe o binário para
// /{phone-number-id}/media e recebe um media id; (2) envia a mensagem referindo
// esse id. Enviar por `link` exigiria expor o arquivo publicamente, então o
// upload é sempre pelo id.

// Passo 1: sobe o arquivo e devolve o media id da Meta.
export async function uploadMediaToMeta(
  cfg: WhatsAppSendConfig,
  file: { bytes: Uint8Array; mime: string; filename: string },
): Promise<string> {
  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mime);
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.filename);

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: form,
  });

  const body = (await resp.json().catch(() => null)) as {
    id?: string;
    error?: { message?: string; error_data?: { details?: string } };
  } | null;

  if (!resp.ok || !body?.id) {
    const detail =
      body?.error?.error_data?.details ||
      body?.error?.message ||
      `HTTP ${resp.status} ao subir a mídia para a WhatsApp Cloud API.`;
    throw new Error(detail);
  }
  return body.id;
}

// Passo 2: envia a mensagem de mídia. O payload já vem montado (por tipo) da
// lógica pura em whatsapp-send-media.ts. Lança em caso de erro, com o detalhe da
// Meta preservado (ex.: janela de 24h fechada, formato recusado).
export async function sendMediaMessage(
  cfg: WhatsAppSendConfig,
  payload: Record<string, unknown>,
): Promise<SendResult> {
  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await resp.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; error_data?: { details?: string } };
  } | null;

  if (!resp.ok || !body?.messages?.[0]?.id) {
    const detail =
      body?.error?.error_data?.details ||
      body?.error?.message ||
      `HTTP ${resp.status} ao chamar a WhatsApp Cloud API.`;
    throw new Error(detail);
  }
  return { messageId: body.messages[0].id };
}

// ─── Download de mídia recebida (imagens) ────────────────────────────────────
// Fluxo em duas etapas exigido pela Meta: (1) resolver o media_id para uma URL
// temporária no Graph API; (2) baixar o binário dessa URL (a URL expira em
// minutos, então o download precisa ocorrer no recebimento do webhook).

export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string | null;
}

// Passo 1: resolve o media_id para a URL temporária de download + mime.
export async function getMediaUrl(
  cfg: WhatsAppSendConfig,
  mediaId: string,
): Promise<{ url: string; mimeType: string | null }> {
  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${mediaId}`;
  const resp = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  const body = (await resp.json().catch(() => null)) as {
    url?: string;
    mime_type?: string;
    error?: { message?: string };
  } | null;
  if (!resp.ok || !body?.url) {
    throw new Error(
      body?.error?.message || `HTTP ${resp.status} ao resolver a mídia na Graph API.`,
    );
  }
  return { url: body.url, mimeType: body.mime_type ?? null };
}

// Passo 2: baixa o binário da URL temporária (também exige o Bearer token).
export async function downloadMedia(
  cfg: WhatsAppSendConfig,
  url: string,
): Promise<DownloadedMedia> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar a mídia.`);
  const mimeType = resp.headers.get("content-type");
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { bytes, mimeType };
}

// Normaliza para o formato exigido pela Meta: DDI (55) + DDD + número, só dígitos.
// A Meta espera E.164 sem o "+". Números brasileiros sem DDI recebem o 55.
export function toMetaPhone(v: string | null | undefined): string {
  const d = onlyDigits(v);
  if (!d) return "";
  return d.startsWith("55") ? d : `55${d}`;
}

export interface BillingTemplateVars {
  to: string;
  responsavel: string;
  aluno: string;
  valor: string; // já formatado (ex.: "R$ 350,00")
  vencimento: string; // já formatado (ex.: "10/07/2025")
  linhaDigitavel: string; // linha digitável do boleto ou fallback textual
}

export interface SendResult {
  messageId: string;
}

// Renderiza o TEXTO da mensagem de cobrança a partir das 5 variáveis, espelhando
// o corpo do template aprovado na Meta (Utility, pt_BR):
//   {{1}} Responsável · {{2}} Aluno · {{3}} Valor · {{4}} Vencimento · {{5}} Linha Digitável
// Usado para gravar o conteúdo exato enviado em `whatsapp_billing_logs.message_body`
// (registro fiel / prova de cobrança). Deve refletir o texto do template da Meta.
export function renderBillingMessage(vars: BillingTemplateVars): string {
  return (
    `Olá ${vars.responsavel}, identificamos que a mensalidade do(a) aluno(a) ${vars.aluno} ` +
    `no valor de ${vars.valor} venceu em ${vars.vencimento}. ` +
    `Para regularizar, utilize a linha digitável: ${vars.linhaDigitavel}. ` +
    `Caso o pagamento já tenha sido efetuado, desconsidere esta mensagem. Estamos à disposição.`
  );
}

function textParam(value: string) {
  // A Meta rejeita parâmetros vazios; usa um traço como fallback seguro.
  return { type: "text" as const, text: value && value.trim() ? value : "-" };
}

export interface BillingMultiplaVars {
  to: string;
  responsavel: string;
  aluno: string;
  mesesAnteriores: string; // ex.: "Agosto e Setembro"
  valorTotalAtualizado: string; // já formatado (ex.: "R$ 720,00")
  linhaDigitavel: string; // linha digitável APENAS do boleto do mês vigente
}

// Texto fiel do template de cobrança MÚLTIPLA (mês vigente + meses anteriores).
// Espelha o corpo do template "aviso_cobranca_multipla" (5 variáveis, nesta
// ordem): {{1}} Responsável · {{2}} Aluno · {{3}} Meses anteriores em aberto ·
// {{4}} Valor total atualizado · {{5}} Linha digitável do mês vigente.
export function renderBillingMessageMultipla(vars: BillingMultiplaVars): string {
  return (
    `Olá ${vars.responsavel}, identificamos mensalidades em aberto do(a) aluno(a) ${vars.aluno}, ` +
    `incluindo meses anteriores (${vars.mesesAnteriores}). ` +
    `O valor total atualizado da dívida é ${vars.valorTotalAtualizado}. ` +
    `Para regularizar o mês vigente, utilize a linha digitável: ${vars.linhaDigitavel}. ` +
    `Para os demais meses, entre em contato com a secretaria. ` +
    `Caso os pagamentos já tenham sido efetuados, desconsidere esta mensagem. Estamos à disposição.`
  );
}

export interface ReminderTemplateVars {
  to: string;
  responsavel: string;
  aluno: string;
  valor: string; // já formatado (ex.: "R$ 1.936,70")
  prazo: string; // "em 5 dias" | "em 3 dias" | "hoje"
  linhaDigitavel: string;
}

// Texto fiel do template PREVENTIVO "lembrete_vencimento_boleto" (Utilidade,
// pt_BR), aprovado pela Meta: {{1}} Responsável · {{2}} Aluno · {{3}} Valor ·
// {{4}} Prazo · {{5}} Linha digitável.
export function renderReminderMessage(vars: ReminderTemplateVars): string {
  return (
    `Olá ${vars.responsavel}, identificamos que a mensalidade do(a) aluno(a) ${vars.aluno} ` +
    `no valor de ${vars.valor} vence ${vars.prazo}. ` +
    `Utilize a linha digitável: ${vars.linhaDigitavel}. ` +
    `Descontos são válidos até a data de vencimento e calculados automaticamente pelo aplicativo ` +
    `do seu banco ao ler o código de barras ou digitar a linha digitável. ` +
    `Caso o pagamento já tenha sido efetuado, desconsidere esta mensagem. Estamos à disposição.`
  );
}

// Dispara o lembrete preventivo. Mesma mecânica do sendBillingTemplate, com as 5
// variáveis do template "lembrete_vencimento_boleto". Lança em caso de erro.
export async function sendReminderTemplate(
  cfg: WhatsAppConfig,
  vars: ReminderTemplateVars,
): Promise<SendResult> {
  const to = toMetaPhone(vars.to);
  if (!to) throw new Error("Telefone do responsável ausente ou inválido.");

  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: cfg.templateLembreteName,
      language: { code: cfg.templateLang },
      components: [
        {
          type: "body",
          parameters: [
            textParam(vars.responsavel),
            textParam(vars.aluno),
            textParam(vars.valor),
            textParam(vars.prazo),
            textParam(vars.linhaDigitavel),
          ],
        },
      ],
    },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await resp.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  } | null;

  if (!resp.ok || !body?.messages?.[0]?.id) {
    const detail =
      body?.error?.error_data?.details ||
      body?.error?.message ||
      `HTTP ${resp.status} ao chamar a WhatsApp Cloud API.`;
    throw new Error(detail);
  }

  return { messageId: body.messages[0].id };
}

// Dispara o template de cobrança MÚLTIPLA. Mesma mecânica do sendBillingTemplate,
// com as 5 variáveis do template "aviso_cobranca_multipla". Lança em caso de erro.
export async function sendBillingTemplateMultipla(
  cfg: WhatsAppConfig,
  vars: BillingMultiplaVars,
): Promise<SendResult> {
  const to = toMetaPhone(vars.to);
  if (!to) throw new Error("Telefone do responsável ausente ou inválido.");

  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: cfg.templateMultiplaName,
      language: { code: cfg.templateLang },
      components: [
        {
          type: "body",
          parameters: [
            textParam(vars.responsavel),
            textParam(vars.aluno),
            textParam(vars.mesesAnteriores),
            textParam(vars.valorTotalAtualizado),
            textParam(vars.linhaDigitavel),
          ],
        },
      ],
    },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await resp.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  } | null;

  if (!resp.ok || !body?.messages?.[0]?.id) {
    const detail =
      body?.error?.error_data?.details ||
      body?.error?.message ||
      `HTTP ${resp.status} ao chamar a WhatsApp Cloud API.`;
    throw new Error(detail);
  }

  return { messageId: body.messages[0].id };
}

// Dispara o template de cobrança. Lança em caso de erro da API (o chamador grava
// o log com status 'falha' e a mensagem de erro).
export async function sendBillingTemplate(
  cfg: WhatsAppConfig,
  vars: BillingTemplateVars,
): Promise<SendResult> {
  const to = toMetaPhone(vars.to);
  if (!to) throw new Error("Telefone do responsável ausente ou inválido.");

  const endpoint = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLang },
      components: [
        {
          type: "body",
          parameters: [
            textParam(vars.responsavel),
            textParam(vars.aluno),
            textParam(vars.valor),
            textParam(vars.vencimento),
            textParam(vars.linhaDigitavel),
          ],
        },
      ],
    },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await resp.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  } | null;

  if (!resp.ok || !body?.messages?.[0]?.id) {
    const detail =
      body?.error?.error_data?.details ||
      body?.error?.message ||
      `HTTP ${resp.status} ao chamar a WhatsApp Cloud API.`;
    throw new Error(detail);
  }

  return { messageId: body.messages[0].id };
}
