// Endpoints nativos da automação de Cobrança por WhatsApp (Cloud API da Meta).
// Montados a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET  /api/whatsapp/cron     — rotina diária (Vercel Cron 09:00 America/Sao_Paulo;
//                                 CRON_SECRET): cobrança RECORRENTE das parcelas vencidas
//                                 (venc. >= 01/08/2026) após 2 DIAS ÚTEIS de tolerância,
//                                 repetida todo dia útil até o Sponte registrar o pagamento.
//                                 Uma única mensagem por responsável por dia, agregando
//                                 todas as parcelas/alunos. Não roda em sáb/dom/feriados
//                                 (ver billing-schedule) nem com o kill switch ligado.
//   GET  /api/whatsapp/webhook  — verificação do webhook (hub.challenge da Meta).
//   POST /api/whatsapp/webhook  — eventos de status (enviado/entregue/lido/falha).
//
// Os disparos gravam em `whatsapp_billing_logs`; os eventos do webhook atualizam
// o status por `wa_message_id` (wamid retornado no envio).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { onlyDigits } from "@/lib/phone";
import {
  buscarLinhaDigitavelPorUnidade,
  coletarDividaAbertaAluno,
  coletarPendenciasPorVencimento,
  type BoletoAberto,
} from "@/lib/sponte.functions";
import {
  getWhatsAppConfig,
  getWhatsAppSendConfig,
  getMediaUrl,
  downloadMedia,
  renderBillingMessage,
  renderBillingMessageMultipla,
  sendBillingTemplate,
  sendBillingTemplateMultipla,
  type WhatsAppSendConfig,
} from "@/lib/whatsapp.server";
import { findConversaBySuffix, registrarTemplateNoChat } from "@/lib/whatsapp.chatlog";
import { addDaysYMD, isDiaUtil } from "@/lib/billing-schedule";
import { parcelasVencidas } from "@/lib/billing-debt";
import {
  agruparPorResponsavel,
  jaCobradoHoje,
  parcelasCobraveis,
  vencimentosEntrandoEmCobranca,
  type GrupoCobranca,
  type ParcelaCobranca,
} from "@/lib/billing-recurrence";
import {
  parseIncomingMessage,
  buildMessageFields,
  mediaStoragePath,
  type StoredMedia,
} from "@/lib/whatsapp-media";

// Bucket (privado) do storage do School Hub para as imagens recebidas no chat.
const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

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

// Janela do histórico de disparos usada para reavaliar quem continua devendo.
// Cobre com folga o ciclo de uma dívida sem varrer o histórico inteiro.
const JANELA_RECORRENCIA_DIAS = 120;

// Consultas simultâneas ao Sponte na reavaliação diária das dívidas.
const CONCORRENCIA_SPONTE = 5;

// Status que caracterizam disparo bem-sucedido (inclui o legado 'sucesso').
const STATUS_ENVIADO = ["enviado", "entregue", "lido", "sucesso"];

// Aluno a ser reavaliado no Sponte no disparo de hoje.
interface CandidatoCobranca {
  alunoId: string;
  alunoNome: string;
  unidade: string;
  telefone: string;
  responsavelNome: string;
}

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

// ─── Cron: cobrança recorrente diária, agrupada por responsável ───────────────
//
// Fluxo do dia (só em dia útil e com o kill switch desligado):
//   1. Novos devedores: vencimentos cuja tolerância de 2 DIAS ÚTEIS termina hoje.
//   2. Devedores em cobrança: alunos dos disparos recentes (histórico de logs),
//      reavaliados no Sponte — quem quitou sai da régua no mesmo dia.
//   3. Cada aluno candidato tem a dívida reconsultada; sobram as parcelas em
//      aberto, vencidas e fora da tolerância.
//   4. As parcelas são agrupadas por RESPONSÁVEL: uma única mensagem por dia,
//      mesmo com várias parcelas e/ou vários alunos.
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

  const candidatos = await coletarCandidatos(hoje);
  if (candidatos.length === 0) {
    return json({ ok: true, hoje, motivo: "nenhum aluno em cobrança", enviados: 0 });
  }

  // Reconsulta a dívida de cada candidato no Sponte: quem pagou desaparece daqui.
  // Em lotes concorrentes para caber no tempo de execução do cron.
  const cobraveis: ParcelaCobranca[] = [];
  const vencidasPorAluno = new Map<string, BoletoAberto[]>();
  const linhaPorAluno = new Map<string, string>();
  for (let i = 0; i < candidatos.length; i += CONCORRENCIA_SPONTE) {
    const lote = candidatos.slice(i, i + CONCORRENCIA_SPONTE);
    const resultados = await Promise.all(
      lote.map(async (c) => ({
        candidato: c,
        divida: await coletarDividaAbertaAluno(c.unidade, c.alunoId),
      })),
    );
    for (const { candidato: c, divida } of resultados) {
      if (!divida) continue;
      vencidasPorAluno.set(c.alunoId, parcelasVencidas(divida.boletos, hoje));
      for (const b of divida.boletos) {
        cobraveis.push({
          alunoId: c.alunoId,
          alunoNome: c.alunoNome,
          unidade: c.unidade,
          telefone: c.telefone,
          responsavelNome: c.responsavelNome,
          vencimento: b.vencimento,
          saldo: b.saldo,
          dataPagamento: b.dataPagamento,
        });
      }
    }
    // Linha digitável do boleto vencido mais recente de cada aluno (mês vigente).
    const linhas = await Promise.all(
      lote.map((c) => {
        const maisRecente = vencidasPorAluno.get(c.alunoId)?.at(-1);
        if (!maisRecente) return Promise.resolve("");
        return buscarLinhaDigitavelPorUnidade(
          c.unidade,
          maisRecente.contaReceberID,
          maisRecente.numeroParcela,
        );
      }),
    );
    lote.forEach((c, idx) => {
      if (linhas[idx]) linhaPorAluno.set(c.alunoId, linhas[idx]);
    });
  }

  const grupos = agruparPorResponsavel(
    parcelasCobraveis(cobraveis, hoje, DATA_BASE_COBRANCA),
    hoje,
    vencidasPorAluno,
  );
  if (grupos.length === 0) {
    return json({ ok: true, hoje, motivo: "nenhuma parcela cobrável hoje", enviados: 0 });
  }

  // Idempotência do dia: telefones que já receberam disparo hoje (cron reexecutado).
  const telefonesHoje = await telefonesJaCobradosHoje(hoje);

  let enviados = 0;
  let falhas = 0;
  let pulados = 0;
  for (const grupo of grupos) {
    if (jaCobradoHoje(telefonesHoje, grupo.telefone)) {
      pulados++;
      continue;
    }
    telefonesHoje.push(grupo.telefone);
    const r = await dispararGrupo(cfg, grupo, hoje, linhaPorAluno);
    enviados += r.enviado ? 1 : 0;
    falhas += r.enviado ? 0 : 1;
  }

  console.log(
    `[whatsapp] cron ${hoje}: ${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s) em ${grupos.length} responsável(is).`,
  );
  return json({
    ok: true,
    hoje,
    responsaveis: grupos.length,
    alunos: candidatos.length,
    enviados,
    falhas,
    pulados,
  });
}

// Alunos a avaliar hoje: os que ENTRAM em cobrança (fim da tolerância) e os que
// já vinham sendo cobrados (histórico de disparos). Deduplicados por AlunoID.
async function coletarCandidatos(hoje: string): Promise<CandidatoCobranca[]> {
  const mapa = new Map<string, CandidatoCobranca>();

  // Já em cobrança primeiro; os dados frescos do Sponte (abaixo) prevalecem.
  for (const c of await candidatosDoHistorico(hoje)) mapa.set(c.alunoId, c);

  const novos = vencimentosEntrandoEmCobranca(hoje).filter((v) => v >= DATA_BASE_COBRANCA);
  for (const vencimento of novos) {
    const pendencias = (await coletarPendenciasPorVencimento(vencimento)).filter((p) =>
      UNIDADES_COBRANCA_AUTOMATICA.has(p.unidade ?? ""),
    );
    for (const p of pendencias) {
      mapa.set(p.alunoId, {
        alunoId: p.alunoId,
        alunoNome: p.nomeAluno || "",
        unidade: p.unidade || "CEC",
        telefone: p.telefone || "",
        responsavelNome: p.nomeResponsavel || "",
      });
    }
  }

  return [...mapa.values()];
}

// Alunos com disparo bem-sucedido nos últimos `JANELA_RECORRENCIA_DIAS` dias.
// É o que sustenta a recorrência diária: enquanto a dívida existir, o aluno
// continua na régua; quitada, ele simplesmente deixa de gerar parcela cobrável.
async function candidatosDoHistorico(hoje: string): Promise<CandidatoCobranca[]> {
  const desde = addDaysYMD(hoje, -JANELA_RECORRENCIA_DIAS);
  const { data } = await supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .select("fatura_id, alunos_cobrados, aluno_name, responsavel_name, telefone, unidade")
    .gte("data_envio", `${desde}T00:00:00Z`)
    .in("status", STATUS_ENVIADO)
    .order("data_envio", { ascending: true });

  const rows = (data ?? []) as unknown as {
    fatura_id: string | null;
    alunos_cobrados: { id?: string; nome?: string }[] | null;
    aluno_name: string | null;
    responsavel_name: string | null;
    telefone: string | null;
    unidade: string | null;
  }[];

  // Ordem ascendente: o registro mais recente sobrescreve nome/telefone.
  const mapa = new Map<string, CandidatoCobranca>();
  for (const row of rows) {
    const alunos =
      row.alunos_cobrados && row.alunos_cobrados.length > 0
        ? row.alunos_cobrados
        : [{ id: row.fatura_id ?? "", nome: row.aluno_name ?? "" }];
    for (const aluno of alunos) {
      if (!aluno.id) continue;
      mapa.set(aluno.id, {
        alunoId: aluno.id,
        alunoNome: aluno.nome ?? "",
        unidade: row.unidade || "CEC",
        telefone: row.telefone ?? "",
        responsavelNome: row.responsavel_name ?? "",
      });
    }
  }
  return [...mapa.values()].filter((c) => UNIDADES_COBRANCA_AUTOMATICA.has(c.unidade));
}

// Telefones com disparo bem-sucedido hoje (janela do dia no fuso de São Paulo).
async function telefonesJaCobradosHoje(hoje: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .select("telefone")
    .gte("data_envio", `${hoje}T00:00:00-03:00`)
    .lte("data_envio", `${hoje}T23:59:59-03:00`)
    .in("status", STATUS_ENVIADO);
  return ((data ?? []) as unknown as { telefone: string | null }[]).map((r) => r.telefone ?? "");
}

// Dispara (e registra) a mensagem diária de UM responsável.
async function dispararGrupo(
  cfg: NonNullable<ReturnType<typeof getWhatsAppConfig>>,
  grupo: GrupoCobranca,
  hoje: string,
  linhaPorAluno: Map<string, string>,
): Promise<{ enviado: boolean }> {
  // Boletos ainda não gerados não têm linha digitável no Sponte: nesse caso a
  // mensagem direciona o responsável à secretaria.
  const linhaDigitavel =
    grupo.alunoIds.map((id) => linhaPorAluno.get(id)).find((l) => l && l.trim()) ??
    "Entre em contato com a secretaria da escola";

  let templateName: string;
  let messageBody: string;
  let enviar: () => Promise<{ messageId: string }>;

  if (grupo.multipla) {
    const varsMultipla = {
      to: grupo.telefone,
      responsavel: grupo.responsavelNome,
      aluno: grupo.alunosLabel,
      mesesAnteriores: nomesMesesAbertos(grupo.parcelas.map((p) => p.vencimento)),
      valorTotalAtualizado: formatBRL(grupo.totalAtualizado),
      linhaDigitavel,
    };
    templateName = cfg.templateMultiplaName;
    messageBody = renderBillingMessageMultipla(varsMultipla);
    enviar = () => sendBillingTemplateMultipla(cfg, varsMultipla);
  } else {
    const vars = {
      to: grupo.telefone,
      responsavel: grupo.responsavelNome,
      aluno: grupo.alunosLabel,
      valor: formatBRL(grupo.totalAtualizado),
      vencimento: formatVencBR(grupo.vencimentoMaisAntigo),
      linhaDigitavel,
    };
    templateName = cfg.templateName;
    messageBody = renderBillingMessage(vars);
    enviar = () => sendBillingTemplate(cfg, vars);
  }

  const base = {
    responsavel_name: grupo.responsavelNome || "",
    aluno_name: grupo.alunosLabel || "",
    telefone: grupo.telefone || "",
    unidade: grupo.unidade || "",
    valor: grupo.totalAtualizado,
    vencimento: grupo.vencimentoMaisAntigo,
    template_name: templateName,
    fatura_id: grupo.alunoIds[0] ?? null,
    alunos_cobrados: grupo.alunoIds.map((id) => ({
      id,
      nome: grupo.parcelas.find((p) => p.alunoId === id)?.alunoNome ?? "",
    })),
    message_body: messageBody,
  };

  if (!grupo.telefone || grupo.telefone === "-") {
    await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
      ...base,
      status: "falha",
      erro_mensagem: "Responsável sem telefone cadastrado no Sponte.",
    } as never);
    return { enviado: false };
  }

  try {
    const { messageId } = await enviar();
    await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
      ...base,
      status: "enviado",
      wa_message_id: messageId,
    } as never);
    // Espelha o disparo no histórico do chat de Atendimento.
    await registrarTemplateNoChat({
      telefone: grupo.telefone,
      waMessageId: messageId,
      body: messageBody,
      vinculo: {
        aluno_id: grupo.alunoIds[0] ?? null,
        aluno_name: grupo.alunosLabel || "",
        responsavel_name: grupo.responsavelNome || "",
        unidade: grupo.unidade || "",
      },
    });
    return { enviado: true };
  } catch (e) {
    await supabaseAdmin.from("whatsapp_billing_logs" as never).insert({
      ...base,
      status: "falha",
      erro_mensagem: e instanceof Error ? e.message : String(e),
    } as never);
    return { enviado: false };
  }
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
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

// Baixa a mídia (imagem/documento) da Meta pelo media_id e a armazena no bucket
// do School Hub. A URL da Meta expira em minutos, então o download acontece
// agora, no webhook. Retorna o caminho definitivo no storage, ou null em
// qualquer falha (media_id expirado, erro da Graph API, falha de upload) — o
// chamador grava a mensagem de erro no lugar da mídia.
async function baixarEArmazenarMidia(
  cfg: WhatsAppSendConfig,
  mediaId: string,
  filename?: string | null,
): Promise<StoredMedia | null> {
  try {
    const { url, mimeType: mimeMeta } = await getMediaUrl(cfg, mediaId);
    const { bytes, mimeType: mimeDownload } = await downloadMedia(cfg, url);
    const mime = mimeDownload || mimeMeta;
    const path = mediaStoragePath(mediaId, mime, new Date(), filename);
    const { error } = await supabaseAdmin.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .upload(path, bytes, { contentType: mime ?? undefined, upsert: true });
    if (error) {
      console.warn("[whatsapp] upload da mídia falhou:", error.message);
      return null;
    }
    return { path, mime };
  } catch (e) {
    console.warn("[whatsapp] download da mídia falhou:", e instanceof Error ? e.message : e);
    return null;
  }
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

  const sendCfg = getWhatsAppSendConfig();

  for (const msg of messages) {
    const from = onlyDigits(msg.from);
    if (!from || !msg.id) continue;

    const conversa = await getOrCreateConversa(from, nomePorWaId.get(from) ?? "");
    if (!conversa) continue;

    const parsed = parseIncomingMessage(msg);
    const waTs = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : null;

    // Idempotência: não regrava a mesma mensagem se a Meta reenviar o evento.
    const { data: jaExiste } = await supabaseAdmin
      .from("whatsapp_messages" as never)
      .select("id")
      .eq("wa_message_id", msg.id)
      .maybeSingle();
    if (jaExiste) continue;

    // Mídia (imagem/documento): baixa da Meta e armazena no storage do School Hub
    // agora (a URL da Meta expira rápido). Em qualquer falha, `stored` fica null
    // e o corpo vira a mensagem de erro definida na lib.
    let stored: StoredMedia | null = null;
    if (parsed.isMedia && parsed.mediaId && sendCfg) {
      stored = await baixarEArmazenarMidia(sendCfg, parsed.mediaId, parsed.filename);
    }
    const fields = buildMessageFields(parsed, stored);
    const body = fields.body;
    // Prévia da lista: mídia sem legenda mostra um rótulo amigável.
    let preview = body;
    if (stored && !body) {
      if (fields.message_type === "image") preview = "📷 Imagem";
      else if (fields.message_type === "document")
        preview = `📄 ${fields.media_filename ?? "Documento"}`;
    }

    await supabaseAdmin.from("whatsapp_messages" as never).insert({
      conversation_id: conversa.id,
      wa_message_id: msg.id,
      direction: "in",
      body,
      status: "recebido",
      wa_timestamp: waTs,
      message_type: fields.message_type,
      media_path: fields.media_path,
      media_mime: fields.media_mime,
      media_id: fields.media_id,
      media_filename: fields.media_filename,
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
        last_message_preview: preview.slice(0, 200),
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
