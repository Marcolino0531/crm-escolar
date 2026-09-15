// Valor Colônia de Férias por unidade × ano letivo — servidor.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { valoresValidos, type ColoniaValoresRegistro } from "@/lib/colonia-valores";
import { ANO_LETIVO_MAX, ANO_LETIVO_MIN, anoLetivoValido } from "@/lib/rematricula";

type Row = {
  id: string;
  school_id: string;
  ano_letivo: number;
  diaria_avulsa: number | string;
  pacote_semanal: number | string;
  hora_extra_por_hora: number | string;
  lanche_por_registro: number | string;
  refeicao_principal_por_registro: number | string;
  franquia_minutos: number;
  dias_para_pacote: number;
  meses_credito_isencao: number[];
  updated_at: string;
  updated_by_nome: string | null;
  schools: { name: string } | { name: string }[] | null;
};

const SELECT =
  "id, school_id, ano_letivo, diaria_avulsa, pacote_semanal, hora_extra_por_hora, lanche_por_registro, refeicao_principal_por_registro, franquia_minutos, dias_para_pacote, meses_credito_isencao, updated_at, updated_by_nome, schools(name)";

// Ver: qualquer nível da Colônia; editar: só o nível financeiro.
async function exigirPermissao(userId: string, edicao: boolean): Promise<void> {
  const modulos = edicao ? ["colonia_financeiro"] : ["colonia", "colonia_financeiro"];
  for (const m of modulos) {
    const { data, error } = await supabaseAdmin.rpc(
      (edicao ? "can_edit_module" : "can_view_module") as never,
      { _user_id: userId, _module: m } as never,
    );
    if (error) throw new Error(error.message);
    if (data) return;
  }
  throw new Error(
    edicao
      ? "Você não tem permissão para editar os valores da Colônia de Férias."
      : "Você não tem permissão para ver os valores da Colônia de Férias.",
  );
}

function paraRegistro(r: Row): ColoniaValoresRegistro {
  const escola = Array.isArray(r.schools) ? r.schools[0] : r.schools;
  return {
    id: r.id,
    schoolId: r.school_id,
    unidade: escola?.name ?? "",
    anoLetivo: Number(r.ano_letivo),
    diariaAvulsa: Number(r.diaria_avulsa),
    pacoteSemanal: Number(r.pacote_semanal),
    horaExtraPorHora: Number(r.hora_extra_por_hora),
    lanchePorRegistro: Number(r.lanche_por_registro),
    refeicaoPrincipalPorRegistro: Number(r.refeicao_principal_por_registro),
    franquiaMinutos: Number(r.franquia_minutos),
    diasParaPacote: Number(r.dias_para_pacote),
    mesesCreditoIsencao: [...(r.meses_credito_isencao ?? [])].map(Number),
    atualizadoEm: r.updated_at,
    atualizadoPor: r.updated_by_nome ?? "",
  };
}

export const listarValoresColonia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ColoniaValoresRegistro[]> => {
    await exigirPermissao(context.userId, false);
    const { data, error } = await supabaseAdmin
      .from("colonia_valores" as never)
      .select(SELECT)
      .order("ano_letivo", { ascending: false })
      .returns<Row[]>();
    if (error) throw new Error(error.message);
    return (data ?? []).map(paraRegistro);
  });

const SalvarSchema = z.object({
  schoolId: z.string().uuid(),
  anoLetivo: z.number().int(),
  diariaAvulsa: z.number(),
  pacoteSemanal: z.number(),
  horaExtraPorHora: z.number(),
  lanchePorRegistro: z.number(),
  refeicaoPrincipalPorRegistro: z.number(),
  franquiaMinutos: z.number().int(),
  diasParaPacote: z.number().int(),
  mesesCreditoIsencao: z.array(z.number().int()),
});

export const salvarValoresColonia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    if (!anoLetivoValido(data.anoLetivo)) {
      throw new Error(`Informe um ano entre ${ANO_LETIVO_MIN} e ${ANO_LETIVO_MAX}.`);
    }
    const erro = valoresValidos(data);
    if (erro) throw new Error(erro);
    const c = (n: number) => Math.round(n * 100) / 100;
    const { error } = await supabaseAdmin.from("colonia_valores" as never).upsert(
      {
        school_id: data.schoolId,
        ano_letivo: data.anoLetivo,
        diaria_avulsa: c(data.diariaAvulsa),
        pacote_semanal: c(data.pacoteSemanal),
        hora_extra_por_hora: c(data.horaExtraPorHora),
        lanche_por_registro: c(data.lanchePorRegistro),
        refeicao_principal_por_registro: c(data.refeicaoPrincipalPorRegistro),
        franquia_minutos: data.franquiaMinutos,
        dias_para_pacote: data.diasParaPacote,
        meses_credito_isencao: [...new Set(data.mesesCreditoIsencao)].sort((a, b) => a - b),
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: await nomeDoUsuario(context.userId),
      } as never,
      { onConflict: "school_id,ano_letivo" } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const excluirValoresColonia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    const { error } = await supabaseAdmin
      .from("colonia_valores" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
