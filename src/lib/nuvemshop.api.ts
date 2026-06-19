// Roteador dos endpoints nativos da integração Nuvemshop, montado a partir do
// server entry (`src/server.ts`). Retorna `null` quando a requisição não é de
// um endpoint Nuvemshop (deixando o roteador da aplicação seguir o fluxo normal).
//
//   POST /api/nuvemshop/sync      — sincronização manual (botão da UI; exige login)
//   POST /api/nuvemshop/webhook   — eventos em tempo real (validação HMAC)
//   GET  /api/nuvemshop/cron      — auditoria noturna (Vercel Cron; CRON_SECRET)
//   GET  /api/nuvemshop/callback  — callback OAuth do App de Parceiro (code -> token)

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  handleWebhookEvent,
  NUVEMSHOP_USER_AGENT,
  runFullSync,
  verifyWebhookHmac,
} from "@/lib/nuvemshop.server";

const NUVEMSHOP_TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function callbackPage(title: string, inner: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 2rem; }
  .card { max-width: 760px; margin: 3rem auto; background: #1e293b; border-radius: 16px; padding: 2rem; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; }
  .label { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; margin-top: 1.25rem; }
  .token { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.4rem; font-weight: 700; word-break: break-all; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 1rem; margin-top: .4rem; color: #4ade80; }
  .muted { color: #94a3b8; font-size: .9rem; }
  .warn { margin-top: 1.5rem; color: #fbbf24; font-size: .85rem; }
</style>
</head>
<body>
  <div class="card">${inner}</div>
</body>
</html>`;
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
  const url = new URL(request.url);
  const { pathname } = url;
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

  // --- Callback OAuth do App de Parceiro ---
  if (pathname === "/api/nuvemshop/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) {
      return html(
        callbackPage(
          "Nuvemshop — código ausente",
          `<h1>Código de autorização ausente</h1><p class="muted">A Nuvemshop deve redirecionar para esta página com <code>?code=...</code>. Tente instalar o app novamente pelo painel de Parceiros.</p>`,
        ),
        400,
      );
    }

    const clientId = process.env.NUVEMSHOP_CLIENT_ID;
    const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      const missing = [
        !clientId ? "NUVEMSHOP_CLIENT_ID" : null,
        !clientSecret ? "NUVEMSHOP_CLIENT_SECRET" : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.error("[nuvemshop] /callback sem credenciais:", missing);
      return html(
        callbackPage(
          "Nuvemshop — credenciais ausentes",
          `<h1>Credenciais do app ausentes</h1><p class="muted">Defina no painel da Vercel: <strong>${escapeHtml(missing)}</strong>.</p>`,
        ),
        500,
      );
    }

    try {
      const res = await fetch(NUVEMSHOP_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": NUVEMSHOP_USER_AGENT,
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        user_id?: number | string;
        error?: string;
        error_description?: string;
      };
      console.info(`[nuvemshop] /callback token exchange -> ${res.status}`);
      if (!res.ok || !data.access_token) {
        const detail = data.error_description ?? data.error ?? `HTTP ${res.status}`;
        return html(
          callbackPage(
            "Nuvemshop — falha na troca do código",
            `<h1>Não foi possível obter o token</h1><p class="muted">${escapeHtml(detail)}</p>`,
          ),
          502,
        );
      }
      const storeId = data.user_id != null ? String(data.user_id) : "";
      return html(
        callbackPage(
          "Nuvemshop — instalação concluída",
          `<h1>Integração autorizada com sucesso</h1>
          <p class="muted">Copie os valores abaixo e cole no painel da Vercel (Settings → Environment Variables).</p>
          <div class="label">NUVEMSHOP_ACCESS_TOKEN</div>
          <div class="token">${escapeHtml(data.access_token)}</div>
          ${storeId ? `<div class="label">NUVEMSHOP_STORE_ID</div><div class="token">${escapeHtml(storeId)}</div>` : ""}
          <p class="warn">⚠️ Este token dá acesso à API da sua loja. Copie agora e não compartilhe a URL nem prints desta página.</p>`,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[nuvemshop] /callback falhou:", msg);
      return html(
        callbackPage(
          "Nuvemshop — erro",
          `<h1>Erro ao contatar a Nuvemshop</h1><p class="muted">${escapeHtml(msg)}</p>`,
        ),
        500,
      );
    }
  }

  return json({ ok: false, error: "rota não encontrada" }, 404);
}
