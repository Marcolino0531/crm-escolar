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
//   GET  /api/whatsapp/cron/tentativa-{2,3,4}
//                               — mesma rotina, repetida às 12h, 15h e 18h: se a tentativa
//                                 anterior se perdeu (deploy na hora do agendamento, timeout,
//                                 erro do Sponte), a seguinte cobre o dia. Não duplica envio:
//                                 o responsável já cobrado hoje é pulado. Toda execução — até
//                                 as que não enviam nada — fica em `whatsapp_cron_runs`.
//   GET  /api/whatsapp/cron/lembretes[-2]
//                               — régua PREVENTIVA (Lembretes Automáticos): lembra o
//                                 responsável 5 dias antes, 3 dias antes e no dia do
//                                 vencimento de cada parcela em aberto. Roda depois da
//                                 cobrança, que tem prioridade no mesmo dia/responsável.
//   GET  /api/whatsapp/webhook  — verificação do webhook (hub.challenge da Meta).
//   POST /api/whatsapp/webhook  — eventos de status (enviado/entregue/lido/falha).
//
// Os disparos gravam em `whatsapp_billing_logs`; os eventos do webhook atualizam
// o status por `wa_message_id` (wamid retornado no envio).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { onlyDigits } from "@/lib/phone";
import {
  buscarLinhaDigitavelPorUnidade,
  buscarResponsavelFinanceiroAluno,
  coletarDividaAbertaAluno,
  coletarPendenciasPorVencimento,
  paraYMD,
  type BoletoAberto,
} from "@/lib/sponte.functions";
import {
  cobrancaPermitida,
  envioLiberado,
  menorDataBaseCobranca,
  unidadesAtendidas,
} from "@/lib/billing-unidades";
import {
  getWhatsAppConfig,
  getWhatsAppConfigDoGrupo,
  getWhatsAppSendConfig,
  getWhatsAppSendConfigDoGrupo,
  getNumerosPublicos,
  getMediaUrl,
  downloadMedia,
  renderBillingMessage,
  renderBillingMessageMultipla,
  renderReminderMessage,
  sendBillingTemplate,
  sendBillingTemplateMultipla,
  sendReminderTemplate,
  sendRematriculaTemplate,
  type WhatsAppConfig,
  type WhatsAppSendConfig,
} from "@/lib/whatsapp.server";
import { findConversaBySuffix, registrarTemplateNoChat } from "@/lib/whatsapp.chatlog";
import { addDaysYMD, isDiaUtil } from "@/lib/billing-schedule";
import { parcelasVencidas, valorAtualizadoParcela } from "@/lib/billing-debt";
import {
  agruparPorResponsavel,
  comporLinhasDigitaveis,
  jaCobradoHoje,
  parcelasCobraveis,
  resolverContatoResponsavel,
  vencimentosEntrandoEmCobranca,
  type GrupoCobranca,
  type ItemBoletoLinha,
  type ParcelaCobranca,
} from "@/lib/billing-recurrence";
import {
  filtrarPorAcordo,
  filtrarPorAcordoDoAluno,
  mapaExcecoes,
  type ExcecaoCobranca,
} from "@/lib/billing-exceptions";
import { filtrarPorPausa, pausasVigentes, type PausaComprovante } from "@/lib/billing-pauses";
import {
  agruparLembretesPorResponsavel,
  etiquetaPrazo,
  filtrarPorPrioridadeCobranca,
  rotuloPrazo,
  vencimentosLembreteHoje,
  type GrupoLembrete,
  type ParcelaLembrete,
} from "@/lib/billing-reminders";
import { parseSystemEvent, decideSystemAction } from "@/lib/whatsapp-system";
import { grupoDaUnidade, grupoDoPhoneNumberId, type NumeroGrupo } from "@/lib/whatsapp-numeros";
import { parseReacao } from "@/lib/whatsapp-reacoes";
import {
  slotDaRota,
  slotLembreteDaRota,
  slotRematriculaDaRota,
  type StatusExecucao,
} from "@/lib/billing-cron-runs";
import { montarLinhasAcompanhamento } from "@/lib/rematricula-acompanhamento";
import {
  chaveLembrete,
  contarPorTemplate,
  ehSextaFeira,
  filtrarJaLembrados,
  renderRematriculaMessage,
  selecionarLembretesRematricula,
  type LembreteRematricula,
} from "@/lib/rematricula-lembretes";
import {
  BASE_URL_PORTAL,
  anoLetivoConfigurado,
  carregarAcompanhamentoUnidade,
} from "@/lib/rematricula.functions";
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

// Grupos de unidade com número da Cloud API configurado no ambiente.
function gruposConfigurados(): NumeroGrupo[] {
  return [...new Set(getNumerosPublicos().map((n) => n.grupo))];
}

// Grupos que disparam de verdade hoje: número configurado E envio liberado (ver
// billing-unidades). A simulação avalia qualquer grupo configurado.
function gruposEmOperacao(): NumeroGrupo[] {
  return gruposConfigurados().filter(envioLiberado);
}

// Opções das rotinas diárias. `grupos` restringe as unidades avaliadas e
// `simular` executa toda a seleção SEM chamar a Cloud API e sem gravar log de
// disparo — é o dry-run usado para conferir o volume antes de ligar um número.
interface OpcoesRotina {
  grupos?: NumeroGrupo[];
  simular?: boolean;
}

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

// Régua de origem do disparo, gravada em `whatsapp_billing_logs.tipo`. Separa o
// histórico das duas abas e impede que quem recebeu lembrete preventivo entre na
// régua de cobrança pelo histórico.
type TipoDisparo = "cobranca" | "lembrete" | "rematricula";

// Coluna ausente no Postgres (migration ainda não aplicada em produção).
function erroColunaInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

// Grava o log do disparo. Se as colunas da régua preventiva ainda não existirem,
// regrava sem elas: um disparo real não pode ficar sem registro por causa de uma
// migration pendente.
async function inserirBillingLog(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("whatsapp_billing_logs" as never).insert(row as never);
  if (!error) return;
  if (!erroColunaInexistente(error)) {
    console.error("[whatsapp] falha ao gravar o log do disparo:", error.message);
    return;
  }
  const legado = { ...row };
  delete legado.tipo;
  delete legado.prazo_lembrete;
  delete legado.data_ref;
  delete legado.status_rematricula;
  const { error: erroLegado } = await supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .insert(legado as never);
  if (erroLegado) {
    console.error("[whatsapp] falha ao gravar o log do disparo:", erroLegado.message);
  }
}

// Autorização da simulação: o segredo do cron (chamada automatizada) ou uma
// sessão de ADMINISTRADOR do School Hub. A rota é somente leitura, mas expõe
// volume de cobrança — não fica aberta.
async function autorizadoParaSimular(request: Request): Promise<boolean> {
  const token = bearer(request);
  if (!token) return false;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return true;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return false;
  const { data: roles, error: erroRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (erroRoles) return false;
  return (roles ?? []).some((r) => (r as { role?: string }).role === "admin");
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

  const slot = request.method === "GET" ? slotDaRota(pathname) : null;
  if (slot) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    return await runCronRegistrado(slot, runCron);
  }

  const slotLembrete = request.method === "GET" ? slotLembreteDaRota(pathname) : null;
  if (slotLembrete) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    return await runCronRegistrado(slotLembrete, runCronLembretes);
  }

  const slotRematricula = request.method === "GET" ? slotRematriculaDaRota(pathname) : null;
  if (slotRematricula) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    return await runCronRegistrado(slotRematricula, runCronRematricula);
  }

  // Simulação (dry-run) das duas réguas: roda toda a seleção do dia e devolve só
  // contagens por template e unidade, sem chamar a Cloud API e sem gravar
  // disparo. Serve para conferir o volume antes de liberar um número novo.
  if (pathname === "/api/whatsapp/simulacao" && request.method === "GET") {
    if (!(await autorizadoParaSimular(request))) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    const pedido = url.searchParams.get("grupo");
    const grupos = pedido ? gruposConfigurados().filter((g) => g === pedido) : gruposConfigurados();
    if (grupos.length === 0) {
      return json({ ok: false, error: "nenhum número configurado para o grupo pedido" }, 400);
    }
    const dia = url.searchParams.get("dia");
    if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return json({ ok: false, error: "dia inválido (use YYYY-MM-DD)" }, 400);
    }
    const hoje = dia || diaYMD(0);
    // ?rotina=rematricula: só o lembrete semanal de rematrícula (volume por
    // template e por unidade da sexta-feira pedida).
    if (url.searchParams.get("rotina") === "rematricula") {
      const rematricula = await runCronRematricula(hoje, { grupos, simular: true });
      return json({ ok: true, hoje, grupos, rematricula });
    }
    const [cobranca, lembretes] = await Promise.all([
      runCron(hoje, { grupos, simular: true }),
      runCronLembretes(hoje, { grupos, simular: true }),
    ]);
    return json({ ok: true, hoje, grupos, cobranca, lembretes });
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
async function runCron(hoje: string, opcoes: OpcoesRotina = {}): Promise<ResultadoCron> {
  if (!getWhatsAppConfig()) {
    throw new Error(
      "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE_NAME).",
    );
  }

  const gruposAlvo = opcoes.grupos ?? gruposEmOperacao();
  const unidades = unidadesAtendidas(gruposAlvo);
  if (unidades.size === 0) {
    return { status: "sem_envio", motivo: "nenhuma unidade com envio automático ativo" };
  }

  // Não dispara aos sábados, domingos e feriados nacionais (ver billing-schedule).
  if (!isDiaUtil(hoje)) {
    return { status: "nao_util", motivo: "dia não útil (fim de semana/feriado)" };
  }

  // Kill switch: se os envios foram pausados hoje, não dispara nada.
  if (await envioPausadoHoje(hoje)) {
    return { status: "pausado", motivo: "envios pausados para hoje (kill switch)" };
  }

  const candidatos = await coletarCandidatos(hoje, gruposAlvo);
  if (candidatos.length === 0) {
    return { status: "sem_envio", motivo: "nenhum aluno em cobrança" };
  }

  // Alunos com acordo de parcelamento: as parcelas vencidas até o mês de
  // referência saem da régua (do disparo e do total anunciado).
  const excecoes = await carregarExcecoesAcordo();

  // Pausas de 24h por comprovante recebido no Atendimento.
  const pausas = await carregarPausasComprovante();

  // Reconsulta a dívida de cada candidato no Sponte: quem pagou desaparece daqui.
  // Em lotes concorrentes para caber no tempo de execução do cron.
  const cobraveis: ParcelaCobranca[] = [];
  const vencidasPorAluno = new Map<string, BoletoAberto[]>();
  const linhaPorAluno = new Map<string, ItemBoletoLinha>();
  for (let i = 0; i < candidatos.length; i += CONCORRENCIA_SPONTE) {
    const lote = candidatos.slice(i, i + CONCORRENCIA_SPONTE);
    // Dívida E responsável financeiro reconsultados juntos: o candidato vindo do
    // histórico traz o contato do disparo anterior, que fica obsoleto assim que a
    // escola troca o responsável no Sponte.
    const resultados = await Promise.all(
      lote.map(async (c) => {
        const [divida, respSponte] = await Promise.all([
          coletarDividaAbertaAluno(c.unidade, c.alunoId),
          buscarResponsavelFinanceiroAluno(c.unidade, c.alunoId),
        ]);
        return { candidato: c, divida, respSponte };
      }),
    );
    for (const { candidato: c, divida, respSponte } of resultados) {
      if (!divida) continue;
      const contato = resolverContatoResponsavel(
        { nome: c.responsavelNome, telefone: c.telefone },
        respSponte,
      );
      if (contato.trocou) {
        console.log(
          `[whatsapp] aluno ${c.alunoId}: responsável financeiro do Sponte difere do último disparo — cobrança redirecionada.`,
        );
      }
      if (!contato.telefone || contato.telefone === "-") {
        console.warn(
          `[whatsapp] aluno ${c.alunoId}: responsável financeiro sem telefone no Sponte — sem disparo hoje.`,
        );
      }
      // Só entram no total anunciado (e no disparo) os boletos que a regra da
      // unidade permite cobrar — no Belvedere/Vale do Sereno, mensalidade a
      // partir de setembro/2026.
      const permitidos = divida.boletos.filter((b) =>
        cobrancaPermitida({
          unidade: c.unidade,
          vencimento: b.vencimento,
          categorias: b.categorias,
        }),
      );
      vencidasPorAluno.set(
        c.alunoId,
        filtrarPorAcordoDoAluno(c.alunoId, parcelasVencidas(permitidos, hoje), excecoes),
      );
      for (const b of permitidos) {
        cobraveis.push({
          alunoId: c.alunoId,
          alunoNome: c.alunoNome,
          unidade: c.unidade,
          telefone: contato.telefone,
          responsavelNome: contato.nome,
          vencimento: b.vencimento,
          saldo: b.saldo,
          dataPagamento: b.dataPagamento,
          categorias: b.categorias,
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
      const boleto = vencidasPorAluno.get(c.alunoId)?.at(-1);
      if (!linhas[idx] || !boleto) return;
      linhaPorAluno.set(c.alunoId, {
        alunoNome: c.alunoNome,
        valor: valorAtualizadoParcela(boleto.saldo, boleto.vencimento, hoje),
        linhaDigitavel: linhas[idx],
      });
    });
  }

  const elegiveis = filtrarPorPausa(
    parcelasCobraveis(filtrarPorAcordo(cobraveis, excecoes), hoje),
    pausas,
    new Date(),
  );
  // O agrupamento por responsável acontece DENTRO de cada número: um responsável
  // com filhos nas duas escolas recebe uma mensagem por número, e nenhuma delas
  // mistura parcelas da outra.
  const grupos: GrupoCobranca[] = [];
  for (const g of gruposAlvo) {
    const doGrupo = elegiveis.filter((p) => grupoDaUnidade(p.unidade) === g);
    if (doGrupo.length > 0) {
      grupos.push(...agruparPorResponsavel(doGrupo, hoje, vencidasPorAluno));
    }
  }
  if (grupos.length === 0) {
    return {
      status: "sem_envio",
      motivo: "nenhuma parcela cobrável hoje",
      alunos: candidatos.length,
      ...(opcoes.simular ? { simulacao: contarSimulacao([]) } : {}),
    };
  }

  // Idempotência do dia: telefones que já receberam disparo hoje (cron reexecutado).
  const telefonesHoje = await telefonesPorGrupoComDisparoHoje(hoje, "cobranca");

  if (opcoes.simular) {
    const simulados: { template: string; unidade: string; telefone: string }[] = [];
    let puladosSim = 0;
    for (const grupo of grupos) {
      const jaAtendidos = telefonesDoGrupo(telefonesHoje, grupo.unidade);
      if (jaCobradoHoje(jaAtendidos, grupo.telefone)) {
        puladosSim++;
        continue;
      }
      jaAtendidos.push(grupo.telefone);
      simulados.push({
        template: grupo.multipla ? "aviso_cobranca_multipla" : "aviso_cobranca",
        unidade: grupo.unidade,
        telefone: grupo.telefone,
      });
    }
    return {
      status: "sem_envio",
      motivo: "simulação (dry-run): nenhuma mensagem enviada",
      responsaveis: grupos.length,
      alunos: candidatos.length,
      pulados: puladosSim,
      simulacao: contarSimulacao(simulados),
    };
  }

  let enviados = 0;
  let falhas = 0;
  let pulados = 0;
  for (const grupo of grupos) {
    const jaAtendidos = telefonesDoGrupo(telefonesHoje, grupo.unidade);
    if (jaCobradoHoje(jaAtendidos, grupo.telefone)) {
      pulados++;
      continue;
    }
    jaAtendidos.push(grupo.telefone);
    const r = await dispararGrupo(grupo, hoje, linhaPorAluno);
    enviados += r.enviado ? 1 : 0;
    falhas += r.enviado ? 0 : 1;
  }

  console.log(
    `[whatsapp] cron ${hoje}: ${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s) em ${grupos.length} responsável(is).`,
  );
  return {
    status: enviados > 0 || falhas > 0 ? "ok" : "sem_envio",
    motivo: enviados === 0 && falhas === 0 ? "todos os responsáveis já cobrados hoje" : null,
    responsaveis: grupos.length,
    alunos: candidatos.length,
    enviados,
    falhas,
    pulados,
  };
}

interface ResultadoCron {
  status: Exclude<StatusExecucao, "em_andamento" | "erro">;
  motivo?: string | null;
  responsaveis?: number;
  alunos?: number;
  enviados?: number;
  falhas?: number;
  pulados?: number;
  // Preenchido só no dry-run: quantas mensagens sairiam, por template e por
  // unidade. Nenhum dado pessoal — apenas contagens.
  simulacao?: {
    porTemplate: Record<string, number>;
    porUnidade: Record<string, number>;
    semTelefone: number;
  };
}

// Contagem do dry-run: uma entrada por mensagem que sairia, agrupada por
// template e unidade.
function contarSimulacao(
  itens: { template: string; unidade: string; telefone: string }[],
): NonNullable<ResultadoCron["simulacao"]> {
  const porTemplate: Record<string, number> = {};
  const porUnidade: Record<string, number> = {};
  let semTelefone = 0;
  for (const i of itens) {
    if (!i.telefone || i.telefone === "-") {
      semTelefone++;
      continue;
    }
    porTemplate[i.template] = (porTemplate[i.template] ?? 0) + 1;
    porUnidade[i.unidade || "(sem unidade)"] = (porUnidade[i.unidade || "(sem unidade)"] ?? 0) + 1;
  }
  return { porTemplate, porUnidade, semTelefone };
}

// Executa a tentativa do dia registrando-a em `whatsapp_cron_runs`.
//
// A inserção da linha (data_ref, slot) é a própria trava de concorrência: se a
// mesma tentativa já está registrada, esta execução não roda de novo. Uma
// tentativa perdida ou com erro fica gravada com o motivo, e a tentativa
// seguinte do dia cobre o disparo — sem duplicar, porque quem já foi cobrado
// hoje é pulado no envio.
async function runCronRegistrado(
  slot: string,
  rotina: (hoje: string) => Promise<ResultadoCron>,
): Promise<Response> {
  const hoje = diaYMD(0);
  const inicio = Date.now();

  const { data: run, error: erroInsert } = await supabaseAdmin
    .from("whatsapp_cron_runs" as never)
    .insert({ data_ref: hoje, slot, status: "em_andamento" } as never)
    .select("id")
    .maybeSingle();

  if (erroInsert || !run) {
    console.warn(`[whatsapp] cron ${hoje} slot ${slot} já registrado — execução ignorada.`);
    return json({ ok: true, hoje, slot, ignorado: true });
  }
  const runId = (run as unknown as { id: string }).id;

  const finalizar = async (campos: Record<string, unknown>) => {
    await supabaseAdmin
      .from("whatsapp_cron_runs" as never)
      .update({
        ...campos,
        finalizado_em: new Date().toISOString(),
        duracao_ms: Date.now() - inicio,
      } as never)
      .eq("id", runId);
  };

  try {
    const r = await rotina(hoje);
    await finalizar({
      status: r.status,
      motivo: r.motivo ?? null,
      responsaveis: r.responsaveis ?? 0,
      enviados: r.enviados ?? 0,
      falhas: r.falhas ?? 0,
      pulados: r.pulados ?? 0,
    });
    return json({ ok: true, hoje, slot, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp] cron falhou:", msg);
    await finalizar({ status: "erro", erro: msg });
    return json({ ok: false, hoje, slot, error: msg }, 500);
  }
}

// Exceções vigentes por acordo (AlunoID → mês de referência YYYY-MM). Sem
// linha na tabela, o aluno é cobrado normalmente — remover a exceção não exige
// nenhum outro desfazimento.
async function carregarExcecoesAcordo(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_billing_exceptions" as never)
    .select("aluno_id, mes_referencia");
  if (error) {
    // Fail-open explícito: a falha de leitura não pode travar o disparo do dia,
    // mas fica registrada para não passar em silêncio.
    console.error("[whatsapp] falha ao ler exceções de acordo:", error.message);
    return new Map();
  }
  const rows = (data ?? []) as unknown as { aluno_id: string; mes_referencia: string }[];
  const excecoes: ExcecaoCobranca[] = rows.map((r) => ({
    alunoId: r.aluno_id,
    mesReferencia: r.mes_referencia,
  }));
  return mapaExcecoes(excecoes);
}

// Pausas de 24h vigentes ("comprovante recebido"). Nada precisa desligá-las: o
// filtro é por `expira_em`, então passado o prazo o disparo volta sozinho — e se
// a baixa entrou no Sponte nesse meio tempo, a parcela nem aparece mais aqui.
async function carregarPausasComprovante(): Promise<PausaComprovante[]> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_billing_pauses" as never)
    .select("telefone, aluno_id, expira_em")
    .gt("expira_em", new Date().toISOString());
  if (error) {
    // Fail-open explícito, como nas exceções de acordo: uma falha de leitura não
    // derruba o disparo do dia, mas fica registrada.
    console.error("[whatsapp] falha ao ler pausas por comprovante:", error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as {
    telefone: string;
    aluno_id: string | null;
    expira_em: string;
  }[];
  return pausasVigentes(
    rows.map((r) => ({ telefone: r.telefone, alunoId: r.aluno_id, expiraEm: r.expira_em })),
    new Date(),
  );
}

// Alunos a avaliar hoje: os que ENTRAM em cobrança (fim da tolerância) e os que
// já vinham sendo cobrados (histórico de disparos). Deduplicados por AlunoID.
async function coletarCandidatos(
  hoje: string,
  grupos: readonly NumeroGrupo[],
): Promise<CandidatoCobranca[]> {
  const unidades = unidadesAtendidas(grupos);
  const mapa = new Map<string, CandidatoCobranca>();

  // Já em cobrança primeiro; os dados frescos do Sponte (abaixo) prevalecem. O
  // contato de qualquer candidato é reconsultado no Sponte na hora do disparo.
  for (const c of await candidatosDoHistorico(hoje, unidades)) mapa.set(c.alunoId, c);

  const dataBaseMinima = menorDataBaseCobranca(grupos);
  const novos = vencimentosEntrandoEmCobranca(hoje).filter((v) => v >= dataBaseMinima);
  for (const vencimento of novos) {
    const pendencias = (await coletarPendenciasPorVencimento(vencimento, [...unidades])).filter(
      (p) =>
        cobrancaPermitida({
          unidade: p.unidade ?? "",
          // O vencimento agrupado vem no formato do Sponte (DD/MM/AAAA); a regra
          // por unidade compara datas em YYYY-MM-DD.
          vencimento: paraYMD(p.vencimento) || vencimento,
          categorias: p.categorias,
        }),
    );
    for (const p of pendencias) {
      mapa.set(p.alunoId, {
        alunoId: p.alunoId,
        alunoNome: p.nomeAluno || "",
        unidade: p.unidade ?? "",
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
//
// O histórico serve para descobrir QUEM avaliar, não para saber a quem enviar: o
// responsável/telefone daqui são só um fallback, sobrescritos pelo cadastro atual
// do Sponte antes do disparo.
async function candidatosDoHistorico(
  hoje: string,
  unidades: Set<string>,
): Promise<CandidatoCobranca[]> {
  const desde = addDaysYMD(hoje, -JANELA_RECORRENCIA_DIAS);
  const consulta = () =>
    supabaseAdmin
      .from("whatsapp_billing_logs" as never)
      .select("fatura_id, alunos_cobrados, aluno_name, responsavel_name, telefone, unidade")
      .gte("data_envio", `${desde}T00:00:00Z`)
      .in("status", STATUS_ENVIADO)
      .order("data_envio", { ascending: true });

  // Só disparos da régua de COBRANÇA: um lembrete preventivo não coloca o aluno
  // na recorrência de cobrança (a parcela dele nem venceu).
  const comTipo = await consulta().eq("tipo", "cobranca");
  const { data } = erroColunaInexistente(comTipo.error) ? await consulta() : comTipo;

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
  return [...mapa.values()].filter((c) => unidades.has(c.unidade));
}

// Telefones com disparo bem-sucedido hoje na régua indicada (janela do dia no
// fuso de São Paulo). É a idempotência do dia de cada régua: um lembrete
// preventivo não impede a cobrança do vencido, e vice-versa — a exclusão entre
// as duas é decidida por `filtrarPorPrioridadeCobranca`, não aqui.
async function disparosDeHoje(
  hoje: string,
  tipo: TipoDisparo,
): Promise<{ telefone: string; unidade: string }[]> {
  const consulta = () =>
    supabaseAdmin
      .from("whatsapp_billing_logs" as never)
      .select("telefone, unidade")
      .gte("data_envio", `${hoje}T00:00:00-03:00`)
      .lte("data_envio", `${hoje}T23:59:59-03:00`)
      .in("status", STATUS_ENVIADO);

  const comTipo = await consulta().eq("tipo", tipo);
  const { data } = erroColunaInexistente(comTipo.error) ? await consulta() : comTipo;
  return ((data ?? []) as unknown as { telefone: string | null; unidade: string | null }[]).map(
    (r) => ({ telefone: r.telefone ?? "", unidade: r.unidade ?? "" }),
  );
}

async function telefonesComDisparoHoje(hoje: string, tipo: TipoDisparo): Promise<string[]> {
  return (await disparosDeHoje(hoje, tipo)).map((d) => d.telefone);
}

// Idempotência do dia POR NÚMERO: cada grupo de unidades tem a sua lista de
// telefones já atendidos hoje, para um responsável com filhos nas duas escolas
// receber a mensagem de cada uma pelo número certo, em vez de a segunda ser
// engolida pela primeira.
async function telefonesPorGrupoComDisparoHoje(
  hoje: string,
  tipo: TipoDisparo,
): Promise<Map<NumeroGrupo, string[]>> {
  const mapa = new Map<NumeroGrupo, string[]>();
  for (const d of await disparosDeHoje(hoje, tipo)) {
    const grupo = grupoDaUnidade(d.unidade);
    if (!grupo) continue;
    const atual = mapa.get(grupo);
    if (atual) atual.push(d.telefone);
    else mapa.set(grupo, [d.telefone]);
  }
  return mapa;
}

function telefonesDoGrupo(mapa: Map<NumeroGrupo, string[]>, unidade: string): string[] {
  const grupo = grupoDaUnidade(unidade);
  if (!grupo) return [];
  const atual = mapa.get(grupo);
  if (atual) return atual;
  const nova: string[] = [];
  mapa.set(grupo, nova);
  return nova;
}

// Config de template do número que atende a unidade. Sem número configurado para
// o grupo dela, o disparo falha de forma explícita — mandar pelo número da outra
// escola seria pior do que não mandar.
function configDaUnidade(unidade: string): WhatsAppConfig | null {
  const grupo = grupoDaUnidade(unidade);
  return grupo ? getWhatsAppConfigDoGrupo(grupo) : null;
}

// Dispara (e registra) a mensagem diária de UM responsável.
async function dispararGrupo(
  grupo: GrupoCobranca,
  hoje: string,
  linhaPorAluno: Map<string, ItemBoletoLinha>,
): Promise<{ enviado: boolean }> {
  const cfg = configDaUnidade(grupo.unidade);
  if (!cfg) {
    await inserirBillingLog({
      responsavel_name: grupo.responsavelNome || "",
      aluno_name: grupo.alunosLabel || "",
      telefone: grupo.telefone || "",
      unidade: grupo.unidade || "",
      valor: grupo.totalAtualizado,
      vencimento: grupo.vencimentoMaisAntigo,
      template_name: "",
      fatura_id: grupo.alunoIds[0] ?? null,
      message_body: "",
      tipo: "cobranca",
      data_ref: hoje,
      status: "falha",
      erro_mensagem: `Sem número de WhatsApp configurado para a unidade "${grupo.unidade}".`,
    });
    return { enviado: false };
  }
  // Um boleto por aluno do grupo: com irmãos, a mensagem leva a linha digitável
  // de CADA um (identificada por aluno e valor), não só a do primeiro.
  // Boletos ainda não gerados não têm linha digitável no Sponte: nesse caso a
  // mensagem direciona o responsável à secretaria.
  const itens = grupo.alunoIds
    .map((id) => linhaPorAluno.get(id))
    .filter((i): i is ItemBoletoLinha => Boolean(i));
  const linhaDigitavel =
    comporLinhasDigitaveis(itens) || "Entre em contato com a secretaria da escola";

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
    tipo: "cobranca",
    data_ref: hoje,
  };

  if (!grupo.telefone || grupo.telefone === "-") {
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: "Responsável sem telefone cadastrado no Sponte.",
    });
    return { enviado: false };
  }

  try {
    const { messageId } = await enviar();
    await inserirBillingLog({ ...base, status: "enviado", wa_message_id: messageId });
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
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: e instanceof Error ? e.message : String(e),
    });
    return { enviado: false };
  }
}

// ─── Cron: lembretes preventivos (D-5, D-3 e D-0) ─────────────────────────────
//
// Régua oposta à da cobrança: aqui a parcela ainda NÃO venceu. Fluxo do dia:
//   1. Uma consulta ao Sponte por prazo (hoje+5, hoje+3 e hoje), que devolve as
//      parcelas EM ABERTO daquele vencimento — quem pagou antes simplesmente não
//      aparece, e o lembrete daquele prazo não sai.
//   2. As parcelas são agrupadas por responsável, que recebe UM lembrete no dia,
//      pelo prazo mais urgente.
//   3. Quem já é cobrado hoje por algo vencido fica de fora: cobrança tem
//      prioridade sobre o lembrete preventivo.
async function runCronLembretes(hoje: string, opcoes: OpcoesRotina = {}): Promise<ResultadoCron> {
  if (!getWhatsAppConfig()) {
    throw new Error(
      "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE_NAME).",
    );
  }

  const gruposAlvo = opcoes.grupos ?? gruposEmOperacao();
  const unidades = unidadesAtendidas(gruposAlvo);
  if (unidades.size === 0) {
    return { status: "sem_envio", motivo: "nenhuma unidade com envio automático ativo" };
  }

  if (!isDiaUtil(hoje)) {
    return { status: "nao_util", motivo: "dia não útil (fim de semana/feriado)" };
  }
  if (await envioPausadoHoje(hoje)) {
    return { status: "pausado", motivo: "envios pausados para hoje (kill switch)" };
  }

  // A régua preventiva NÃO tem data base por unidade: ela só fala de parcela a
  // vencer, então nada nela é retroativo (ver billing-unidades).
  const parcelas: ParcelaLembrete[] = [];
  for (const { venc } of vencimentosLembreteHoje(hoje)) {
    const pendencias = await coletarPendenciasPorVencimento(venc, [...unidades]);
    for (const p of pendencias) {
      parcelas.push({
        alunoId: p.alunoId,
        alunoNome: p.nomeAluno || "",
        unidade: p.unidade ?? "",
        telefone: p.telefone || "",
        responsavelNome: p.nomeResponsavel || "",
        // Vencimento da consulta, não o do boleto agrupado: a busca é por um dia
        // específico, então é ele que define o prazo do lembrete.
        vencimento: venc,
        saldo: p.valorTotalBoleto,
        linhaDigitavel: p.linhaDigitavel ?? "",
      });
    }
  }

  const alunos = new Set(parcelas.map((p) => p.alunoId)).size;
  const comCobrancaHoje = await telefonesComDisparoHoje(hoje, "cobranca");
  const pausas = await carregarPausasComprovante();
  const semPausa = filtrarPorPausa(parcelas, pausas, new Date());
  const grupos: GrupoLembrete[] = [];
  for (const g of gruposAlvo) {
    const doGrupo = semPausa.filter((p) => grupoDaUnidade(p.unidade) === g);
    if (doGrupo.length === 0) continue;
    grupos.push(
      ...filtrarPorPrioridadeCobranca(
        agruparLembretesPorResponsavel(doGrupo, hoje),
        comCobrancaHoje,
      ),
    );
  }
  if (grupos.length === 0) {
    return { status: "sem_envio", motivo: "nenhum lembrete a enviar hoje", alunos };
  }

  // Idempotência do dia: quem já recebeu lembrete hoje não recebe de novo, mesmo
  // que a rotina rode outra vez (segunda tentativa, reexecução manual).
  const lembradosHoje = await telefonesPorGrupoComDisparoHoje(hoje, "lembrete");

  if (opcoes.simular) {
    const simulados: { template: string; unidade: string; telefone: string }[] = [];
    let puladosSim = 0;
    for (const grupo of grupos) {
      const jaAtendidos = telefonesDoGrupo(lembradosHoje, grupo.unidade);
      if (jaCobradoHoje(jaAtendidos, grupo.telefone)) {
        puladosSim++;
        continue;
      }
      jaAtendidos.push(grupo.telefone);
      simulados.push({
        template: "lembrete_vencimento_boleto",
        unidade: grupo.unidade,
        telefone: grupo.telefone,
      });
    }
    return {
      status: "sem_envio",
      motivo: "simulação (dry-run): nenhuma mensagem enviada",
      responsaveis: grupos.length,
      alunos,
      pulados: puladosSim,
      simulacao: contarSimulacao(simulados),
    };
  }

  let enviados = 0;
  let falhas = 0;
  let pulados = 0;
  for (const grupo of grupos) {
    const jaAtendidos = telefonesDoGrupo(lembradosHoje, grupo.unidade);
    if (jaCobradoHoje(jaAtendidos, grupo.telefone)) {
      pulados++;
      continue;
    }
    jaAtendidos.push(grupo.telefone);
    const r = await dispararLembrete(grupo, hoje);
    enviados += r.enviado ? 1 : 0;
    falhas += r.enviado ? 0 : 1;
  }

  console.log(
    `[whatsapp] lembretes ${hoje}: ${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s) em ${grupos.length} responsável(is).`,
  );
  return {
    status: enviados > 0 || falhas > 0 ? "ok" : "sem_envio",
    motivo: enviados === 0 && falhas === 0 ? "todos os responsáveis já lembrados hoje" : null,
    responsaveis: grupos.length,
    alunos,
    enviados,
    falhas,
    pulados,
  };
}

// Dispara (e registra) o lembrete preventivo de UM responsável.
async function dispararLembrete(grupo: GrupoLembrete, hoje: string): Promise<{ enviado: boolean }> {
  const cfg = configDaUnidade(grupo.unidade);
  if (!cfg) {
    await inserirBillingLog({
      responsavel_name: grupo.responsavelNome || "",
      aluno_name: grupo.alunosLabel || "",
      telefone: grupo.telefone || "",
      unidade: grupo.unidade || "",
      valor: grupo.valorTotal,
      vencimento: grupo.vencimento,
      template_name: "",
      fatura_id: grupo.alunoIds[0] ?? null,
      message_body: "",
      tipo: "lembrete",
      prazo_lembrete: etiquetaPrazo(grupo.prazo),
      data_ref: hoje,
      status: "falha",
      erro_mensagem: `Sem número de WhatsApp configurado para a unidade "${grupo.unidade}".`,
    });
    return { enviado: false };
  }

  const linhaDigitavel = grupo.linhaDigitavel.trim()
    ? grupo.linhaDigitavel
    : "Entre em contato com a secretaria da escola";

  const vars = {
    to: grupo.telefone,
    responsavel: grupo.responsavelNome,
    aluno: grupo.alunosLabel,
    valor: formatBRL(grupo.valorTotal),
    prazo: rotuloPrazo(grupo.prazo),
    linhaDigitavel,
  };
  const messageBody = renderReminderMessage(vars);

  const base = {
    responsavel_name: grupo.responsavelNome || "",
    aluno_name: grupo.alunosLabel || "",
    telefone: grupo.telefone || "",
    unidade: grupo.unidade || "",
    valor: grupo.valorTotal,
    vencimento: grupo.vencimento,
    template_name: cfg.templateLembreteName,
    fatura_id: grupo.alunoIds[0] ?? null,
    alunos_cobrados: grupo.alunoIds.map((id) => ({
      id,
      nome: grupo.parcelas.find((p) => p.alunoId === id)?.alunoNome ?? "",
    })),
    message_body: messageBody,
    tipo: "lembrete",
    prazo_lembrete: etiquetaPrazo(grupo.prazo),
    // Dia do disparo no fuso de São Paulo: é a chave da trava de duplicidade no
    // banco (índice único por telefone + dia).
    data_ref: hoje,
  };

  if (!grupo.telefone || grupo.telefone === "-") {
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: "Responsável sem telefone cadastrado no Sponte.",
    });
    return { enviado: false };
  }

  try {
    const { messageId } = await sendReminderTemplate(cfg, vars);
    await inserirBillingLog({ ...base, status: "enviado", wa_message_id: messageId });
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
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: e instanceof Error ? e.message : String(e),
    });
    return { enviado: false };
  }
}

// ─── Lembrete SEMANAL de rematrícula ─────────────────────────────────────────────
//
// Roda uma vez por semana (sexta à tarde). Lê a MESMA coleção da tela
// "Rematrícula — Acompanhamento" de cada unidade atendida, seleciona quem está
// "Não iniciado" ou "Em andamento" (rematricula-lembretes), busca o responsável
// financeiro atual no Sponte e dispara o template daquele status pelo número da
// unidade. Cada tentativa vira uma linha em whatsapp_billing_logs (tipo
// 'rematricula') com o status do acompanhamento no momento do envio.

// Alunos já lembrados na rodada de `hoje` (retry/reexecução não duplica).
async function carregarJaLembradosRematricula(hoje: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_billing_logs" as never)
    .select("unidade, fatura_id")
    .eq("tipo", "rematricula")
    .eq("data_ref", hoje)
    .in("status", STATUS_ENVIADO);
  if (error) {
    // Fail-closed: sem conseguir ler o histórico, não dá para garantir que
    // ninguém receba duas vezes.
    throw new Error(`falha ao ler o histórico de lembretes de rematrícula: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as { unidade: string; fatura_id: string | null }[];
  return new Set(
    rows.filter((r) => r.fatura_id).map((r) => chaveLembrete(r.unidade, r.fatura_id!)),
  );
}

async function runCronRematricula(hoje: string, opcoes: OpcoesRotina = {}): Promise<ResultadoCron> {
  if (!getWhatsAppConfig()) {
    throw new Error(
      "WhatsApp Cloud API não configurada (defina WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE_NAME).",
    );
  }

  const gruposAlvo = opcoes.grupos ?? gruposEmOperacao();
  const unidades = unidadesAtendidas(gruposAlvo);
  if (unidades.size === 0) {
    return { status: "sem_envio", motivo: "nenhuma unidade com envio automático ativo" };
  }

  // O agendamento já é semanal; a checagem protege uma reexecução manual fora do
  // dia e pula feriado que caia na sexta. O dry-run avalia qualquer dia.
  if (!opcoes.simular) {
    if (!ehSextaFeira(hoje)) {
      return { status: "nao_util", motivo: "lembrete de rematrícula só sai na sexta-feira" };
    }
    if (!isDiaUtil(hoje)) {
      return { status: "nao_util", motivo: "dia não útil (feriado)" };
    }
    if (await envioPausadoHoje(hoje)) {
      return { status: "pausado", motivo: "envios pausados para hoje (kill switch)" };
    }
  }

  const anoLetivo = await anoLetivoConfigurado();
  if (!anoLetivo) {
    return {
      status: "sem_envio",
      motivo: "ano letivo de referência da rematrícula não configurado",
    };
  }

  // Mesma fonte da tela de acompanhamento, unidade a unidade.
  const selecionados: LembreteRematricula[] = [];
  const errosUnidade: string[] = [];
  for (const unidade of unidades) {
    const dados = await carregarAcompanhamentoUnidade(unidade);
    if (dados.error) {
      errosUnidade.push(`${unidade}: ${dados.error}`);
      continue;
    }
    const linhas = montarLinhasAcompanhamento(dados);
    selecionados.push(...selecionarLembretesRematricula(linhas));
  }
  if (errosUnidade.length > 0 && selecionados.length === 0) {
    throw new Error(`falha ao carregar o acompanhamento: ${errosUnidade.join(" | ")}`);
  }

  const jaLembrados = opcoes.simular
    ? new Set<string>()
    : await carregarJaLembradosRematricula(hoje);
  const { pendentes, pulados } = filtrarJaLembrados(selecionados, jaLembrados);

  // Responsável financeiro ATUAL de cada aluno (mesmo cadastro da cobrança), em
  // lotes concorrentes.
  const destinatarios: (LembreteRematricula & { telefone: string; responsavelNome: string })[] = [];
  for (let i = 0; i < pendentes.length; i += CONCORRENCIA_SPONTE) {
    const lote = pendentes.slice(i, i + CONCORRENCIA_SPONTE);
    const resultados = await Promise.all(
      lote.map(async (l) => {
        const resp = await buscarResponsavelFinanceiroAluno(l.unidade, l.alunoId);
        return { ...l, telefone: resp?.telefone ?? "", responsavelNome: resp?.nome ?? "" };
      }),
    );
    destinatarios.push(...resultados);
  }

  if (opcoes.simular) {
    const simulacao = contarSimulacao(
      destinatarios.map((d) => ({
        template: d.template,
        unidade: d.unidade,
        telefone: d.telefone,
      })),
    );
    const porStatus = contarPorTemplate(selecionados);
    return {
      status: destinatarios.length > 0 ? "ok" : "sem_envio",
      motivo:
        errosUnidade.length > 0
          ? `unidades com erro: ${errosUnidade.join(" | ")}`
          : destinatarios.length === 0
            ? "nenhum aluno em Não iniciado/Em andamento"
            : null,
      alunos: selecionados.length,
      responsaveis: destinatarios.length,
      enviados: 0,
      falhas: 0,
      pulados,
      simulacao: {
        ...simulacao,
        porTemplate: {
          nao_iniciado: porStatus.nao_iniciado,
          em_andamento: porStatus.em_andamento,
          ...simulacao.porTemplate,
        },
      },
    };
  }

  let enviados = 0;
  let falhas = 0;
  for (const d of destinatarios) {
    const r = await dispararLembreteRematricula(d, hoje, String(anoLetivo));
    if (r.enviado) enviados++;
    else falhas++;
  }

  console.log(
    `[whatsapp] rematrícula ${hoje}: ${enviados} enviado(s), ${falhas} falha(s), ${pulados} pulado(s) de ${selecionados.length} aluno(s).`,
  );
  return {
    status: enviados > 0 || falhas > 0 ? "ok" : "sem_envio",
    motivo:
      enviados === 0 && falhas === 0
        ? errosUnidade.length > 0
          ? `unidades com erro: ${errosUnidade.join(" | ")}`
          : "ninguém pendente de lembrete"
        : errosUnidade.length > 0
          ? `unidades com erro: ${errosUnidade.join(" | ")}`
          : null,
    responsaveis: destinatarios.length,
    alunos: selecionados.length,
    enviados,
    falhas,
    pulados,
  };
}

// Dispara (e registra) o lembrete de rematrícula de UM aluno.
async function dispararLembreteRematricula(
  d: LembreteRematricula & { telefone: string; responsavelNome: string },
  hoje: string,
  anoLetivo: string,
): Promise<{ enviado: boolean }> {
  const cfg = configDaUnidade(d.unidade);
  const vars = {
    to: d.telefone,
    responsavel: d.responsavelNome,
    aluno: d.alunoNome,
    unidade: d.unidade,
    anoLetivo,
    link: `${BASE_URL_PORTAL}/rematricula`,
  };
  const base = {
    responsavel_name: d.responsavelNome || "",
    aluno_name: d.alunoNome || "",
    telefone: d.telefone || "",
    unidade: d.unidade || "",
    valor: 0,
    vencimento: null,
    template_name: cfg?.templatesRematricula[d.template] ?? "",
    fatura_id: d.alunoId,
    alunos_cobrados: [{ id: d.alunoId, nome: d.alunoNome }],
    message_body: cfg ? renderRematriculaMessage(d.template, vars) : "",
    tipo: "rematricula",
    status_rematricula: d.status,
    data_ref: hoje,
  };

  if (!cfg) {
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: `Sem número de WhatsApp configurado para a unidade "${d.unidade}".`,
    });
    return { enviado: false };
  }
  if (!d.telefone || d.telefone === "-") {
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: "Responsável financeiro sem telefone cadastrado no Sponte.",
    });
    return { enviado: false };
  }

  try {
    const { messageId } = await sendRematriculaTemplate(cfg, d.template, vars);
    await inserirBillingLog({ ...base, status: "enviado", wa_message_id: messageId });
    await registrarTemplateNoChat({
      telefone: d.telefone,
      waMessageId: messageId,
      body: base.message_body,
      vinculo: {
        aluno_id: d.alunoId,
        aluno_name: d.alunoNome || "",
        responsavel_name: d.responsavelNome || "",
        unidade: d.unidade || "",
      },
    });
    return { enviado: true };
  } catch (e) {
    await inserirBillingLog({
      ...base,
      status: "falha",
      erro_mensagem: e instanceof Error ? e.message : String(e),
    });
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
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  // Reação a uma mensagem existente (emoji vazio = reação removida).
  reaction?: { message_id?: string; emoji?: string };
  // Eventos administrativos (troca de número/identidade). Não é mensagem real.
  system?: {
    body?: string;
    type?: string;
    wa_id?: string;
    new_wa_id?: string;
    customer?: string;
  };
}

// Baixa a mídia (imagem/documento/áudio) da Meta pelo media_id e a armazena no bucket
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
        // Número da escola que RECEBEU o evento: define o par de unidades da
        // conversa e por qual número a resposta sai.
        metadata?: { phone_number_id?: string; display_phone_number?: string };
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
  phone_number_id?: string | null;
}

// Número da escola que recebeu o evento (metadata da Meta) e o par de unidades
// a que ele pertence — grupo null quando o número não está configurado por env.
interface NumeroReceptor {
  phoneNumberId: string | null;
  grupo: NumeroGrupo | null;
}

function numeroReceptor(phoneNumberId: string | null): NumeroReceptor {
  return {
    phoneNumberId,
    grupo: grupoDoPhoneNumberId(phoneNumberId, getNumerosPublicos()),
  };
}

// Garante a conversa da telefone (cria se não existir) e, na criação, tenta
// vincular ao cadastro do aluno. Retorna a linha para uso posterior.
async function getOrCreateConversa(
  waPhone: string,
  contactName: string,
  numero: NumeroReceptor,
): Promise<ConversaRow | null> {
  const { phoneNumberId, grupo } = numero;
  // Casa pelos últimos 8 dígitos: o wa_id da Meta e o telefone gravado no disparo
  // podem divergir no 9º dígito/DDI. Converge para uma única conversa.
  const atual = (await findConversaBySuffix(waPhone, phoneNumberId)) as ConversaRow | null;
  if (atual) {
    const patch: Record<string, string> = {};
    if (contactName && !atual.aluno_name) patch.contact_name = contactName;
    // Grava o número por onde a conversa chega (conversa antiga não tem).
    if (phoneNumberId && atual.phone_number_id !== phoneNumberId) {
      patch.phone_number_id = phoneNumberId;
      if (grupo) patch.numero_grupo = grupo;
    }
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
      phone_number_id: phoneNumberId,
      numero_grupo: grupo,
    } as never)
    .select("id, aluno_id, aluno_name, phone_number_id")
    .single();
  if (error) {
    console.warn("[whatsapp] criar conversa falhou:", error.message);
    return null;
  }
  return criada as unknown as ConversaRow;
}

// Trata um evento type:"system" (troca de número/identidade). Nunca cria
// conversa: se for troca de número e houver conversa do número antigo, migra o
// wa_phone para o novo número (preservando histórico e vínculo) e grava uma nota
// interna discreta. Qualquer outro caso (identidade, sem número novo, sem
// conversa anterior) é ignorado silenciosamente.
async function processarEventoSystem(msg: WebhookMessage, numero: NumeroReceptor): Promise<void> {
  const decision = decideSystemAction(parseSystemEvent(msg));
  if (decision.action !== "migrate") return;

  const oldDigits = onlyDigits(decision.oldWaId);
  const newDigits = onlyDigits(decision.newWaId);
  const conversa = (await findConversaBySuffix(
    oldDigits,
    numero.phoneNumberId,
  )) as ConversaRow | null;
  if (!conversa) return; // sem conversa do número antigo → nada a migrar

  if (newDigits && newDigits !== oldDigits) {
    await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .update({ wa_phone: newDigits } as never)
      .eq("id", conversa.id);
  }

  // Idempotência: não regrava a nota se a Meta reenviar o evento.
  if (msg.id) {
    const { data: jaExiste } = await supabaseAdmin
      .from("whatsapp_messages" as never)
      .select("id")
      .eq("wa_message_id", msg.id)
      .maybeSingle();
    if (jaExiste) return;
  }

  const waTs = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : null;
  await supabaseAdmin.from("whatsapp_messages" as never).insert({
    conversation_id: conversa.id,
    wa_message_id: msg.id ?? null,
    direction: "in",
    body: decision.note,
    status: "recebido",
    wa_timestamp: waTs,
    message_type: "system",
  } as never);

  // Atualiza a prévia sem incrementar não-lidas (não é comunicação real).
  await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .update({
      last_message_at: waTs ?? new Date().toISOString(),
      last_message_preview: decision.note.slice(0, 200),
      last_message_direction: "in",
    } as never)
    .eq("id", conversa.id);
}

// Cola a reação na mensagem original (por wamid). Emoji null = reação removida.
// Reação a uma mensagem que o School Hub não conhece é ignorada.
async function aplicarReacao(alvoWamid: string, emoji: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from("whatsapp_messages" as never)
    .update({ reaction_emoji: emoji } as never)
    .eq("wa_message_id", alvoWamid);
  if (error) console.warn("[whatsapp] aplicar reação falhou:", error.message);
}

// Processa as mensagens RECEBIDAS de um bloco de webhook: grava cada mensagem,
// cria/atualiza a conversa e incrementa o não-lidas.
async function processarMensagensRecebidas(
  messages: WebhookMessage[],
  contacts: WebhookContact[],
  numero: NumeroReceptor,
): Promise<void> {
  const nomePorWaId = new Map<string, string>();
  for (const c of contacts) {
    if (c.wa_id) nomePorWaId.set(onlyDigits(c.wa_id), c.profile?.name ?? "");
  }

  // A mídia é baixada com o token do número que recebeu o evento.
  const sendCfg =
    (numero.grupo ? getWhatsAppSendConfigDoGrupo(numero.grupo) : null) ?? getWhatsAppSendConfig();

  for (const msg of messages) {
    // Eventos type:"system" (troca de número/identidade) não são mensagens de
    // conversa: nunca criam conversa fantasma nem gravam "[system não suportada]".
    if (msg.type === "system") {
      await processarEventoSystem(msg, numero);
      continue;
    }

    const from = onlyDigits(msg.from);
    if (!from || !msg.id) continue;

    // Reação: cola o emoji na mensagem original, sem criar mensagem nova nem
    // marcar a conversa como não lida.
    const reacao = parseReacao(msg);
    if (reacao) {
      await aplicarReacao(reacao.alvoWamid, reacao.emoji);
      continue;
    }

    const conversa = await getOrCreateConversa(from, nomePorWaId.get(from) ?? "", numero);
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

    // Mídia (imagem/documento/áudio): baixa da Meta e armazena no storage do School Hub
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
      else if (fields.message_type === "audio") preview = "🎤 Áudio";
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

    const { error: erroConversa } = await supabaseAdmin
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
    if (erroConversa) {
      console.error(
        "[whatsapp] falha ao reabrir conversa após mensagem recebida:",
        erroConversa.message,
      );
    }
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
        await processarMensagensRecebidas(
          value.messages,
          value.contacts ?? [],
          numeroReceptor(value.metadata?.phone_number_id ?? null),
        );
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
