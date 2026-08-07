// Endpoints nativos da automação de Cobrança por WhatsApp (Cloud API da Meta).
// Montados a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET  /api/whatsapp/cron     — rotina diária (Vercel Cron 09:00 America/Sao_Paulo;
//                                 CRON_SECRET): dispara lembrete das cobranças vencidas
//                                 há 2 dias (venc. >= 01/08/2026). Só roda em dias úteis
//                                 (pula sáb/dom/feriados nacionais — ver billing-schedule);
//                                 vencimentos cujo gatilho caiu num dia não útil são
//                                 reagendados para o próximo dia útil, sem duplicar. Não
//                                 dispara se os envios do dia estiverem pausados (kill switch).
//   GET  /api/whatsapp/webhook  — verificação do webhook (hub.challenge da Meta).
//   POST /api/whatsapp/webhook  — eventos de status (enviado/entregue/lido/falha).
//
// Os disparos gravam em `whatsapp_billing_logs`; os eventos do webhook atualizam
// o status por `wa_message_id` (wamid retornado no envio).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { onlyDigits } from "@/lib/phone";
import { coletarDividaAbertaAluno, coletarPendenciasPorVencimento } from "@/lib/sponte.functions";
import {
  getWhatsAppConfig,
  renderBillingMessage,
  renderBillingMessageMultipla,
  sendBillingTemplate,
  sendBillingTemplateMultipla,
} from "@/lib/whatsapp.server";
import { findConversaBySuffix, registrarTemplateNoChat } from "@/lib/whatsapp.chatlog";
import { isDiaUtil, vencimentosParaEnvio } from "@/lib/billing-schedule";

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

const MESES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

// Nomes dos meses (pt-BR) de uma lista de vencimentos YYYY-MM-DD, únicos por
// mês/ano e ordenados. Anexa o ano quando há mais de um ano no conjunto, para
// não ficar ambíguo (ex.: "Novembro/2026 e Janeiro/2027"). Junta com ", " e " e ".
function nomesMesesAbertos(vencimentos: string[]): string {
  const chaves = new Set<string>();
  for (const v of vencimentos) {
    const [y, m] = v.split("-");
    if (y && m) chaves.add(`${y}-${m}`);
  }
  const ordenadas = [...chaves].sort();
  const anos = new Set(ordenadas.map((k) => k.slice(0, 4)));
  const rotulos = ordenadas.map((k) => {
    const [y, m] = k.split("-");
    const nome = MESES_PT[Number(m) - 1] ?? m;
    return anos.size > 1 ? `${nome}/${y}` : nome;
  });
  if (rotulos.length <= 1) return rotulos[0] ?? "";
  return `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
}

// Regra contratual de atualização de débitos em atraso (Cenário B):
//   multa de 2% (uma única vez) + juros de mora de 1% ao mês, pró rata die
// (proporcional aos dias exatos de atraso), sobre o valor original da parcela.
const MULTA_ATRASO = 0.02;
const JUROS_MORA_MES = 0.01;

// Dias entre duas datas YYYY-MM-DD (timezone-safe: usa só os componentes, sem
// new Date() local, pois a Vercel roda em UTC). Positivo = `ate` após `de`.
function diasEntreYMD(de: string, ate: string): number {
  const [fy, fm, fd] = de.split("-").map(Number);
  const [ty, tm, td] = ate.split("-").map(Number);
  if (!fy || !ty) return 0;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Valor de UMA parcela atualizado para `hojeYMD`: sem atraso devolve o original;
// vencida aplica 2% de multa + 1%/mês de juros pró rata die sobre os dias de atraso.
function valorAtualizadoParcela(original: number, vencimentoYMD: string, hojeYMD: string): number {
  const dias = diasEntreYMD(vencimentoYMD, hojeYMD);
  if (dias <= 0 || !vencimentoYMD) return original;
  const multa = original * MULTA_ATRASO;
  const juros = original * JUROS_MORA_MES * (dias / 30);
  return original + multa + juros;
}

// Soma o valor ATUALIZADO no dia do disparo de todos os boletos em aberto
// (mês vigente + anteriores), aplicando a regra contratual parcela a parcela.
function calcularTotalAtualizado(
  boletos: { vencimento: string; saldo: number }[],
  hojeYMD: string,
): number {
  const total = boletos.reduce(
    (soma, b) => soma + valorAtualizadoParcela(b.saldo, b.vencimento, hojeYMD),
    0,
  );
  return Math.round(total * 100) / 100;
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

// Unidades atendidas pela cobrança automática. O número/token de WhatsApp de
// produção é exclusivo de CEC e CEC Baby; Núcleo Belvedere e Núcleo Vale do
// Sereno terão um número próprio no futuro e NÃO recebem este disparo.
const UNIDADES_COBRANCA_AUTOMATICA = new Set(["CEC", "CEC Baby"]);

// Data base da cobrança automática: só cobra vencimentos a partir deste dia,
// para não gerar spam de pendências antigas ao ligar a automação.
const DATA_BASE_COBRANCA = "2026-08-01";

// Kill switch: envio do dia bloqueado quando `paused_date` == hoje (fuso SP).
async function envioPausadoHoje(hojeYMD: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("whatsapp_billing_pause" as never)
    .select("paused_date")
    .eq("id", "singleton")
    .maybeSingle();
  const pausedDate =
    (data as unknown as { paused_date: string | null } | null)?.paused_date ?? null;
  return pausedDate === hojeYMD;
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

// ─── Cron: dispara lembrete das cobranças vencidas há 2 dias (dias úteis) ─────
async function runCron(): Promise<Response> {
  const cfg = getWhatsAppConfig();
  if (!cfg) {
    return json({
      ok: false,
      error:
        "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE_NAME).",
    });
  }

  const hoje = diaYMD(0);

  // Não dispara aos sábados, domingos e feriados nacionais (ver billing-schedule).
  if (!isDiaUtil(hoje)) {
    return json({ ok: true, hoje, motivo: "dia não útil (fim de semana/feriado)", enviados: 0 });
  }

  // Kill switch: se os envios foram pausados hoje, não dispara nada.
  if (await envioPausadoHoje(hoje)) {
    return json({ ok: true, hoje, pausado: true, enviados: 0 });
  }

  // Vencimentos a disparar hoje: o gatilho D+2 de cada vencimento, com os que
  // caíram em fim de semana/feriado reagendados para este dia útil. Ignora
  // vencimentos anteriores à data base (evita spam de pendências antigas).
  const alvos = vencimentosParaEnvio(hoje, 2)
    .map((t) => t.vencimento)
    .filter((v) => v >= DATA_BASE_COBRANCA);

  if (alvos.length === 0) {
    return json({ ok: true, hoje, motivo: `nenhum vencimento elegível`, enviados: 0 });
  }

  let enviados = 0;
  let falhas = 0;
  let pulados = 0;
  let total = 0;
  for (const alvo of alvos) {
    const r = await processarVencimento(cfg, alvo, hoje);
    enviados += r.enviados;
    falhas += r.falhas;
    pulados += r.pulados;
    total += r.total;
  }

  console.log(
    `[whatsapp] cron ${hoje} (vencimentos ${alvos.join(", ")}): ${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s) de ${total} pendência(s).`,
  );
  return json({ ok: true, hoje, alvos, total, enviados, falhas, pulados });
}

// Dispara os lembretes de UM vencimento (`alvo`), com anti-duplicidade por
// aluno/vencimento. `hoje` é usado para atualizar o valor da dívida no disparo.
async function processarVencimento(
  cfg: NonNullable<ReturnType<typeof getWhatsAppConfig>>,
  alvo: string,
  hoje: string,
): Promise<{ enviados: number; falhas: number; pulados: number; total: number }> {
  // Restringe às unidades atendidas pelo número de produção (CEC/CEC Baby).
  const pendencias = (await coletarPendenciasPorVencimento(alvo)).filter((p) =>
    UNIDADES_COBRANCA_AUTOMATICA.has(p.unidade ?? ""),
  );

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

    // Boletos ainda não gerados não têm linha digitável no Sponte: nesse caso a
    // mensagem direciona o responsável à secretaria. Vale sempre para o boleto
    // do MÊS VIGENTE (a linha digitável do Cenário B é só a do mês vigente).
    const linhaDigitavel =
      p.linhaDigitavel && p.linhaDigitavel.trim()
        ? p.linhaDigitavel
        : "Entre em contato com a secretaria da escola";

    // Bifurcação por histórico de dívida: consulta TODOS os boletos em aberto do
    // aluno no Sponte. Cenário A = só o mês vigente → template padrão. Cenário B
    // = também há meses anteriores em aberto → template de cobrança múltipla.
    const divida = await coletarDividaAbertaAluno(p.unidade ?? "CEC", p.alunoId);
    const anteriores = (divida?.boletos ?? []).filter(
      (b) => b.vencimento && b.vencimento < vencYMD,
    );
    const multipla = anteriores.length > 0;

    let templateName: string;
    let messageBody: string;
    let valorLog: number;
    let enviar: () => Promise<{ messageId: string }>;

    if (multipla) {
      // Valor total ATUALIZADO no dia do disparo = soma, por parcela em aberto,
      // do valor original + multa 2% + juros 1%/mês pró rata die (dias de atraso
      // de cada boleto até hoje). Muda a cada dia, como esperado.
      const totalAtualizado = divida
        ? calcularTotalAtualizado(divida.boletos, hoje)
        : p.valorTotalBoleto;
      const varsMultipla = {
        to: p.telefone,
        responsavel: p.nomeResponsavel,
        aluno: p.nomeAluno,
        mesesAnteriores: nomesMesesAbertos(anteriores.map((b) => b.vencimento)),
        valorTotalAtualizado: formatBRL(totalAtualizado),
        linhaDigitavel, // só o boleto do mês vigente
      };
      templateName = cfg.templateMultiplaName;
      messageBody = renderBillingMessageMultipla(varsMultipla);
      valorLog = totalAtualizado;
      enviar = () => sendBillingTemplateMultipla(cfg, varsMultipla);
    } else {
      const vars = {
        to: p.telefone,
        responsavel: p.nomeResponsavel,
        aluno: p.nomeAluno,
        valor: formatBRL(p.valorTotalBoleto),
        vencimento: formatVencBR(vencYMD),
        linhaDigitavel,
      };
      templateName = cfg.templateName;
      messageBody = renderBillingMessage(vars);
      valorLog = p.valorTotalBoleto;
      enviar = () => sendBillingTemplate(cfg, vars);
    }

    const base = {
      responsavel_name: p.nomeResponsavel || "",
      aluno_name: p.nomeAluno || "",
      telefone: p.telefone || "",
      unidade: p.unidade || "",
      valor: valorLog,
      vencimento: vencYMD,
      template_name: templateName,
      fatura_id: p.alunoId,
      message_body: messageBody,
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
      const { messageId } = await enviar();
      enviados++;
      await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
        ...base,
        status: "enviado",
        wa_message_id: messageId,
      } as never);
      // Espelha o disparo no histórico do chat de Atendimento.
      await registrarTemplateNoChat({
        telefone: p.telefone,
        waMessageId: messageId,
        body: base.message_body,
        vinculo: {
          aluno_id: p.alunoId,
          aluno_name: p.nomeAluno || "",
          responsavel_name: p.nomeResponsavel || "",
          unidade: p.unidade || "",
        },
      });
    } catch (e) {
      falhas++;
      await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
        ...base,
        status: "falha",
        erro_mensagem: e instanceof Error ? e.message : String(e),
      } as never);
    }
  }

  return { enviados, falhas, pulados, total: pendencias.length };
}

// ─── Webhook: status dos disparos + mensagens recebidas (atendimento) ─────────
interface WebhookStatus {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string; error_data?: { details?: string } }[];
}
interface WebhookContact {
  wa_id?: string;
  profile?: { name?: string };
}
interface WebhookMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}
interface WebhookPayload {
  entry?: {
    changes?: {
      value?: {
        statuses?: WebhookStatus[];
        messages?: WebhookMessage[];
        contacts?: WebhookContact[];
      };
    }[];
  }[];
}

// Extrai o texto legível de uma mensagem recebida (texto, botão ou resposta
// interativa). Mídias/localização caem num rótulo genérico.
function extrairTexto(msg: WebhookMessage): string {
  if (msg.type === "text") return msg.text?.body ?? "";
  if (msg.type === "button") return msg.button?.text ?? "";
  if (msg.type === "interactive")
    return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  return `[${msg.type ?? "mensagem"} não suportada]`;
}

// Resolve o cadastro do aluno a partir do telefone: casa pelos últimos 8 dígitos
// (independe de formatação/DDI e do "9" adicional) com o disparo de cobrança
// mais recente para aquele número.
async function vincularAlunoPorTelefone(digits: string): Promise<{
  aluno_id: string | null;
  aluno_name: string;
  responsavel_name: string;
  unidade: string;
} | null> {
  const suffix = digits.slice(-8);
  if (suffix.length < 8) return null;
  const { data } = await supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .select("aluno_name, responsavel_name, unidade, fatura_id, data_envio")
    .ilike("telefone", `%${suffix}%`)
    .order("data_envio", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as unknown as {
    aluno_name: string | null;
    responsavel_name: string | null;
    unidade: string | null;
    fatura_id: string | null;
  } | null;
  if (!row) return null;
  return {
    aluno_id: row.fatura_id ?? null,
    aluno_name: row.aluno_name ?? "",
    responsavel_name: row.responsavel_name ?? "",
    unidade: row.unidade ?? "",
  };
}

interface ConversaRow {
  id: string;
  aluno_id: string | null;
  aluno_name: string;
}

// Garante a conversa da telefone (cria se não existir) e, na criação, tenta
// vincular ao cadastro do aluno. Retorna a linha para uso posterior.
async function getOrCreateConversa(
  waPhone: string,
  contactName: string,
): Promise<ConversaRow | null> {
  // Casa pelos últimos 8 dígitos: o wa_id da Meta e o telefone gravado no disparo
  // podem divergir no 9º dígito/DDI. Converge para uma única conversa.
  const atual = (await findConversaBySuffix(waPhone)) as ConversaRow | null;
  if (atual) {
    const patch: Record<string, string> = {};
    if (contactName && !atual.aluno_name) patch.contact_name = contactName;
    // Auto-reparo do vínculo: se a conversa ainda não está ligada a um aluno,
    // tenta de novo — a cobrança que identifica o telefone pode ter sido
    // registrada depois de a conversa já existir (ex.: pai que escreveu antes).
    let vinculoAplicado: { aluno_id: string; aluno_name: string } | null = null;
    if (!atual.aluno_id) {
      const vinculo = await vincularAlunoPorTelefone(waPhone);
      if (vinculo?.aluno_id) {
        patch.aluno_id = vinculo.aluno_id;
        patch.aluno_name = vinculo.aluno_name;
        patch.responsavel_name = vinculo.responsavel_name;
        patch.unidade = vinculo.unidade;
        vinculoAplicado = { aluno_id: vinculo.aluno_id, aluno_name: vinculo.aluno_name };
      }
    }
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin
        .from("whatsapp_conversations" as never)
        .update(patch as never)
        .eq("id", atual.id);
    }
    if (vinculoAplicado) {
      return {
        ...atual,
        aluno_id: vinculoAplicado.aluno_id,
        aluno_name: vinculoAplicado.aluno_name,
      };
    }
    return atual;
  }

  const vinculo = await vincularAlunoPorTelefone(waPhone);
  const { data: criada, error } = await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .insert({
      wa_phone: waPhone,
      contact_name: contactName || "",
      aluno_id: vinculo?.aluno_id ?? null,
      aluno_name: vinculo?.aluno_name ?? "",
      responsavel_name: vinculo?.responsavel_name ?? "",
      unidade: vinculo?.unidade ?? "",
    } as never)
    .select("id, aluno_id, aluno_name")
    .single();
  if (error) {
    console.warn("[whatsapp] criar conversa falhou:", error.message);
    return null;
  }
  return criada as unknown as ConversaRow;
}

// Processa as mensagens RECEBIDAS de um bloco de webhook: grava cada mensagem,
// cria/atualiza a conversa e incrementa o não-lidas.
async function processarMensagensRecebidas(
  messages: WebhookMessage[],
  contacts: WebhookContact[],
): Promise<void> {
  const nomePorWaId = new Map<string, string>();
  for (const c of contacts) {
    if (c.wa_id) nomePorWaId.set(onlyDigits(c.wa_id), c.profile?.name ?? "");
  }

  for (const msg of messages) {
    const from = onlyDigits(msg.from);
    if (!from || !msg.id) continue;

    const conversa = await getOrCreateConversa(from, nomePorWaId.get(from) ?? "");
    if (!conversa) continue;

    const body = extrairTexto(msg);
    const waTs = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : null;

    // Idempotência: não regrava a mesma mensagem se a Meta reenviar o evento.
    const { data: jaExiste } = await supabaseAdmin
      .from("whatsapp_messages" as never)
      .select("id")
      .eq("wa_message_id", msg.id)
      .maybeSingle();
    if (jaExiste) continue;

    await supabaseAdmin.from("whatsapp_messages" as never).insert({
      conversation_id: conversa.id,
      wa_message_id: msg.id,
      direction: "in",
      body,
      status: "recebido",
      wa_timestamp: waTs,
    } as never);

    const { data: conv } = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .select("unread_count")
      .eq("id", conversa.id)
      .maybeSingle();
    const unread = (conv as unknown as { unread_count: number } | null)?.unread_count ?? 0;

    await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .update({
        last_message_at: waTs ?? new Date().toISOString(),
        last_message_preview: body.slice(0, 200),
        last_message_direction: "in",
        unread_count: unread + 1,
        // Nova mensagem do responsável traz a conversa de volta para "Gerais".
        archived: false,
      } as never)
      .eq("id", conversa.id);
  }
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

// Atualiza o status de uma mensagem 'out' do chat de atendimento por wamid,
// respeitando a não-regressão do ciclo (mesma regra dos disparos de cobrança).
async function atualizarStatusChat(
  wamid: string,
  mapped: string,
  st: WebhookStatus,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("whatsapp_messages" as never)
    .select("id, status")
    .eq("wa_message_id", wamid)
    .maybeSingle();
  const row = data as unknown as { id: string; status: string } | null;
  if (!row) return;
  if (mapped !== "falha" && (STATUS_RANK[mapped] ?? 0) <= (STATUS_RANK[row.status] ?? -1)) return;

  const patch: { status: string; erro_mensagem?: string } = { status: mapped };
  if (mapped === "falha") {
    const err = st.errors?.[0];
    patch.erro_mensagem =
      err?.error_data?.details || err?.message || err?.title || "Falha reportada pela Meta.";
  }
  await supabaseAdmin
    .from("whatsapp_messages" as never)
    .update(patch as never)
    .eq("id", row.id);
}

async function processarWebhook(payload: WebhookPayload | null): Promise<void> {
  if (!payload?.entry) return;
  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (value?.messages?.length) {
        await processarMensagensRecebidas(value.messages, value.contacts ?? []);
      }
      for (const st of value?.statuses ?? []) {
        const wamid = st.id;
        const mapped = st.status ? STATUS_MAP[st.status] : undefined;
        if (!wamid || !mapped) continue;

        // Status pode se referir a um disparo de cobrança e/ou a uma resposta do
        // chat — atualiza ambos (o wamid casa em uma das tabelas).
        await atualizarStatusChat(wamid, mapped, st);

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
