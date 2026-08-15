// Utilidades server-side compartilhadas pelo assistente de IA do Atendimento
// (sugestões e biblioteca de exemplos de treinamento).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MensagemContexto } from "@/lib/atendimento-ia";

// Formato das mensagens lidas de whatsapp_messages para virar contexto da IA.
export type MensagemBanco = {
  direction: "in" | "out";
  body: string;
  message_type: MensagemContexto["tipo"];
  origem: "chat" | "cobranca";
};

// A IA tem permissão própria (`financeiro_atendimento_ia`) porque manda histórico
// e dados financeiros a um serviço externo pago: nunca cair na permissão geral do
// Atendimento.
export async function assertPermissaoIA(userId: string, edicao: boolean, acao: string) {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "financeiro_atendimento_ia" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Você não tem permissão para ${acao}.`);
}

export async function nomeDoUsuario(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  return nome || (data?.user?.email ?? "");
}
