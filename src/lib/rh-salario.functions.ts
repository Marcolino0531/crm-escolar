// Salário base por funcionário × competência — servidor.
// Acesso só pelo módulo dedicado 'rh_salario' (editar 'rh' não basta).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { competenciaValida, type SalarioRegistro } from "@/lib/rh-salario";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";
import {
  conferirLoteComFolha,
  exigirSalarioManual,
  exigirUnidadeFolha,
} from "@/lib/rh-folha.functions";
import { selectAll } from "@/lib/supabase-paginate";

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
  await exigirPermissaoPagina(
    userId,
    edicao ? ["rh.pagamentos.salario"] : ["rh.pagamentos.salario"],
    edicao ? "editar" : "ver",
    edicao
      ? "Você não tem permissão para cadastrar ou editar salários."
      : "Você não tem permissão para ver salários.",
  );
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

// Todos os salários dos funcionários da unidade do seletor global.
export const listarSalarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ schoolId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SalarioRegistro[]> => {
    await exigirPermissaoSalario(context.userId, false);
    await exigirUnidadeFolha(context.userId, data.schoolId);
    const rows = await selectAll<SalarioRow>(() =>
      supabaseAdmin
        .from("funcionarios_salarios" as never)
        .select(
          "id, funcionario_id, competencia, valor, valor_liquido, observacao, created_at, created_by_nome, funcionarios!inner(school_id)",
        )
        .eq("funcionarios.school_id", data.schoolId)
        .order("competencia", { ascending: false })
        .order("id"),
    );
    return rows.map(paraRegistro);
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
    await exigirSalarioManual(context.userId, data.funcionarioId, data.competencia);
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
    const { data: reg, error: rErr } = await supabaseAdmin
      .from("funcionarios_salarios" as never)
      .select("funcionario_id, competencia")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    const alvo = reg as { funcionario_id: string; competencia: string } | null;
    if (!alvo) throw new Error("Registro não encontrado.");
    await exigirSalarioManual(context.userId, alvo.funcionario_id, alvo.competencia);
    const { error } = await supabaseAdmin
      .from("funcionarios_salarios" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Salva um lote de pagamento de Salário (hr_transport_batches, tipo='salario')
// com um item por funcionário. Os itens já vêm montados pela lógica pura
// (montarFolhaSalario) a partir do salário vigente na competência.
export const salvarFolhaSalario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        schoolId: z.string().uuid(),
        titulo: z.string().trim().min(1).max(200),
        competencia: z.string(),
        dataPagamento: z.string().nullable().optional(),
        itens: z
          .array(
            z.object({
              employee_id: z.string().uuid(),
              employee_name: z.string(),
              total_amount: z.number().positive(),
            }),
          )
          .min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await exigirPermissaoSalario(context.userId, true);
    if (!competenciaValida(data.competencia)) throw new Error("Competência inválida (AAAA-MM).");
    await exigirUnidadeFolha(context.userId, data.schoolId);
    await conferirLoteComFolha(data.schoolId, data.competencia, data.itens);
    const total = Math.round(data.itens.reduce((acc, i) => acc + i.total_amount, 0) * 100) / 100;
    const { data: batch, error: bErr } = await supabaseAdmin
      .from("hr_transport_batches" as never)
      .insert({
        school_id: data.schoolId,
        tipo: "salario",
        title: data.titulo,
        payment_date: data.dataPagamento || null,
        reference_month: data.competencia,
        total_amount: total,
      } as never)
      .select("id")
      .single();
    if (bErr || !batch) throw new Error(bErr?.message ?? "Falha ao salvar a folha.");
    const batchId = (batch as { id: string }).id;
    const { error: iErr } = await supabaseAdmin.from("hr_transport_batch_items" as never).insert(
      data.itens.map((i) => ({
        batch_id: batchId,
        employee_id: i.employee_id,
        employee_name: i.employee_name,
        total_amount: Math.round(i.total_amount * 100) / 100,
      })) as never,
    );
    if (iErr) {
      await supabaseAdmin
        .from("hr_transport_batches" as never)
        .delete()
        .eq("id", batchId);
      throw new Error(iErr.message);
    }
    return { id: batchId };
  });
