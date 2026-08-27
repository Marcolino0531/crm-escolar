// Núcleo do recebimento de uma matrícula, compartilhado pelos DOIS caminhos de
// entrada: o webhook do Google Forms (Apps Script) e o formulário público do
// próprio School Hub (/matricula).
//
// Aqui ficam validação de contrato, idempotência e auditoria; a escrita no
// Sponte continua sendo `processarMatricula`. Ter um caminho único garante que a
// página nativa aparece no painel /matriculas exatamente como as submissões do
// Forms, com o mesmo tratamento de Erro 29 e vínculo de irmãos.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MatriculaSchema, problemasDoPayload } from "@/lib/matriculas.schema";
import { extrairDadosBasicos } from "@/lib/matriculas.audit";
import { ORIGEM_GOOGLE_FORMS } from "@/lib/matricula-form";
import {
  MatriculaError,
  processarMatricula,
  type MatriculaPayload,
  type MatriculaResultado,
} from "@/lib/matriculas.sponte";

export interface ReceberMatriculaOpcoes {
  // Ensaio (o Apps Script valida antes do envio real): nada é gravado.
  dryRun?: boolean;
  origem?: string;
  // Hash do IP de origem (formulário público) — nunca o IP em texto.
  ipHash?: string | null;
}

export interface ReceberMatriculaSaida {
  httpStatus: number;
  corpo: Record<string, unknown>;
  status: string;
  ok: boolean;
}

async function registrarLog(
  payload: MatriculaPayload | null,
  bruto: unknown,
  resultado: MatriculaResultado | null,
  status: string,
  erro: string | null,
  opcoes: ReceberMatriculaOpcoes,
): Promise<void> {
  const { error } = await supabaseAdmin.from("enrollment_submissions" as never).insert({
    submission_id: payload?.submissionId ?? null,
    unidade: payload?.unidade ?? null,
    aluno_nome: payload?.aluno.nome ?? null,
    aluno_cpf: payload?.aluno.cpf ?? null,
    sponte_aluno_id: resultado?.alunoId ?? null,
    status,
    erro,
    payload: bruto,
    resultado,
    origem: opcoes.origem ?? ORIGEM_GOOGLE_FORMS,
    ip_hash: opcoes.ipHash ?? null,
  } as never);
  if (error) console.error("[matrículas] falha ao gravar o log da submissão:", error.message);
}

// Grava a tentativa rejeitada na validação (payload inválido) para dar
// visibilidade no painel /matriculas. Nada é enviado ao Sponte.
export async function registrarFalhaValidacao(
  bruto: unknown,
  problemas: string[],
  opcoes: ReceberMatriculaOpcoes = {},
): Promise<void> {
  const dados = extrairDadosBasicos(bruto);
  const { error } = await supabaseAdmin.from("enrollment_submissions" as never).insert({
    submission_id: dados.submissionId,
    unidade: dados.unidade,
    aluno_nome: dados.alunoNome,
    aluno_cpf: dados.alunoCpf,
    sponte_aluno_id: null,
    status: "erro_validacao",
    erro: problemas.join("; "),
    payload: bruto ?? {},
    resultado: null,
    origem: opcoes.origem ?? ORIGEM_GOOGLE_FORMS,
    ip_hash: opcoes.ipHash ?? null,
  } as never);
  if (error)
    console.error("[matrículas] falha ao gravar o log de erro de validação:", error.message);
}

/**
 * Valida, deduplica, envia ao Sponte e audita uma submissão de matrícula.
 * Devolve o corpo e o status HTTP já resolvidos (o webhook responde direto com
 * eles; a página pública traduz para a tela).
 */
export async function receberMatricula(
  bruto: unknown,
  opcoes: ReceberMatriculaOpcoes = {},
): Promise<ReceberMatriculaSaida> {
  const dryRun = opcoes.dryRun === true;

  const parsed = MatriculaSchema.safeParse(bruto);
  if (!parsed.success) {
    const problemas = problemasDoPayload(parsed.error);
    if (!dryRun) await registrarFalhaValidacao(bruto, problemas, opcoes);
    return {
      httpStatus: 422,
      corpo: { ok: false, error: "payload inválido", problemas },
      status: "erro_validacao",
      ok: false,
    };
  }

  const payload = parsed.data as MatriculaPayload;

  // Idempotência: o Apps Script pode reenviar a mesma resposta do formulário.
  if (!dryRun && payload.submissionId) {
    const { data } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("sponte_aluno_id")
      .eq("submission_id", payload.submissionId)
      .eq("status", "sucesso")
      .maybeSingle();
    const anterior = data as { sponte_aluno_id: number | null } | null;
    if (anterior) {
      return {
        httpStatus: 200,
        corpo: {
          ok: true,
          status: "ja_processado",
          alunoId: anterior.sponte_aluno_id,
          mensagem: "Esta submissão já havia sido processada com sucesso.",
        },
        status: "ja_processado",
        ok: true,
      };
    }
  }

  try {
    const resultado = await processarMatricula(payload, { dryRun });
    if (!dryRun) {
      await registrarLog(
        payload,
        bruto,
        resultado,
        resultado.status,
        resultado.error ?? null,
        opcoes,
      );
    }
    return {
      httpStatus: resultado.ok ? 200 : resultado.status === "duplicado" ? 409 : 502,
      corpo: resultado as unknown as Record<string, unknown>,
      status: resultado.status,
      ok: resultado.ok,
    };
  } catch (e) {
    const status = e instanceof MatriculaError ? e.status : "erro_aluno";
    const httpStatus = e instanceof MatriculaError ? e.httpStatus : 502;
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("[matrículas] falha ao processar a submissão:", mensagem);
    // 422 é payload malformado: não vira log de auditoria (nada chegou ao Sponte).
    if (!dryRun && httpStatus !== 422)
      await registrarLog(payload, bruto, null, status, mensagem, opcoes);
    return {
      httpStatus,
      corpo: { ok: false, status, error: mensagem },
      status,
      ok: false,
    };
  }
}
