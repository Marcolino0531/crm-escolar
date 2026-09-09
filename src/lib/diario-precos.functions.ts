// Tabela de Preços dos Extras do Diário — servidor.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import {
  CATEGORIAS_EXTRA,
  isCategoriaExtra,
  type CategoriaExtra,
  type PrecoExtra,
  type TabelaPrecos,
} from "@/lib/diario-precos";
import { ANO_LETIVO_MAX, ANO_LETIVO_MIN, anoLetivoValido } from "@/lib/rematricula";

type PrecoRow = {
  unidade: string;
  categoria: string;
  ano_letivo: number;
  valor: number | string;
  updated_at: string;
  updated_by_nome: string | null;
};

async function exigirPermissaoDiario(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "diario" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para editar a Tabela de Preços do Diário."
        : "Você não tem permissão para ver a Tabela de Preços do Diário.",
    );
  }
}

function paraPreco(r: PrecoRow): PrecoExtra | null {
  if (!isCategoriaExtra(r.categoria)) return null;
  return {
    unidade: r.unidade,
    categoria: r.categoria,
    anoLetivo: Number(r.ano_letivo),
    valor: Number(r.valor),
    atualizadoEm: r.updated_at,
    atualizadoPor: r.updated_by_nome ?? "",
  };
}

// Preços de uma unidade/ano indexados por categoria (usado pelo faturamento).
export async function precosExtrasDoAno(unidade: string, anoLetivo: number): Promise<TabelaPrecos> {
  const { data, error } = await supabaseAdmin
    .from("diario_precos_extras" as never)
    .select("unidade, categoria, ano_letivo, valor, updated_at, updated_by_nome")
    .eq("unidade", unidade)
    .eq("ano_letivo", anoLetivo)
    .returns<PrecoRow[]>();
  if (error) throw new Error(error.message);
  const tabela: TabelaPrecos = {};
  for (const r of data ?? []) {
    const p = paraPreco(r);
    if (p) tabela[p.categoria] = p.valor;
  }
  return tabela;
}

export const listarPrecosExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ unidade: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<PrecoExtra[]> => {
    await exigirPermissaoDiario(context.userId, false);
    const { data: rows, error } = await supabaseAdmin
      .from("diario_precos_extras" as never)
      .select("unidade, categoria, ano_letivo, valor, updated_at, updated_by_nome")
      .eq("unidade", data.unidade)
      .order("ano_letivo", { ascending: false })
      .returns<PrecoRow[]>();
    if (error) throw new Error(error.message);
    return (rows ?? []).map(paraPreco).filter((p): p is PrecoExtra => p !== null);
  });

export const salvarPrecoExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        unidade: z.string().min(1),
        categoria: z.enum(CATEGORIAS_EXTRA as [CategoriaExtra, ...CategoriaExtra[]]),
        anoLetivo: z.number().int(),
        valor: z.number(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoDiario(context.userId, true);
    if (!anoLetivoValido(data.anoLetivo)) {
      throw new Error(`Informe um ano entre ${ANO_LETIVO_MIN} e ${ANO_LETIVO_MAX}.`);
    }
    if (!Number.isFinite(data.valor) || data.valor < 0) {
      throw new Error("Informe um valor maior ou igual a zero.");
    }
    const { error } = await supabaseAdmin.from("diario_precos_extras" as never).upsert(
      {
        unidade: data.unidade,
        categoria: data.categoria,
        ano_letivo: data.anoLetivo,
        valor: Math.round(data.valor * 100) / 100,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: await nomeDoUsuario(context.userId),
      } as never,
      { onConflict: "unidade,categoria,ano_letivo" } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
