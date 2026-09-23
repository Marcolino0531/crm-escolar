// Sino: aviso "Enviar boleto de matrícula" para os destinatários cadastrados
// (hoje só o Sérgio). Quem não é destinatário recebe lista vazia — nenhum
// outro usuário, admin ou não, vê esses avisos.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { ehDestinatarioBoleto, T_BOLETO_AVISOS } from "@/lib/contrato-boleto-avisos.server";

export interface AvisoBoletoMatricula {
  id: string;
  contratoId: string;
  unidade: string;
  alunoNome: string;
  serie: string;
  anoLetivo: number;
  responsavelNome: string;
  numeroContrato: string;
  assinadoEm: string;
}

type AvisoRow = {
  id: string;
  contrato_id: string;
  assinado_em: string;
  contrato: {
    unidade: string;
    aluno_nome: string;
    ano_letivo: number;
    responsavel_nome: string;
    numero_contrato: string;
    status: string;
    campos: Record<string, unknown> | null;
  } | null;
};

export const listarAvisosBoletoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AvisoBoletoMatricula[]> => {
    if (!(await ehDestinatarioBoleto(context.userId))) return [];
    const { data, error } = await supabaseAdmin
      .from(T_BOLETO_AVISOS)
      .select(
        "id, contrato_id, assinado_em, contrato:contrato_id(unidade, aluno_nome, ano_letivo, responsavel_nome, numero_contrato, status, campos)",
      )
      .is("concluido_em", null)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<AvisoRow[]>();
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((r) => r.contrato && r.contrato.status !== "cancelado")
      .map((r) => {
        const c = r.contrato!;
        const serie = c.campos?.CursoAtual;
        return {
          id: r.id,
          contratoId: r.contrato_id,
          unidade: c.unidade,
          alunoNome: c.aluno_nome,
          serie: typeof serie === "string" ? serie : "",
          anoLetivo: c.ano_letivo,
          responsavelNome: c.responsavel_nome,
          numeroContrato: c.numero_contrato,
          assinadoEm: r.assinado_em,
        };
      });
  });

const ConcluirSchema = z.object({ avisoId: z.string().uuid() });

/** Check "Boleto enviado": registra quem marcou e quando; o aviso sai do sino. */
export const concluirAvisoBoletoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ConcluirSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (!(await ehDestinatarioBoleto(context.userId))) {
      throw new Error("Você não recebe os avisos de boleto de matrícula.");
    }
    const { error } = await supabaseAdmin
      .from(T_BOLETO_AVISOS)
      .update({
        concluido_em: new Date().toISOString(),
        concluido_por: context.userId,
        concluido_por_nome: await nomeDoUsuario(context.userId),
      } as never)
      .eq("id", data.avisoId)
      .is("concluido_em", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
