// Server functions do módulo "Atendimento" (chat de WhatsApp).
//
// O envio de mensagens de texto livre usa o endpoint padrão da Cloud API (fora
// da janela de 24h a Meta exige template). Requer permissão de edição do módulo
// Cobrança e roda inteiramente no servidor (token nunca vai ao navegador).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWhatsAppSendConfig, sendTextMessage } from "@/lib/whatsapp.server";

async function assertCanEditCobranca(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "cobranca" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para responder no Atendimento.");
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
    await assertCanEditCobranca(context.userId);

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
