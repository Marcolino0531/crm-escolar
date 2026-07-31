// Webhook de matrícula: recebe o formulário de matrícula (Google Forms via
// Apps Script) e dispara a criação sequencial no Sponte — Aluno (com endereço)
// e, com o AlunoID em mãos, cada Responsável.
//
//   POST /api/matriculas/webhook           — processa e grava no Sponte
//   POST /api/matriculas/webhook?dryRun=1  — valida o payload sem escrever nada
//
// Autenticação: token compartilhado em MATRICULA_WEBHOOK_TOKEN, enviado no
// header `Authorization: Bearer <token>` ou na query `?token=`. Sem a variável
// configurada o endpoint responde 503 (fail-closed) — nunca fica aberto.
//
// Toda submissão é registrada em `enrollment_submissions` (payload + retorno do
// Sponte), inclusive as que falham, para auditoria e reprocessamento.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  MatriculaError,
  processarMatricula,
  type MatriculaPayload,
  type MatriculaResultado,
} from "@/lib/matriculas.sponte";
import { UNIDADES_SPONTE } from "@/lib/sponte.functions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const texto = z.string().trim();
const opcional = texto.optional().default("");

const EnderecoSchema = z.object({
  cep: texto.min(1, "CEP é obrigatório"),
  numero: texto.min(1, "Número é obrigatório"),
  complemento: opcional,
  logradouro: opcional,
  bairro: opcional,
  cidade: opcional,
});

const MatriculaSchema = z.object({
  submissionId: texto.optional(),
  unidade: texto.refine((u) => UNIDADES_SPONTE.includes(u), {
    message: `Unidade inválida. Use uma destas: ${UNIDADES_SPONTE.join(", ")}`,
  }),
  // Reprocessa só os responsáveis de um aluno que já entrou no Sponte.
  alunoIdExistente: z.number().int().positive().optional(),
  aluno: z.object({
    nome: texto.min(3, "Nome completo do aluno é obrigatório"),
    dataNascimento: texto.min(1, "Data de nascimento do aluno é obrigatória"),
    cpf: opcional,
    rg: opcional,
    sexo: opcional,
    naturalidade: opcional,
    nacionalidade: opcional,
    email: opcional,
    telefone: opcional,
    celular: opcional,
    observacao: opcional,
    situacao: opcional,
    midia: opcional,
  }),
  endereco: EnderecoSchema,
  responsaveis: z
    .array(
      z.object({
        nome: texto.min(3, "Nome do responsável é obrigatório"),
        parentesco: texto.min(1, "Parentesco é obrigatório"),
        parentescoId: z.number().int().optional(),
        dataNascimento: opcional,
        // O Sponte recusa responsável sem CPF ("27 - Campo CPF é obrigatório"),
        // então barramos aqui — antes de o aluno ser criado.
        cpf: texto.refine((c) => c.replace(/\D/g, "").length === 11, {
          message: "CPF do responsável é obrigatório (o Sponte recusa o cadastro sem ele)",
        }),
        rg: opcional,
        sexo: opcional,
        profissao: opcional,
        email: opcional,
        telefone: opcional,
        celular: opcional,
        responsavelFinanceiro: z.boolean().default(false),
        responsavelDidatico: z.boolean().default(false),
        endereco: EnderecoSchema.optional(),
      }),
    )
    .min(1, "Envie ao menos um responsável"),
});

function autorizado(request: Request, url: URL): boolean | null {
  const esperado = process.env.MATRICULA_WEBHOOK_TOKEN;
  if (!esperado) return null;
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "";
  const informado = bearer || url.searchParams.get("token") || "";
  return informado.length === esperado.length && informado === esperado;
}

async function registrarLog(
  payload: MatriculaPayload | null,
  bruto: unknown,
  resultado: MatriculaResultado | null,
  status: string,
  erro: string | null,
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
  } as never);
  if (error) console.error("[matrículas] falha ao gravar o log da submissão:", error.message);
}

export async function handleMatriculasApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/matriculas/webhook") return null;
  if (request.method !== "POST") return json({ ok: false, error: "método não permitido" }, 405);

  const auth = autorizado(request, url);
  if (auth === null) {
    console.error("[matrículas] MATRICULA_WEBHOOK_TOKEN não configurada — webhook desativado.");
    return json({ ok: false, error: "webhook não configurado" }, 503);
  }
  if (!auth) return json({ ok: false, error: "não autorizado" }, 401);

  let bruto: unknown;
  try {
    bruto = await request.json();
  } catch {
    return json({ ok: false, error: "corpo da requisição não é um JSON válido" }, 400);
  }

  const parsed = MatriculaSchema.safeParse(bruto);
  if (!parsed.success) {
    const problemas = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return json({ ok: false, error: "payload inválido", problemas }, 422);
  }

  const payload = parsed.data as MatriculaPayload;
  const dryRun = url.searchParams.get("dryRun") === "1";

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
      return json({
        ok: true,
        status: "ja_processado",
        alunoId: anterior.sponte_aluno_id,
        mensagem: "Esta submissão já havia sido processada com sucesso.",
      });
    }
  }

  try {
    const resultado = await processarMatricula(payload, { dryRun });
    if (!dryRun) {
      await registrarLog(payload, bruto, resultado, resultado.status, resultado.error ?? null);
    }
    return json(resultado, resultado.ok ? 200 : resultado.status === "duplicado" ? 409 : 502);
  } catch (e) {
    const status = e instanceof MatriculaError ? e.status : "erro_aluno";
    const httpStatus = e instanceof MatriculaError ? e.httpStatus : 502;
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("[matrículas] falha ao processar a submissão:", mensagem);
    // 422 é payload malformado: não vira log de auditoria (nada chegou ao Sponte).
    if (!dryRun && httpStatus !== 422) await registrarLog(payload, bruto, null, status, mensagem);
    return json({ ok: false, status, error: mensagem }, httpStatus);
  }
}
