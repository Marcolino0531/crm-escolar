// Espelha os disparos de template (Cobrança Automática) no histórico do chat de
// Atendimento. Ao enviar um template com sucesso, o sistema grava a mensagem em
// `whatsapp_messages` (direção "out", origem "cobranca") vinculada à conversa do
// telefone — criando a conversa se ainda não existir — para que o atendente veja
// a cobrança no mesmo fio da conversa. O status (entregue/lido) continua sendo
// atualizado pelo webhook via `wa_message_id`.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { onlyDigits } from "@/lib/phone";
import { escolherConversaDoNumero, grupoDaUnidade, type NumeroGrupo } from "@/lib/whatsapp-numeros";
import { getNumerosPublicos, getWhatsAppSendConfigDoGrupo } from "@/lib/whatsapp.server";

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

export interface ConversaMatch {
  id: string;
  aluno_id: string | null;
  aluno_name: string;
  // Número da escola por onde a conversa é atendida (null em conversas antigas).
  phone_number_id: string | null;
  numero_grupo: string | null;
  unidade: string | null;
}

// Localiza a conversa de um telefone tolerando o 9º dígito e o DDI que a Meta
// omite no wa_id (ex.: dispara "5531993034128" mas o wa_id chega "553193034128"):
// casa pelos últimos 8 dígitos, a MESMA regra do cruzamento telefone→aluno. Assim
// o disparo e o webhook convergem para uma única conversa (evita duplicatas).
export async function findConversaBySuffix(
  waPhone: string,
  phoneNumberId?: string | null,
): Promise<ConversaMatch | null> {
  const suffix = waPhone.slice(-8);
  if (suffix.length < 8) return null;
  const { data } = await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .select("id, aluno_id, aluno_name, phone_number_id, numero_grupo, unidade")
    .ilike("wa_phone", `%${suffix}%`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(10);
  const candidatas = (data ?? []) as unknown as ConversaMatch[];
  return escolherConversaDoNumero(candidatas, phoneNumberId, getNumerosPublicos());
}

// Garante a conversa do telefone com os dados do aluno já conhecidos no disparo;
// completa o vínculo se a conversa existir sem aluno associado.
async function garantirConversa(waPhone: string, v: VinculoAluno): Promise<string | null> {
  // O disparo sai pelo número da unidade do aluno, então a conversa espelhada
  // nasce (ou é reaproveitada) já amarrada a esse número.
  const grupo: NumeroGrupo | null = grupoDaUnidade(v.unidade);
  const phoneNumberId = grupo ? (getWhatsAppSendConfigDoGrupo(grupo)?.phoneNumberId ?? null) : null;
  const atual = await findConversaBySuffix(waPhone, phoneNumberId);

  if (atual) {
    const patch: Record<string, string | null> = {};
    if (!atual.aluno_id && v.aluno_id) {
      patch.aluno_id = v.aluno_id;
      patch.aluno_name = v.aluno_name;
      patch.responsavel_name = v.responsavel_name;
      patch.unidade = v.unidade;
    }
    if (phoneNumberId && !atual.phone_number_id) {
      patch.phone_number_id = phoneNumberId;
      patch.numero_grupo = grupo;
    }
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin
        .from("whatsapp_conversations" as never)
        .update(patch as never)
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
      phone_number_id: phoneNumberId,
      numero_grupo: grupo,
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
