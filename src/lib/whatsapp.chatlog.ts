// Espelha os disparos de template (Cobrança Automática) no histórico do chat de
// Atendimento. Ao enviar um template com sucesso, o sistema grava a mensagem em
// `whatsapp_messages` (direção "out", origem "cobranca") vinculada à conversa do
// telefone — criando a conversa se ainda não existir — para que o atendente veja
// a cobrança no mesmo fio da conversa. O status (entregue/lido) continua sendo
// atualizado pelo webhook via `wa_message_id`.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { onlyDigits } from "@/lib/phone";

export interface VinculoAluno {
  aluno_id: string | null;
  aluno_name: string;
  responsavel_name: string;
  unidade: string;
}

export interface RegistrarTemplateParams {
  telefone: string;
  waMessageId: string;
  body: string;
  vinculo: VinculoAluno;
}

// Garante a conversa do telefone com os dados do aluno já conhecidos no disparo;
// completa o vínculo se a conversa existir sem aluno associado.
async function garantirConversa(waPhone: string, v: VinculoAluno): Promise<string | null> {
  const { data: existente } = await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .select("id, aluno_id")
    .eq("wa_phone", waPhone)
    .maybeSingle();
  const atual = existente as unknown as { id: string; aluno_id: string | null } | null;

  if (atual) {
    if (!atual.aluno_id && v.aluno_id) {
      await supabaseAdmin
        .from("whatsapp_conversations" as never)
        .update({
          aluno_id: v.aluno_id,
          aluno_name: v.aluno_name,
          responsavel_name: v.responsavel_name,
          unidade: v.unidade,
        } as never)
        .eq("id", atual.id);
    }
    return atual.id;
  }

  const { data: criada, error } = await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .insert({
      wa_phone: waPhone,
      contact_name: v.responsavel_name || "",
      aluno_id: v.aluno_id,
      aluno_name: v.aluno_name,
      responsavel_name: v.responsavel_name,
      unidade: v.unidade,
    } as never)
    .select("id")
    .single();
  if (error || !criada) {
    console.warn("[whatsapp] criar conversa (cobrança) falhou:", error?.message);
    return null;
  }
  return (criada as unknown as { id: string }).id;
}

// Registra o template disparado como mensagem "out" automática no chat. Idempotente
// por `wa_message_id`. Nunca lança: falhas de espelhamento não devem quebrar o disparo.
export async function registrarTemplateNoChat(params: RegistrarTemplateParams): Promise<void> {
  try {
    const waPhone = onlyDigits(params.telefone);
    if (!waPhone || !params.waMessageId) return;

    const conversaId = await garantirConversa(waPhone, params.vinculo);
    if (!conversaId) return;

    const { data: jaExiste } = await supabaseAdmin
      .from("whatsapp_messages" as never)
      .select("id")
      .eq("wa_message_id", params.waMessageId)
      .maybeSingle();
    if (jaExiste) return;

    const nowIso = new Date().toISOString();
    await supabaseAdmin.from("whatsapp_messages" as never).insert({
      conversation_id: conversaId,
      wa_message_id: params.waMessageId,
      direction: "out",
      body: params.body,
      status: "enviado",
      origem: "cobranca",
      wa_timestamp: nowIso,
    } as never);

    await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .update({
        last_message_at: nowIso,
        last_message_preview: params.body.slice(0, 200),
        last_message_direction: "out",
      } as never)
      .eq("id", conversaId);
  } catch (e) {
    console.warn(
      "[whatsapp] espelhar template no chat falhou:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
