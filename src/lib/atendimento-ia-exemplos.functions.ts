// Server functions da biblioteca de exemplos de treinamento (few-shot).
//
// Salvar um exemplo é sempre ação explícita do operador: nenhuma destas funções
// envia mensagem, e nenhuma cria exemplo sozinha a partir de um envio.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { montarRegistroExemplo, type ExemploTreinamento } from "@/lib/atendimento-ia-exemplos";
import { assertPermissaoIA, nomeDoUsuario, type MensagemBanco } from "@/lib/atendimento-ia.server";
import type { MensagemContexto } from "@/lib/atendimento-ia";

// Histórico usado só para classificar a situação e resumir o contexto do exemplo.
async function mensagensDaConversa(conversationId: string): Promise<MensagemContexto[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_messages" as never)
    .select("direction, body, message_type, origem")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  return ((data ?? []) as unknown as MensagemBanco[]).map((m) => ({
    direcao: m.direction,
    corpo: m.body ?? "",
    tipo: m.message_type ?? "text",
    automatica: m.origem === "cobranca",
  }));
}

const SalvarExemploInputSchema = z.object({
  conversationId: z.string().uuid(),
  // Ausente quando a resposta foi escrita do zero, sem sugestão da IA.
  suggestionId: z.string().uuid().nullable().optional(),
  respostaFinal: z.string().trim().min(1).max(4000),
});

export const salvarExemploTreinamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarExemploInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    await assertPermissaoIA(context.userId, true, "salvar exemplos de treinamento");

    const { data: convRow } = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .select("id, aluno_id, unidade")
      .eq("id", data.conversationId)
      .maybeSingle();
    const conversa = convRow as unknown as {
      id: string;
      aluno_id: string | null;
      unidade: string;
    } | null;
    if (!conversa) return { ok: false, error: "Conversa não encontrada." };

    let sugestaoOriginal = "";
    if (data.suggestionId) {
      const { data: sugRow } = await supabaseAdmin
        .from("ai_suggestions" as never)
        .select("sugestao")
        .eq("id", data.suggestionId)
        .maybeSingle();
      sugestaoOriginal = (sugRow as unknown as { sugestao: string } | null)?.sugestao ?? "";
    }

    const registro = montarRegistroExemplo({
      suggestionId: data.suggestionId ?? null,
      conversationId: conversa.id,
      alunoId: conversa.aluno_id,
      unidade: conversa.unidade,
      mensagens: await mensagensDaConversa(conversa.id),
      sugestaoOriginal,
      respostaFinal: data.respostaFinal,
      userId: context.userId,
      userNome: await nomeDoUsuario(context.userId),
    });

    const { data: inserido, error } = await supabaseAdmin
      .from("ai_training_examples" as never)
      .insert(registro as never)
      .select("id")
      .maybeSingle();
    if (error) {
      // Índice único por sugestão: clicar duas vezes não deve virar erro na tela.
      if (error.code === "23505") return { ok: true };
      return { ok: false, error: error.message };
    }

    return { ok: true, id: (inserido as unknown as { id: string } | null)?.id };
  });

const AtualizarExemploInputSchema = z.object({
  id: z.string().uuid(),
  contexto: z.string().trim().max(2000).optional(),
  respostaFinal: z.string().trim().min(1).max(4000).optional(),
  ativo: z.boolean().optional(),
});

export const atualizarExemploTreinamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AtualizarExemploInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    await assertPermissaoIA(context.userId, true, "editar exemplos de treinamento");

    const patch: Record<string, string | boolean | null> = {
      atualizado_em: new Date().toISOString(),
      atualizado_por: context.userId,
    };
    if (data.contexto !== undefined) patch.contexto = data.contexto;
    if (data.respostaFinal !== undefined) patch.resposta_final = data.respostaFinal;
    if (data.ativo !== undefined) patch.ativo = data.ativo;

    const { error } = await supabaseAdmin
      .from("ai_training_examples" as never)
      .update(patch as never)
      .eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  });

const RemoverExemploInputSchema = z.object({ id: z.string().uuid() });

export const removerExemploTreinamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoverExemploInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    await assertPermissaoIA(context.userId, true, "remover exemplos de treinamento");

    const { error } = await supabaseAdmin
      .from("ai_training_examples" as never)
      .delete()
      .eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  });

// Exemplos ativos candidatos ao contexto da próxima sugestão. Lê um lote recente
// e a escolha final é feita em memória por `selecionarExemplos`.
export async function carregarExemplosAtivos(limite = 60): Promise<ExemploTreinamento[]> {
  const { data } = await supabaseAdmin
    .from("ai_training_examples" as never)
    .select("id, situacao, contexto, sugestao_original, resposta_final, ativo, criado_em")
    .eq("ativo", true)
    .order("criado_em", { ascending: false })
    .limit(limite);
  return (data ?? []) as unknown as ExemploTreinamento[];
}
