// Configurações > Cadastros Gerais > CNPJs Folha de Pagamento — servidor.
// CNPJs (empresas) aceitos na importação do Extrato Mensal de cada colégio,
// além do CNPJ do cadastro do colégio (documentos_colegios), que é fixo e
// somente leitura aqui. Vale SÓ para a Folha de Pagamento.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { somenteDigitos } from "@/lib/extrato-mensal";
import { cnpjValido, mesmoCnpj } from "@/lib/folha-pagamento";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";
import { empresaDoColegio, exigirUnidadeFolha } from "@/lib/rh-folha.functions";

export type CnpjFolha = {
  /** null na linha do CNPJ do cadastro do colégio (fixa, somente leitura). */
  id: string | null;
  cnpj: string;
  empresa: string;
  observacao: string;
  principal: boolean;
  incluidoEm: string | null;
  incluidoPorNome: string;
  editadoEm: string | null;
  editadoPorNome: string | null;
};

type Row = {
  id: string;
  cnpj: string;
  empresa: string;
  observacao: string;
  criado_em: string;
  criado_por_nome: string;
  atualizado_em: string | null;
  atualizado_por_nome: string | null;
};

const COLS =
  "id, cnpj, empresa, observacao, criado_em, criado_por_nome, atualizado_em, atualizado_por_nome";

async function contexto(userId: string, schoolId: string, edicao: boolean): Promise<string> {
  await exigirPermissaoPagina(
    userId,
    ["configuracoes.cadastros.cnpjs_folha"],
    edicao ? "editar" : "ver",
    edicao
      ? "Você não tem permissão para editar os CNPJs da Folha de Pagamento."
      : "Você não tem permissão para ver os CNPJs da Folha de Pagamento.",
  );
  return exigirUnidadeFolha(userId, schoolId);
}

async function adicionaisDa(schoolId: string): Promise<Row[]> {
  // leitura-restrita: configuração: CNPJs por colégio
  const { data, error } = await supabaseAdmin
    .from("rh_folha_cnpjs" as never)
    .select(COLS)
    .eq("school_id", schoolId)
    .order("criado_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

const schoolInput = z.object({ schoolId: z.string().uuid() });

export const listarCnpjsFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schoolInput.parse(input))
  .handler(async ({ data, context }): Promise<CnpjFolha[]> => {
    const unidade = await contexto(context.userId, data.schoolId, false);
    const principal = await empresaDoColegio(unidade);
    return [
      {
        id: null,
        cnpj: principal.cnpj,
        empresa: principal.razaoSocial || unidade,
        observacao: "CNPJ do cadastro do colégio (Configurações > Colégios).",
        principal: true,
        incluidoEm: null,
        incluidoPorNome: "",
        editadoEm: null,
        editadoPorNome: null,
      },
      ...(await adicionaisDa(data.schoolId)).map((r) => ({
        id: r.id,
        cnpj: r.cnpj,
        empresa: r.empresa,
        observacao: r.observacao,
        principal: false,
        incluidoEm: r.criado_em,
        incluidoPorNome: r.criado_por_nome,
        editadoEm: r.atualizado_em,
        editadoPorNome: r.atualizado_por_nome,
      })),
    ];
  });

export const salvarCnpjFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    schoolInput
      .extend({
        id: z.string().uuid().nullable(),
        cnpj: z.string().max(30),
        empresa: z.string().trim().min(1, "Informe o nome da empresa.").max(300),
        observacao: z.string().trim().max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const unidade = await contexto(context.userId, data.schoolId, true);
    const cnpj = somenteDigitos(data.cnpj);
    if (!cnpjValido(cnpj)) throw new Error("CNPJ inválido: confira os 14 dígitos.");
    const principal = await empresaDoColegio(unidade);
    if (mesmoCnpj(principal.cnpj, cnpj)) {
      throw new Error(`Este já é o CNPJ do cadastro de ${unidade}.`);
    }
    const existentes = await adicionaisDa(data.schoolId);
    if (existentes.some((r) => r.id !== data.id && mesmoCnpj(r.cnpj, cnpj))) {
      throw new Error(`O CNPJ já está cadastrado para ${unidade}.`);
    }
    const nome = await nomeDoUsuario(context.userId);
    if (data.id) {
      if (!existentes.some((r) => r.id === data.id)) {
        throw new Error("Cadastro não pertence a esta unidade.");
      }
      const { error } = await supabaseAdmin
        .from("rh_folha_cnpjs" as never)
        .update({
          cnpj,
          empresa: data.empresa,
          observacao: data.observacao,
          atualizado_em: new Date().toISOString(),
          atualizado_por: context.userId,
          atualizado_por_nome: nome,
        } as never)
        .eq("id", data.id)
        .eq("school_id", data.schoolId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("rh_folha_cnpjs" as never).insert({
        school_id: data.schoolId,
        cnpj,
        empresa: data.empresa,
        observacao: data.observacao,
        criado_por: context.userId,
        criado_por_nome: nome,
      } as never);
      if (error) {
        if (error.code === "23505") throw new Error(`O CNPJ já está cadastrado para ${unidade}.`);
        throw new Error(error.message);
      }
    }
    return { ok: true };
  });

/** Excluir impede novas importações deste CNPJ; as importações já feitas não mudam. */
export const excluirCnpjFolha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schoolInput.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await contexto(context.userId, data.schoolId, true);
    const { error } = await supabaseAdmin
      .from("rh_folha_cnpjs" as never)
      .delete()
      .eq("id", data.id)
      .eq("school_id", data.schoolId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
