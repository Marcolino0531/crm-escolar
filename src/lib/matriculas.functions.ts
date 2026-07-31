// Server function do Dashboard de Matrículas: reenvia ao Sponte uma submissão
// que falhou, a partir do payload original gravado na auditoria.
//
// A linha existente é ATUALIZADA (não se cria outra) para que o histórico da
// submissão continue único — o índice de idempotência do webhook depende disso.
// Se o aluno já tinha sido criado na tentativa anterior, o reenvio vai direto
// para os responsáveis (`alunoIdExistente`), sem duplicar o cadastro.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MatriculaSchema, problemasDoPayload } from "@/lib/matriculas.schema";
import {
  MatriculaError,
  processarMatricula,
  type MatriculaPayload,
  type MatriculaResultado,
} from "@/lib/matriculas.sponte";

export interface ReprocessarMatriculaResult {
  ok: boolean;
  status?: string;
  alunoId?: number | null;
  error?: string;
  problemas?: string[];
}

type SubmissaoRow = {
  id: string;
  status: string;
  sponte_aluno_id: number | null;
  payload: unknown;
  tentativas: number | null;
};

const STATUS_REPROCESSAVEIS = ["erro_aluno", "erro_responsavel"];

async function assertCanEditAdmissoes(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "admissoes" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para reprocessar matrículas.");
}

const ReprocessarInputSchema = z.object({ id: z.string().uuid() });

export const reprocessarMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReprocessarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReprocessarMatriculaResult> => {
    await assertCanEditAdmissoes(context.userId);

    const { data: row } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("id, status, sponte_aluno_id, payload, tentativas")
      .eq("id", data.id)
      .maybeSingle();
    const submissao = row as unknown as SubmissaoRow | null;
    if (!submissao) return { ok: false, error: "Submissão não encontrada." };

    if (!STATUS_REPROCESSAVEIS.includes(submissao.status)) {
      return {
        ok: false,
        error: "Só é possível reprocessar submissões que falharam no envio ao Sponte.",
      };
    }

    const parsed = MatriculaSchema.safeParse(submissao.payload);
    if (!parsed.success) {
      return {
        ok: false,
        error: "O payload gravado não atende ao contrato do webhook — corrija na origem.",
        problemas: problemasDoPayload(parsed.error),
      };
    }

    const payload: MatriculaPayload = {
      ...(parsed.data as MatriculaPayload),
      // O aluno da tentativa anterior é reaproveitado; sem isso a releitura por
      // CPF devolveria "duplicado" e os responsáveis nunca seriam criados.
      alunoIdExistente: submissao.sponte_aluno_id ?? undefined,
    };

    let resultado: MatriculaResultado | null = null;
    let status = submissao.status;
    let erro: string | null = null;

    try {
      resultado = await processarMatricula(payload, { dryRun: false });
      status = resultado.status;
      erro = resultado.error ?? null;
    } catch (e) {
      status = e instanceof MatriculaError ? e.status : "erro_aluno";
      erro = e instanceof Error ? e.message : String(e);
      console.error("[matrículas] falha ao reprocessar a submissão:", erro);
    }

    const { error: updateError } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .update({
        status,
        erro,
        resultado,
        sponte_aluno_id: resultado?.alunoId ?? submissao.sponte_aluno_id,
        tentativas: (submissao.tentativas ?? 1) + 1,
        reprocessado_em: new Date().toISOString(),
        reprocessado_por: context.userId,
      } as never)
      .eq("id", submissao.id);

    if (updateError) {
      return {
        ok: false,
        status,
        error: `O reenvio rodou (status "${status}"), mas a auditoria não pôde ser atualizada: ${updateError.message}`,
      };
    }

    return {
      ok: status === "sucesso",
      status,
      alunoId: resultado?.alunoId ?? submissao.sponte_aluno_id,
      error: erro ?? undefined,
    };
  });
