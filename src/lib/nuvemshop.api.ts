// Roteador dos endpoints nativos da integração Nuvemshop, montado a partir do
// server entry (`src/server.ts`). Retorna `null` quando a requisição não é de
// um endpoint Nuvemshop (deixando o roteador da aplicação seguir o fluxo normal).
//
//   POST /api/nuvemshop/sync     — sincronização manual (botão da UI; exige login)
//   POST /api/nuvemshop/webhook  — eventos em tempo real (validação HMAC)
//   GET  /api/nuvemshop/cron     — auditoria noturna (Vercel Cron; CRON_SECRET)

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleWebhookEvent, runFullSync, verifyWebhookHmac } from "@/lib/nuvemshop.server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = bearer(request);
  if (!token) return false;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && !!data?.user;
}

export async function handleNuvemshopApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/nuvemshop/")) return null;

  // --- Sincronização manual (UI) ---
  if (pathname === "/api/nuvemshop/sync" && request.method === "POST") {
    if (!(await isAuthenticated(request))) {
      console.warn("[nuvemshop] /sync rejeitado: usuário não autenticado");
      return json({ ok: false, error: "Sessão inválida — faça login novamente." }, 401);
    }
    try {
      const result = await runFullSync("manual");
      return json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[nuvemshop] /sync falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  // --- Webhook em tempo real ---
  if (pathname === "/api/nuvemshop/webhook" && request.method === "POST") {
    const raw = await request.text();
    const valid = await verifyWebhookHmac(raw, request.headers.get("x-linkedstore-hmac-sha256"));
    if (!valid) return json({ ok: false, error: "assinatura inválida" }, 401);
    try {
      await handleWebhookEvent(JSON.parse(raw));
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  // --- Auditoria noturna (Vercel Cron) ---
  if (pathname === "/api/nuvemshop/cron" && request.method === "GET") {
    // A Vercel envia "Authorization: Bearer <CRON_SECRET>" quando a env existe.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    try {
      const result = await runFullSync("cron");
      return json({ ok: true, ...result });
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  return json({ ok: false, error: "rota não encontrada" }, 404);
}
