// Salário base por funcionário × competência — servidor.
// Acesso só pelo módulo dedicado 'rh_salario' (editar 'rh' não basta).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import {
  competenciaValida,
  conferirItensValorMensal,
  type SalarioRegistro,
  type TipoPessoaPagamento,
  type ValorMensalRegistro,
} from "@/lib/rh-salario";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";
import {
  conferirLoteComFolha,
  exigirSalarioManual,
  exigirUnidadeFolha,
} from "@/lib/rh-folha.functions";
import { selectAll } from "@/lib/supabase-paginate";
import { somaReais } from "@/lib/extrato-mensal";

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

// ── Terceirizados e Extras: valor mensal ────────────────────────────────────
// Mesma permissão do salário manual (rh.pagamentos.salario). Não usa valor do
// turno, grade nem faltas do terceirizado: o valor é o digitado.

type ValorMensalRow = {
  id: string;
  tipo: TipoPessoaPagamento;
  pessoa_id: string;
  competencia: string;
  valor: number | string;
  observacao: string | null;
  criado_em: string;
  criado_por_nome: string | null;
};

const paraValorMensal = (r: ValorMensalRow): ValorMensalRegistro => ({
  id: r.id,
  tipo: r.tipo,
  pessoaId: r.pessoa_id,
  competencia: r.competencia,
  valor: Number(r.valor),
  observacao: r.observacao ?? "",
  criadoEm: r.criado_em,
  criadoPor: r.criado_por_nome ?? "",
});

export type PessoaPagamento = { id: string; nome: string; atividade: string };

const TABELA_PESSOA: Record<TipoPessoaPagamento, string> = {
  terceirizado: "terceirizados",
  extra: "rh_extras",
};

// Colégio da pessoa ATIVA (terceirizado ou Extra); inativa não recebe valor novo.
async function unidadeDaPessoaAtiva(tipo: TipoPessoaPagamento, pessoaId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from(TABELA_PESSOA[tipo] as never)
    .select("school_id, ativo")
    .eq("id", pessoaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const p = data as { school_id: string | null; ativo: boolean | null } | null;
  if (!p || !p.school_id || p.ativo === false) throw new Error("Pessoa não encontrada.");
  return p.school_id;
}

const tipoSchema = z.enum(["terceirizado", "extra"]);

// Terceirizados e Extras ativos do colégio do seletor global + todos os valores lançados.
export const listarValoresMensais = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ schoolId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      terceirizados: PessoaPagamento[];
      extras: PessoaPagamento[];
      valores: ValorMensalRegistro[];
    }> => {
      await exigirPermissaoSalario(context.userId, false);
      await exigirUnidadeFolha(context.userId, data.schoolId);
      const [ter, ext, valores] = await Promise.all([
        supabaseAdmin
          .from("terceirizados" as never)
          .select("id, nome_completo, especialidade")
          .eq("school_id", data.schoolId)
          .eq("ativo", true),
        supabaseAdmin
          .from("rh_extras" as never)
          .select("id, nome_completo")
          .eq("school_id", data.schoolId)
          .eq("ativo", true),
        selectAll<ValorMensalRow>(() =>
          supabaseAdmin
            .from("rh_pagamentos_valores" as never)
            .select(
              "id, tipo, pessoa_id, competencia, valor, observacao, criado_em, criado_por_nome",
            )
            .eq("school_id", data.schoolId)
            .order("competencia", { ascending: false })
            .order("id"),
        ),
      ]);
      if (ter.error) throw new Error(ter.error.message);
      if (ext.error) throw new Error(ext.error.message);
      type P = { id: string; nome_completo: string; especialidade?: string | null };
      const pessoa = (r: P): PessoaPagamento => ({
        id: r.id,
        nome: r.nome_completo,
        atividade: r.especialidade ?? "",
      });
      return {
        terceirizados: ((ter.data ?? []) as P[]).map(pessoa),
        extras: ((ext.data ?? []) as P[]).map(pessoa),
        valores: valores.map(paraValorMensal),
      };
    },
  );

export const salvarValorMensal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        tipo: tipoSchema,
        pessoaId: z.string().uuid(),
        competencia: z.string(),
        valor: z.number(),
        observacao: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoSalario(context.userId, true);
    if (!competenciaValida(data.competencia)) throw new Error("Competência inválida (AAAA-MM).");
    if (!Number.isFinite(data.valor) || data.valor < 0) {
      throw new Error("Informe um valor maior ou igual a zero.");
    }
    const schoolId = await unidadeDaPessoaAtiva(data.tipo, data.pessoaId);
    await exigirUnidadeFolha(context.userId, schoolId);
    const { error } = await supabaseAdmin.from("rh_pagamentos_valores" as never).upsert(
      {
        tipo: data.tipo,
        pessoa_id: data.pessoaId,
        school_id: schoolId,
        competencia: data.competencia,
        valor: Math.round(data.valor * 100) / 100,
        observacao: data.observacao?.trim() || null,
        criado_por: context.userId,
        criado_por_nome: await nomeDoUsuario(context.userId),
        atualizado_em: new Date().toISOString(),
      } as never,
      { onConflict: "tipo,pessoa_id,competencia" } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirValorMensal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoSalario(context.userId, true);
    const { data: reg, error: rErr } = await supabaseAdmin
      .from("rh_pagamentos_valores" as never)
      .select("school_id")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    const alvo = reg as { school_id: string } | null;
    if (!alvo) throw new Error("Registro não encontrado.");
    await exigirUnidadeFolha(context.userId, alvo.school_id);
    const { error } = await supabaseAdmin
      .from("rh_pagamentos_valores" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Terceirizados/Extras do lote: pessoas (colégio e ativo) e valores lançados.
async function conferirValoresMensaisDoLote(
  schoolId: string,
  competencia: string,
  itens: readonly { tipo: TipoPessoaPagamento; pessoaId: string; nome: string; valor: number }[],
): Promise<void> {
  if (!itens.length) return;
  const pessoas = new Map<string, { schoolId: string | null; ativo: boolean }>();
  for (const tipo of ["terceirizado", "extra"] as const) {
    const ids = [...new Set(itens.filter((i) => i.tipo === tipo).map((i) => i.pessoaId))];
    if (!ids.length) continue;
    const { data, error } = await supabaseAdmin
      .from(TABELA_PESSOA[tipo] as never)
      .select("id, school_id, ativo")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as {
      id: string;
      school_id: string | null;
      ativo: boolean | null;
    }[]) {
      pessoas.set(`${tipo}:${p.id}`, { schoolId: p.school_id, ativo: p.ativo !== false });
    }
  }
  const registros = await selectAll<ValorMensalRow>(() =>
    supabaseAdmin
      .from("rh_pagamentos_valores" as never)
      .select("id, tipo, pessoa_id, competencia, valor, observacao, criado_em, criado_por_nome")
      .eq("school_id", schoolId)
      .in("pessoa_id", [...new Set(itens.map((i) => i.pessoaId))])
      .lte("competencia", competencia)
      .order("id"),
  );
  const erro = conferirItensValorMensal(
    itens,
    pessoas,
    registros.map(paraValorMensal),
    schoolId,
    competencia,
  );
  if (erro) throw new Error(erro);
}

const itemLoteSchema = z
  .object({
    tipo_pessoa: z.enum(["efetivo", "terceirizado", "extra"]).default("efetivo"),
    employee_id: z.string().uuid().nullable().optional(),
    pessoa_id: z.string().uuid().nullable().optional(),
    employee_name: z.string(),
    total_amount: z.number().positive(),
  })
  .refine(
    (i) => (i.tipo_pessoa === "efetivo" ? !!i.employee_id : !!i.pessoa_id && !i.employee_id),
    {
      message: "Item do lote sem identificação da pessoa.",
    },
  );

// Salva um lote de pagamento de Salário (hr_transport_batches, tipo='salario')
// com um item por pessoa: efetivos (folha importada ou salário manual),
// Terceirizados e Extras. Os itens já vêm montados pela lógica pura
// (montarLoteFolha / montarFolhaSalario + loteComValoresMensais).
export const salvarFolhaSalario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        schoolId: z.string().uuid(),
        titulo: z.string().trim().min(1).max(200),
        competencia: z.string(),
        dataPagamento: z.string().nullable().optional(),
        itens: z.array(itemLoteSchema).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await exigirPermissaoSalario(context.userId, true);
    if (!competenciaValida(data.competencia)) throw new Error("Competência inválida (AAAA-MM).");
    await exigirUnidadeFolha(context.userId, data.schoolId);
    const efetivos = data.itens.flatMap((i) =>
      i.tipo_pessoa === "efetivo" && i.employee_id
        ? [{ employee_id: i.employee_id, total_amount: i.total_amount }]
        : [],
    );
    await conferirLoteComFolha(data.schoolId, data.competencia, efetivos);
    await conferirValoresMensaisDoLote(
      data.schoolId,
      data.competencia,
      data.itens.flatMap((i) =>
        i.tipo_pessoa !== "efetivo" && i.pessoa_id
          ? [
              {
                tipo: i.tipo_pessoa,
                pessoaId: i.pessoa_id,
                nome: i.employee_name,
                valor: i.total_amount,
              },
            ]
          : [],
      ),
    );
    const total = somaReais(data.itens.map((i) => i.total_amount));
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
        tipo_pessoa: i.tipo_pessoa,
        employee_id: i.tipo_pessoa === "efetivo" ? i.employee_id : null,
        pessoa_id: i.tipo_pessoa === "efetivo" ? null : i.pessoa_id,
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
