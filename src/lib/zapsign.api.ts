// Rota nativa do webhook da ZapSign (sandbox/POC):
//   POST /api/zapsign/webhook
// Protegida pelo header customizado X-School-Hub-Signature que a própria
// ZapSign envia (configurado no registro do webhook). Responde 200 sempre que o
// payload for processável para a ZapSign não reentregar; idempotente por hash.

import { registrarCallback, type CallbackZapSign } from "@/lib/zapsign.persist";
import { zapsignWebhookSegredo } from "@/lib/zapsign.server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function assinaturaValida(request: Request): boolean | null {
  const esperado = zapsignWebhookSegredo();
  if (!esperado) return null;
  const informado = request.headers.get("x-school-hub-signature") ?? "";
  return informado.length === esperado.length && informado === esperado;
}

export async function handleZapSignApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/zapsign/webhook") return null;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ok = assinaturaValida(request);
  if (ok === null) return json({ error: "ZapSign não configurado" }, 503);
  if (!ok) return json({ error: "Assinatura inválida" }, 401);

  let payload: CallbackZapSign;
  try {
    const bruto: unknown = await request.json();
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
      return json({ error: "Payload inválido" }, 400);
    }
    payload = bruto as CallbackZapSign;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  try {
    const r = await registrarCallback(payload);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("[zapsign] erro ao processar callback:", e instanceof Error ? e.message : e);
    return json({ error: "Erro interno" }, 500);
  }
}
