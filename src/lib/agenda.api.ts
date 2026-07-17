// Endpoints nativos da Agenda.
// Montados a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/agenda/cron  — lembrete matinal por email (Vercel Cron)
//
// Todos os dias de manhã, busca as reuniões marcadas para HOJE e dispara um
// email de lembrete para cada usuário vinculado ao campo "Equipe". Agendado no
// vercel.json para 10:00 UTC (= 07:00 no horário de Brasília).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getResendConfig, sendEmail } from "@/lib/agenda.email";

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

// Data de HOJE (YYYY-MM-DD) no fuso de Brasília, independente do fuso do runtime.
function hojeYMD(): string {
  const agora = new Date();
  const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return `${sp.getFullYear()}-${String(sp.getMonth() + 1).padStart(2, "0")}-${String(sp.getDate()).padStart(2, "0")}`;
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateBR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

type ReuniaoRow = {
  id: string;
  data: string;
  horario: string | null;
  responsavel_nome: string | null;
  aluno_nome: string | null;
  colaboradores: string[] | null;
  participante_ids: string[] | null;
};

async function enviarLembretesDoDia(): Promise<{
  reunioes: number;
  emails: number;
  erros: number;
}> {
  const cfg = getResendConfig();
  if (!cfg) throw new Error("config ausente: defina RESEND_API_KEY e RESEND_FROM.");

  const hoje = hojeYMD();
  const { data, error } = await supabaseAdmin
    .from("agenda_reunioes" as never)
    .select("id, data, horario, responsavel_nome, aluno_nome, colaboradores, participante_ids")
    .eq("data", hoje);
  if (error) throw new Error(error.message);

  const reunioes = ((data ?? []) as unknown as ReuniaoRow[]).filter(
    (r) => (r.participante_ids ?? []).length > 0,
  );
  if (reunioes.length === 0) return { reunioes: 0, emails: 0, erros: 0 };

  // Resolve email/nome de todos os participantes de uma vez.
  const { data: usersResp, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 200,
  });
  if (usersErr) throw new Error(usersErr.message);
  const userById = new Map<string, { email: string; name: string }>();
  for (const u of usersResp.users) {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      "";
    userById.set(u.id, { email: u.email ?? "", name });
  }

  let emails = 0;
  let erros = 0;
  for (const r of reunioes) {
    const participantes = (r.participante_ids ?? [])
      .map((id) => userById.get(id))
      .filter((u): u is { email: string; name: string } => !!u && !!u.email);
    if (participantes.length === 0) continue;

    const cliente = r.responsavel_nome?.trim() || "Responsável";
    const horario = r.horario?.trim() || "sem horário definido";
    const nomes = (r.colaboradores ?? []).join(", ") || participantes.map((p) => p.name).join(", ");
    const aluno = r.aluno_nome?.trim() || "";

    const subject = `Lembrete: reunião hoje (${formatDateBR(r.data)}) — ${cliente}`;
    const linhas = [
      `<p>Você tem uma reunião agendada para <strong>hoje (${escapeHtml(formatDateBR(r.data))})</strong>.</p>`,
      `<ul>`,
      `<li><strong>Cliente:</strong> ${escapeHtml(cliente)}</li>`,
      aluno ? `<li><strong>Aluno(a):</strong> ${escapeHtml(aluno)}</li>` : "",
      `<li><strong>Horário:</strong> ${escapeHtml(horario)}</li>`,
      `<li><strong>Participantes:</strong> ${escapeHtml(nomes)}</li>`,
      `</ul>`,
    ]
      .filter(Boolean)
      .join("");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">${linhas}</div>`;
    const text = `Reunião hoje (${formatDateBR(r.data)})\nCliente: ${cliente}${aluno ? `\nAluno(a): ${aluno}` : ""}\nHorário: ${horario}\nParticipantes: ${nomes}`;

    try {
      await sendEmail(cfg, { to: participantes.map((p) => p.email), subject, html, text });
      emails += 1;
    } catch (e) {
      erros += 1;
      console.error(
        `[agenda] falha ao enviar lembrete da reunião ${r.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return { reunioes: reunioes.length, emails, erros };
}

export async function handleAgendaApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/agenda/")) return null;

  if (pathname === "/api/agenda/cron" && request.method === "GET") {
    // A Vercel envia "Authorization: Bearer <CRON_SECRET>" quando a env existe.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    try {
      const res = await enviarLembretesDoDia();
      console.log(
        `[agenda] cron: ${res.reunioes} reunião(ões) hoje, ${res.emails} email(s) enviados, ${res.erros} erro(s).`,
      );
      return json({ ok: true, ...res });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[agenda] cron falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}
