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
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR",
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v21.0",
  };
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
