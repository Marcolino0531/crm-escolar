// Salário base por funcionário × competência — servidor.
// Acesso só pelo módulo dedicado 'rh_salario' (editar 'rh' não basta).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { competenciaValida, type SalarioRegistro } from "@/lib/rh-salario";

type SalarioRow = {
  id: string;
  funcionario_id: string;
  competencia: string;
  valor: number | string;
  valor_liquido: number | string | null;
  observacao: string | null;
  created_at: string;
  created_by_nome: string | null;
};

async function exigirPermissaoSalario(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "rh_salario" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para cadastrar ou editar salários."
        : "Você não tem permissão para ver salários.",
    );
  }
}

const paraRegistro = (r: SalarioRow): SalarioRegistro => ({
  id: r.id,
  funcionarioId: r.funcionario_id,
  competencia: r.competencia,
  valor: Number(r.valor),
  valorLiquido: r.valor_liquido == null ? null : Number(r.valor_liquido),
  observacao: r.observacao ?? "",
  criadoEm: r.created_at,
  criadoPor: r.created_by_nome ?? "",
});

// Todos os salários dos funcionários da unidade (ou de todas, se schoolId for null).
export const listarSalarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ schoolId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SalarioRegistro[]> => {
    await exigirPermissaoSalario(context.userId, false);
    let q = supabaseAdmin
      .from("funcionarios_salarios" as never)
      .select(
        "id, funcionario_id, competencia, valor, valor_liquido, observacao, created_at, created_by_nome, funcionarios!inner(school_id)",
      )
      .order("competencia", { ascending: false });
    if (data.schoolId) q = q.eq("funcionarios.school_id", data.schoolId);
    const { data: rows, error } = await q.returns<SalarioRow[]>();
    if (error) throw new Error(error.message);
    return (rows ?? []).map(paraRegistro);
  });

export const salvarSalario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        funcionarioId: z.string().uuid(),
        competencia: z.string(),
        valor: z.number(),
        valorLiquido: z.number().nullable().optional(),
        observacao: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoSalario(context.userId, true);
    if (!competenciaValida(data.competencia)) throw new Error("Competência inválida (AAAA-MM).");
    if (!Number.isFinite(data.valor) || data.valor < 0) {
      throw new Error("Informe um valor bruto maior ou igual a zero.");
    }
    const liquido = data.valorLiquido ?? null;
    if (liquido != null && (!Number.isFinite(liquido) || liquido < 0)) {
      throw new Error("Informe um valor líquido maior ou igual a zero.");
    }
    const { error } = await supabaseAdmin.from("funcionarios_salarios" as never).upsert(
      {
        funcionario_id: data.funcionarioId,
        competencia: data.competencia,
        valor: Math.round(data.valor * 100) / 100,
        valor_liquido: liquido == null ? null : Math.round(liquido * 100) / 100,
        observacao: data.observacao?.trim() || null,
        created_by: context.userId,
        created_by_nome: await nomeDoUsuario(context.userId),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "funcionario_id,competencia" } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirSalario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoSalario(context.userId, true);
    const { error } = await supabaseAdmin
      .from("funcionarios_salarios" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
