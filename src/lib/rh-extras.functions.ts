// RH > Pessoal > Extras — servidor. Página rh.pessoal.extras da árvore;
// colégio conferido pelo acesso do usuário (exigirUnidadeFolha).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";
import { exigirUnidadeFolha } from "@/lib/rh-folha.functions";
import {
  chaveNomeExtra,
  MENSAGEM_EXTRA_DUPLICADO,
  nomeExtraNormalizado,
  type Extra,
} from "@/lib/rh-extras";

type ExtraRow = {
  id: string;
  school_id: string;
  nome_completo: string;
  ativo: boolean;
  criado_em: string;
  criado_por_nome: string | null;
};

const COLS = "id, school_id, nome_completo, ativo, criado_em, criado_por_nome";

async function exigirPermissaoExtras(userId: string, edicao: boolean): Promise<void> {
  await exigirPermissaoPagina(
    userId,
    ["rh.pessoal.extras"],
    edicao ? "editar" : "ver",
    edicao
      ? "Você não tem permissão para cadastrar ou editar Extras."
      : "Você não tem permissão para ver os Extras.",
  );
}

const paraExtra = (r: ExtraRow): Extra => ({
  id: r.id,
  nomeCompleto: r.nome_completo,
  ativo: r.ativo,
  criadoEm: r.criado_em,
  criadoPor: r.criado_por_nome ?? "",
});

const nomeSchema = z.string().trim().min(1, "Informe o nome completo.").max(200);

async function extraDoId(id: string): Promise<ExtraRow> {
  const { data, error } = await supabaseAdmin
    .from("rh_extras" as never)
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as ExtraRow | null;
  if (!row || !row.ativo) throw new Error("Extra não encontrado.");
  return row;
}

async function exigirNomeLivre(schoolId: string, nome: string, ignorarId?: string): Promise<void> {
  let q = supabaseAdmin
    .from("rh_extras" as never)
    .select("id")
    .eq("school_id", schoolId)
    .eq("ativo", true)
    .eq("nome_chave", chaveNomeExtra(nome));
  if (ignorarId) q = q.neq("id", ignorarId);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  if ((data as unknown[] | null)?.length) throw new Error(MENSAGEM_EXTRA_DUPLICADO);
}

// Violação do índice único (corrida entre dois cadastros): mesma mensagem.
const erroGravacao = (e: { code?: string; message: string }) =>
  new Error(e.code === "23505" ? MENSAGEM_EXTRA_DUPLICADO : e.message);

// Extras ATIVOS do colégio do seletor global.
export const listarExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ schoolId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Extra[]> => {
    await exigirPermissaoExtras(context.userId, false);
    await exigirUnidadeFolha(context.userId, data.schoolId);
    const { data: rows, error } = await supabaseAdmin
      .from("rh_extras" as never)
      .select(COLS)
      .eq("school_id", data.schoolId)
      .eq("ativo", true)
      .order("nome_completo");
    if (error) throw new Error(error.message);
    return ((rows ?? []) as ExtraRow[]).map(paraExtra);
  });

export const criarExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ schoolId: z.string().uuid(), nomeCompleto: nomeSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await exigirPermissaoExtras(context.userId, true);
    await exigirUnidadeFolha(context.userId, data.schoolId);
    const nome = nomeExtraNormalizado(data.nomeCompleto);
    await exigirNomeLivre(data.schoolId, nome);
    const { data: row, error } = await supabaseAdmin
      .from("rh_extras" as never)
      .insert({
        school_id: data.schoolId,
        nome_completo: nome,
        nome_chave: chaveNomeExtra(nome),
        ativo: true,
        criado_por: context.userId,
        criado_por_nome: await nomeDoUsuario(context.userId),
      } as never)
      .select("id")
      .single();
    if (error || !row) throw erroGravacao(error ?? { message: "Falha ao salvar o Extra." });
    return { id: (row as { id: string }).id };
  });

export const editarExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), nomeCompleto: nomeSchema }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoExtras(context.userId, true);
    const atual = await extraDoId(data.id);
    await exigirUnidadeFolha(context.userId, atual.school_id);
    const nome = nomeExtraNormalizado(data.nomeCompleto);
    await exigirNomeLivre(atual.school_id, nome, atual.id);
    const { error } = await supabaseAdmin
      .from("rh_extras" as never)
      .update({
        nome_completo: nome,
        nome_chave: chaveNomeExtra(nome),
        atualizado_em: new Date().toISOString(),
        atualizado_por: context.userId,
        atualizado_por_nome: await nomeDoUsuario(context.userId),
      } as never)
      .eq("id", atual.id);
    if (error) throw erroGravacao(error);
    return { ok: true };
  });

// "Remover" inativa (não apaga): os valores já lançados ficam guardados.
export const removerExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoExtras(context.userId, true);
    const atual = await extraDoId(data.id);
    await exigirUnidadeFolha(context.userId, atual.school_id);
    const { error } = await supabaseAdmin
      .from("rh_extras" as never)
      .update({
        ativo: false,
        inativado_em: new Date().toISOString(),
        inativado_por: context.userId,
        inativado_por_nome: await nomeDoUsuario(context.userId),
      } as never)
      .eq("id", atual.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
