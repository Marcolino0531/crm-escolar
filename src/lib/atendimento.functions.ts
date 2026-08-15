// Server functions do módulo "Atendimento" (chat de WhatsApp).
//
// O envio de mensagens de texto livre usa o endpoint padrão da Cloud API (fora
// da janela de 24h a Meta exige template). Requer permissão de edição do módulo
// Atendimento e roda inteiramente no servidor (token nunca vai ao navegador).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getWhatsAppSendConfig,
  sendMediaMessage,
  sendTextMessage,
  toMetaPhone,
  uploadMediaToMeta,
} from "@/lib/whatsapp.server";
import { montarPayloadMidia, previewMidia, validarArquivoEnvio } from "@/lib/whatsapp-send-media";

// Bucket privado do storage, compartilhado com a mídia recebida no webhook.
const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

async function assertCanEditAtendimento(userId: string, acao: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "financeiro_atendimento" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Você não tem permissão para ${acao} no Atendimento.`);
}

const EnviarMensagemInputSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export interface EnviarMensagemResult {
  ok: boolean;
  waMessageId?: string;
  error?: string;
}

export const enviarMensagemChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EnviarMensagemInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnviarMensagemResult> => {
    await assertCanEditAtendimento(context.userId, "responder");

    const cfg = getWhatsAppSendConfig();
    if (!cfg) {
      return {
        ok: false,
        error:
          "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID).",
      };
    }

    const { data: conv } = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .select("id, wa_phone")
      .eq("id", data.conversationId)
      .maybeSingle();
    const conversa = conv as unknown as { id: string; wa_phone: string } | null;
    if (!conversa) return { ok: false, error: "Conversa não encontrada." };

    const nowIso = new Date().toISOString();

    let messageId: string;
    try {
      const res = await sendTextMessage(cfg, conversa.wa_phone, data.body);
      messageId = res.messageId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("whatsapp_messages" as never).insert({
        conversation_id: conversa.id,
        direction: "out",
        body: data.body,
        status: "falha",
        erro_mensagem: msg,
        wa_timestamp: nowIso,
        enviado_por: context.userId,
      } as never);
      return { ok: false, error: msg };
    }

    await supabaseAdmin.from("whatsapp_messages" as never).insert({
      conversation_id: conversa.id,
      wa_message_id: messageId,
      direction: "out",
      body: data.body,
      status: "enviado",
      wa_timestamp: nowIso,
      enviado_por: context.userId,
    } as never);

    await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .update({
        last_message_at: nowIso,
        last_message_preview: data.body.slice(0, 200),
        last_message_direction: "out",
        unread_count: 0,
      } as never)
      .eq("id", conversa.id);

    return { ok: true, waMessageId: messageId };
  });

// Mídia enviada pelo operador: o arquivo é subido do navegador direto para o
// bucket privado `whatsapp-media` (prefixo "saida/"), e aqui só chega o caminho
// do objeto. Isso evita trafegar o binário pela função serverless, que tem teto
// de corpo bem menor que o limite de mídia da Meta.
const EnviarMidiaInputSchema = z.object({
  conversationId: z.string().uuid(),
  storagePath: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^saida\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.[A-Za-z0-9]{1,8}$/, "Caminho de mídia inválido."),
  filename: z.string().trim().min(1).max(200),
  caption: z.string().trim().max(1000).optional(),
});

export interface EnviarMidiaResult {
  ok: boolean;
  waMessageId?: string;
  error?: string;
}

export const enviarMidiaChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EnviarMidiaInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnviarMidiaResult> => {
    await assertCanEditAtendimento(context.userId, "enviar arquivos");

    const cfg = getWhatsAppSendConfig();
    if (!cfg) {
      return {
        ok: false,
        error:
          "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID).",
      };
    }

    const { data: conv } = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .select("id, wa_phone")
      .eq("id", data.conversationId)
      .maybeSingle();
    const conversa = conv as unknown as { id: string; wa_phone: string } | null;
    if (!conversa) return { ok: false, error: "Conversa não encontrada." };
    if (!toMetaPhone(conversa.wa_phone)) {
      return { ok: false, error: "Telefone do responsável ausente ou inválido." };
    }

    const baixado = await supabaseAdmin.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .download(data.storagePath);
    if (baixado.error || !baixado.data) {
      return {
        ok: false,
        error: `Não foi possível ler o arquivo enviado: ${baixado.error?.message ?? "arquivo não encontrado"}.`,
      };
    }

    // Revalida tipo e tamanho sobre o arquivo que realmente chegou ao storage: o
    // mime declarado pelo navegador não é confiável.
    const validacao = validarArquivoEnvio({
      name: data.filename,
      type: baixado.data.type,
      size: baixado.data.size,
    });
    if (!validacao.ok) return { ok: false, error: validacao.erro };

    const bytes = new Uint8Array(await baixado.data.arrayBuffer());
    const nowIso = new Date().toISOString();
    const legenda = (data.caption ?? "").trim();

    const registrarFalha = async (msg: string) => {
      await supabaseAdmin.from("whatsapp_messages" as never).insert({
        conversation_id: conversa.id,
        direction: "out",
        body: legenda,
        status: "falha",
        erro_mensagem: msg,
        wa_timestamp: nowIso,
        enviado_por: context.userId,
        message_type: validacao.tipo,
        media_path: data.storagePath,
        media_mime: validacao.mime,
        media_filename: validacao.filename,
      } as never);
    };

    let messageId: string;
    let metaMediaId: string;
    try {
      metaMediaId = await uploadMediaToMeta(cfg, {
        bytes,
        mime: validacao.mime,
        filename: validacao.filename,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await registrarFalha(msg);
      return { ok: false, error: msg };
    }

    try {
      const res = await sendMediaMessage(
        cfg,
        montarPayloadMidia({
          to: toMetaPhone(conversa.wa_phone),
          tipo: validacao.tipo,
          mediaId: metaMediaId,
          caption: legenda,
          filename: validacao.filename,
        }),
      );
      messageId = res.messageId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await registrarFalha(msg);
      return { ok: false, error: msg };
    }

    await supabaseAdmin.from("whatsapp_messages" as never).insert({
      conversation_id: conversa.id,
      wa_message_id: messageId,
      direction: "out",
      body: legenda,
      status: "enviado",
      wa_timestamp: nowIso,
      enviado_por: context.userId,
      message_type: validacao.tipo,
      media_path: data.storagePath,
      media_mime: validacao.mime,
      media_id: metaMediaId,
      media_filename: validacao.filename,
    } as never);

    await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .update({
        last_message_at: nowIso,
        last_message_preview: previewMidia(validacao.tipo, validacao.filename, legenda).slice(
          0,
          200,
        ),
        last_message_direction: "out",
        unread_count: 0,
      } as never)
      .eq("id", conversa.id);

    return { ok: true, waMessageId: messageId };
  });

const ArquivarInputSchema = z.object({
  conversationIds: z.array(z.string().uuid()).min(1).max(500),
  archived: z.boolean(),
});

export interface ArquivarResult {
  ok: boolean;
  count: number;
  error?: string;
}

// Arquiva/desarquiva uma ou várias conversas de uma vez (ação em lote). Não
// apaga mensagens: só alterna o campo `archived` entre as abas Gerais/Arquivadas.
export const arquivarConversas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArquivarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ArquivarResult> => {
    await assertCanEditAtendimento(context.userId, "arquivar conversas");

    const { error } = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .update({ archived: data.archived } as never)
      .in("id", data.conversationIds);
    if (error) return { ok: false, count: 0, error: error.message };

    return { ok: true, count: data.conversationIds.length };
  });
