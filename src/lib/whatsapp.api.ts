// Endpoints nativos da automação de Cobrança por WhatsApp (Cloud API da Meta).
// Montados a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET  /api/whatsapp/cron     — rotina diária (Vercel Cron; CRON_SECRET):
//                                 dispara lembrete das cobranças vencidas há 2 dias.
//   GET  /api/whatsapp/webhook  — verificação do webhook (hub.challenge da Meta).
//   POST /api/whatsapp/webhook  — eventos de status (enviado/entregue/lido/falha).
//
// Os disparos gravam em `whatsapp_billing_logs`; os eventos do webhook atualizam
// o status por `wa_message_id` (wamid retornado no envio).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { coletarPendenciasPorVencimento } from "@/lib/sponte.functions";
import { getWhatsAppConfig, sendBillingTemplate } from "@/lib/whatsapp.server";

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

// Dia (YYYY-MM-DD, timezone de São Paulo) deslocado por `offsetDias`.
function diaYMD(offsetDias: number): string {
  const agora = new Date();
  const spNow = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  spNow.setDate(spNow.getDate() + offsetDias);
  return `${spNow.getFullYear()}-${String(spNow.getMonth() + 1).padStart(2, "0")}-${String(spNow.getDate()).padStart(2, "0")}`;
}

function vencToYMD(v: string): string {
  if (!v) return "";
  if (v.includes("/")) {
    const [d, m, y] = v.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v.slice(0, 10);
}

function formatBRL(n: number): string {
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatVencBR(ymd: string): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export async function handleWhatsAppApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/whatsapp/")) return null;

  if (pathname === "/api/whatsapp/cron" && request.method === "GET") {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    try {
      return await runCron();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[whatsapp] cron falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  if (pathname === "/api/whatsapp/webhook" && request.method === "GET") {
    // Verificação do webhook: a Meta chama com hub.mode/hub.verify_token/hub.challenge.
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return json({ ok: false, error: "verificação inválida" }, 403);
  }

  if (pathname === "/api/whatsapp/webhook" && request.method === "POST") {
    try {
      const payload = (await request.json().catch(() => null)) as WebhookPayload | null;
      await processarWebhook(payload);
    } catch (e) {
      console.error("[whatsapp] webhook falhou:", e instanceof Error ? e.message : String(e));
    }
    // A Meta exige 200 rápido, senão reenvia o evento.
    return json({ ok: true });
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}

// ─── Cron: dispara lembrete das cobranças vencidas há exatamente 2 dias ───────
async function runCron(): Promise<Response> {
  const cfg = getWhatsAppConfig();
  if (!cfg) {
    return json({
      ok: false,
      error:
        "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE_NAME).",
    });
  }

  const alvo = diaYMD(-2);
  const pendencias = await coletarPendenciasPorVencimento(alvo);

  // Anti-duplicidade: não reenvia se já houver log para o mesmo aluno/vencimento
  // com status de envio (evita disparo repetido se o cron rodar duas vezes).
  const { data: jaEnviados } = await supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .select("fatura_id")
    .eq("vencimento", alvo)
    .in("status", ["enviado", "entregue", "lido", "sucesso"]);
  const enviadosSet = new Set(
    ((jaEnviados ?? []) as unknown as { fatura_id: string | null }[]).map((r) => r.fatura_id ?? ""),
  );

  let enviados = 0;
  let falhas = 0;
  let pulados = 0;

  for (const p of pendencias) {
    const vencYMD = vencToYMD(p.vencimento) || alvo;
    if (enviadosSet.has(p.alunoId)) {
      pulados++;
      continue;
    }
    enviadosSet.add(p.alunoId);

    const base = {
      responsavel_name: p.nomeResponsavel || "",
      aluno_name: p.nomeAluno || "",
      telefone: p.telefone || "",
      unidade: p.unidade || "",
      valor: p.valorTotalBoleto,
      vencimento: vencYMD,
      template_name: cfg.templateName,
      fatura_id: p.alunoId,
    };

    const semTelefone = !p.telefone || p.telefone === "-";
    if (semTelefone) {
      falhas++;
      await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
        ...base,
        status: "falha",
        erro_mensagem: "Responsável sem telefone cadastrado no Sponte.",
      } as never);
      continue;
    }

    try {
      const { messageId } = await sendBillingTemplate(cfg, {
        to: p.telefone,
        responsavel: p.nomeResponsavel,
        aluno: p.nomeAluno,
        valor: formatBRL(p.valorTotalBoleto),
        vencimento: formatVencBR(vencYMD),
      });
      enviados++;
      await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
        ...base,
        status: "enviado",
        wa_message_id: messageId,
      } as never);
    } catch (e) {
      falhas++;
      await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
        ...base,
        status: "falha",
        erro_mensagem: e instanceof Error ? e.message : String(e),
      } as never);
    }
  }

  console.log(
    `[whatsapp] cron ${alvo}: ${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s) de ${pendencias.length} pendência(s).`,
  );
  return json({ ok: true, alvo, total: pendencias.length, enviados, falhas, pulados });
}

// ─── Webhook: atualiza o status por wa_message_id ────────────────────────────
interface WebhookStatus {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string; error_data?: { details?: string } }[];
}
interface WebhookPayload {
  entry?: {
    changes?: {
      value?: { statuses?: WebhookStatus[] };
    }[];
  }[];
}

const STATUS_MAP: Record<string, string> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falha",
};

// Ordem do ciclo, para evitar regressão (ex.: um 'delivered' atrasado não pode
// rebaixar um registro já 'lido'). 'falha' sempre sobrescreve.
const STATUS_RANK: Record<string, number> = {
  pendente: 0,
  enviado: 1,
  entregue: 2,
  lido: 3,
};

async function processarWebhook(payload: WebhookPayload | null): Promise<void> {
  if (!payload?.entry) return;
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      for (const st of change.value?.statuses ?? []) {
        const wamid = st.id;
        const mapped = st.status ? STATUS_MAP[st.status] : undefined;
        if (!wamid || !mapped) continue;

        const { data: atual } = await supabaseAdmin
          .from("whatsapp_billing_logs" as never)
          .select("id, status")
          .eq("wa_message_id", wamid)
          .maybeSingle();
        const row = atual as unknown as { id: string; status: string } | null;
        if (!row) continue;

        // Não rebaixa o status; 'falha' é sempre aplicada.
        if (mapped !== "falha" && (STATUS_RANK[mapped] ?? 0) <= (STATUS_RANK[row.status] ?? -1)) {
          continue;
        }

        const patch: { status: string; erro_mensagem?: string } = { status: mapped };
        if (mapped === "falha") {
          const err = st.errors?.[0];
          patch.erro_mensagem =
            err?.error_data?.details || err?.message || err?.title || "Falha reportada pela Meta.";
        }
        const { error } = await supabaseAdmin
          .from("whatsapp_billing_logs" as never)
          .update(patch as never)
          .eq("id", row.id);
        if (error) console.warn("[whatsapp] webhook update falhou:", error.message);
      }
    }
  }
}
