// Utilidades server-side compartilhadas pelo assistente de IA do Atendimento
// (sugestões e biblioteca de exemplos de treinamento).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MensagemContexto } from "@/lib/atendimento-ia";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";

// Formato das mensagens lidas de whatsapp_messages para virar contexto da IA.
export type MensagemBanco = {
  direction: "in" | "out";
  body: string;
  message_type: MensagemContexto["tipo"];
  origem: "chat" | "cobranca";
};

// A IA tem permissão própria (Assistente de IA) porque manda histórico
// e dados financeiros a um serviço externo pago: nunca cair na permissão geral do
// Atendimento.
export async function assertPermissaoIA(userId: string, edicao: boolean, acao: string) {
  await exigirPermissaoPagina(
    userId,
    ["assistente_ia.instrucoes", "assistente_ia.exemplos"],
    edicao ? "editar" : "ver",
    `Você não tem permissão para ${acao}.`,
  );
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
