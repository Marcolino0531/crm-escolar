// Valor Biblioteca por unidade × ano letivo — servidor.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { valoresBibliotecaValidos, type BibliotecaValoresRegistro } from "@/lib/biblioteca";
import { ANO_LETIVO_MAX, ANO_LETIVO_MIN, anoLetivoValido } from "@/lib/rematricula";

type Row = {
  id: string;
  school_id: string;
  ano_letivo: number;
  multa_por_dia_util: number | string;
  multa_teto: number | string;
  prazo_padrao_dias: number;
  updated_at: string;
  updated_by_nome: string | null;
  schools: { name: string } | { name: string }[] | null;
};

const SELECT =
  "id, school_id, ano_letivo, multa_por_dia_util, multa_teto, prazo_padrao_dias, updated_at, updated_by_nome, schools(name)";

async function exigirPermissao(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "biblioteca" } as never,
  );
  if (error) throw new Error(error.message);
  if (data) return;
  throw new Error(
    edicao
      ? "Você não tem permissão para editar os valores da Biblioteca."
      : "Você não tem permissão para ver os valores da Biblioteca.",
  );
}

function paraRegistro(r: Row): BibliotecaValoresRegistro {
  const escola = Array.isArray(r.schools) ? r.schools[0] : r.schools;
  return {
    id: r.id,
    schoolId: r.school_id,
    unidade: escola?.name ?? "",
    anoLetivo: Number(r.ano_letivo),
    multaPorDiaUtil: Number(r.multa_por_dia_util),
    multaTeto: Number(r.multa_teto),
    prazoPadraoDias: Number(r.prazo_padrao_dias),
    atualizadoEm: r.updated_at,
    atualizadoPor: r.updated_by_nome ?? "",
  };
}

export const listarValoresBiblioteca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BibliotecaValoresRegistro[]> => {
    await exigirPermissao(context.userId, false);
    const { data, error } = await supabaseAdmin
      .from("biblioteca_valores" as never)
      .select(SELECT)
      .order("ano_letivo", { ascending: false })
      .returns<Row[]>();
    if (error) throw new Error(error.message);
    return (data ?? []).map(paraRegistro);
  });

const SalvarSchema = z.object({
  schoolId: z.string().uuid(),
  anoLetivo: z.number().int(),
  multaPorDiaUtil: z.number(),
  multaTeto: z.number(),
  prazoPadraoDias: z.number().int(),
});

export const salvarValoresBiblioteca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    if (!anoLetivoValido(data.anoLetivo)) {
      throw new Error(`Informe um ano entre ${ANO_LETIVO_MIN} e ${ANO_LETIVO_MAX}.`);
    }
    const erro = valoresBibliotecaValidos(data);
    if (erro) throw new Error(erro);
    const c = (n: number) => Math.round(n * 100) / 100;
    const { error } = await supabaseAdmin.from("biblioteca_valores" as never).upsert(
      {
        school_id: data.schoolId,
        ano_letivo: data.anoLetivo,
        multa_por_dia_util: c(data.multaPorDiaUtil),
        multa_teto: c(data.multaTeto),
        prazo_padrao_dias: data.prazoPadraoDias,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: await nomeDoUsuario(context.userId),
      } as never,
      { onConflict: "school_id,ano_letivo" } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirValoresBiblioteca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    const { error } = await supabaseAdmin
      .from("biblioteca_valores" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
