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
// A validação, a idempotência e a auditoria vivem em `receberMatricula`, o mesmo
// núcleo usado pela página pública /matricula.

import { ORIGEM_GOOGLE_FORMS } from "@/lib/matricula-form";
import { receberMatricula, registrarFalhaValidacao } from "@/lib/matriculas.receber";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function autorizado(request: Request, url: URL): boolean | null {
  const esperado = process.env.MATRICULA_WEBHOOK_TOKEN;
  if (!esperado) return null;
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "";
  const informado = bearer || url.searchParams.get("token") || "";
  return informado.length === esperado.length && informado === esperado;
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

  const dryRun = url.searchParams.get("dryRun") === "1";

  let bruto: unknown;
  try {
    bruto = await request.json();
  } catch {
    const mensagem = "corpo da requisição não é um JSON válido";
    if (!dryRun)
      await registrarFalhaValidacao({ erro_parse: mensagem }, [mensagem], {
        origem: ORIGEM_GOOGLE_FORMS,
      });
    return json({ ok: false, error: mensagem }, 400);
  }

  const saida = await receberMatricula(bruto, { dryRun, origem: ORIGEM_GOOGLE_FORMS });
  return json(saida.corpo, saida.httpStatus);
}
