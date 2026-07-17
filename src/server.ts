import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleNuvemshopApi } from "./lib/nuvemshop.api";
import { handleUniformesApi } from "./lib/uniformes.api";
import { handleCobrancasApi } from "./lib/cobrancas.api";
import { handleReceivablesApi } from "./lib/receivables.api";
import { handleDiarioApi } from "./lib/diario.api";
import { handleWhatsAppApi } from "./lib/whatsapp.api";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Endpoints nativos da integração Nuvemshop (sync/webhook/cron). Tratados
      // aqui, antes do roteador da aplicação, por serem chamadas externas
      // (webhook/cron) que não passam pelo fluxo de RPC do front.
      const nuvemshopResponse = await handleNuvemshopApi(request);
      if (nuvemshopResponse) return nuvemshopResponse;

      // Exportação de pedidos de uniformes (.xlsx).
      const uniformesResponse = await handleUniformesApi(request);
      if (uniformesResponse) return uniformesResponse;

      // Histórico de envios de WhatsApp da Cobrança.
      const cobrancasResponse = await handleCobrancasApi(request);
      if (cobrancasResponse) return cobrancasResponse;

      // Verificação diária dos recebíveis de cartão (Vercel Cron).
      const receivablesResponse = await handleReceivablesApi(request);
      if (receivablesResponse) return receivablesResponse;

      // Sincronização diária do Diário do Aluno com o Sponte (Vercel Cron).
      const diarioResponse = await handleDiarioApi(request);
      if (diarioResponse) return diarioResponse;

      // Automação de Cobrança por WhatsApp (Cloud API da Meta): cron + webhook.
      const whatsappResponse = await handleWhatsAppApi(request);
      if (whatsappResponse) return whatsappResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
