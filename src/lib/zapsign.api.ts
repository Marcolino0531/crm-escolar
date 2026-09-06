// Rota nativa do webhook da ZapSign (sandbox/POC e produção):
//   POST /api/zapsign/webhook
// Protegida pelo header customizado X-School-Hub-Signature que a própria
// ZapSign envia (configurado no registro do webhook). O segredo é derivado do
// token de cada ambiente, então o header identifica se o callback veio do
// sandbox ou da produção — e o estado só é aplicado a documento do MESMO
// ambiente. Responde 200 sempre que o payload for processável para a ZapSign
// não reentregar; idempotente por hash.

import { registrarCallback, type CallbackZapSign } from "@/lib/zapsign.persist";
import { zapsignWebhookSegredo, type ZapSignAmbiente } from "@/lib/zapsign.server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Ambiente cujo segredo casa com o header; `null` se nenhum token configurado. */
export function ambienteDaAssinatura(
  informado: string,
  segredos: Record<ZapSignAmbiente, string | null>,
): ZapSignAmbiente | "invalida" | null {
  const ambientes: ZapSignAmbiente[] = ["producao", "sandbox"];
  let algumConfigurado = false;
  for (const ambiente of ambientes) {
    const esperado = segredos[ambiente];
    if (!esperado) continue;
    algumConfigurado = true;
    if (informado.length === esperado.length && informado === esperado) return ambiente;
  }
  return algumConfigurado ? "invalida" : null;
}

export async function handleZapSignApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/zapsign/webhook") return null;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ambiente = ambienteDaAssinatura(request.headers.get("x-school-hub-signature") ?? "", {
    producao: zapsignWebhookSegredo("producao"),
    sandbox: zapsignWebhookSegredo("sandbox"),
  });
  if (ambiente === null) return json({ error: "ZapSign não configurado" }, 503);
  if (ambiente === "invalida") return json({ error: "Assinatura inválida" }, 401);

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
    const r = await registrarCallback(payload, ambiente);
    return json({ ok: true, ambiente, ...r });
  } catch (e) {
    console.error("[zapsign] erro ao processar callback:", e instanceof Error ? e.message : e);
    return json({ error: "Erro interno" }, 500);
  }
}
