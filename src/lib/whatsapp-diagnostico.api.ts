// Rota TEMPORÁRIA de diagnóstico do segundo número da Cloud API (Núcleo
// Belvedere / Núcleo Vale do Sereno), montada a partir do server entry:
//
//   GET /api/admin/diagnostico-whatsapp
//
// Existe porque as variáveis da Vercel são "sensitive" (não podem ser lidas de
// volta nem pela API), então a única forma de conferir o segundo número é de
// dentro do runtime de produção. A rota responde apenas STATUS:
//
//   • o token autentica na Graph API e enxerga o phone_number_id configurado;
//   • qual WABA responde por esse número e se o app do School Hub está inscrito
//     nela (sem inscrição, nenhuma mensagem desse número chega ao webhook);
//   • em que situação estão os três templates de cobrança nessa WABA;
//   • se o webhook já registrou conversa/mensagem entrando por esse número.
//
// Travas: exige sessão de ADMINISTRADOR do School Hub; nunca loga, devolve ou
// grava token; o phone_number_id sai mascarado (só os 4 últimos dígitos). É
// ferramenta de checagem e sai do código depois da validação.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getNumerosWhatsApp } from "@/lib/whatsapp.server";
import type { NumeroGrupo } from "@/lib/whatsapp-numeros";

const ROTA = "/api/admin/diagnostico-whatsapp";

const TEMPLATES_COBRANCA = [
  "aviso_cobranca",
  "aviso_cobranca_multipla",
  "lembrete_vencimento_boleto",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mascarar(id: string): string {
  return id.length <= 4 ? "****" : `****${id.slice(-4)}`;
}

// Resposta genérica de propósito: a rota não conta a um chamador não autenticado
// se o problema foi o token ou a falta de permissão.
async function autorizadoComoAdmin(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = header ? (/^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "") : "";
  if (!token) return false;

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

interface GraphErro {
  erro: string;
}

async function graph<T>(url: string, token: string): Promise<T | GraphErro> {
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await resp.json()) as { error?: { message?: string } } & T;
    if (body?.error) return { erro: body.error.message ?? "erro na Graph API" };
    if (!resp.ok) return { erro: `HTTP ${resp.status}` };
    return body;
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "falha de rede na Graph API" };
  }
}

function falhou<T>(r: T | GraphErro): r is GraphErro {
  return typeof r === "object" && r !== null && "erro" in (r as GraphErro);
}

interface TemplateGraph {
  name: string;
  language: string;
  status: string;
  category?: string;
}

// Descobre a WABA do número: o nó do telefone não expõe a conta, então parte-se
// do dono do token (system user ou usuário) e procura-se a WABA que lista este
// phone_number_id.
async function acharWaba(
  phoneNumberId: string,
  token: string,
  graphVersion: string,
): Promise<{ wabaId: string } | GraphErro> {
  const explicita = (process.env.WHATSAPP_WABA_ID_BELVEDERE ?? "").trim();
  if (explicita) return { wabaId: explicita };

  const eu = await graph<{ id?: string }>(
    `https://graph.facebook.com/${graphVersion}/me?fields=id`,
    token,
  );
  if (falhou(eu)) return eu;
  if (!eu.id) return { erro: "token não devolveu o dono (me.id)" };

  const wabas = await graph<{ data?: Array<{ id: string }> }>(
    `https://graph.facebook.com/${graphVersion}/${eu.id}/assigned_whatsapp_business_accounts?fields=id&limit=50`,
    token,
  );
  if (falhou(wabas)) return wabas;

  for (const waba of wabas.data ?? []) {
    const numeros = await graph<{ data?: Array<{ id: string }> }>(
      `https://graph.facebook.com/${graphVersion}/${waba.id}/phone_numbers?fields=id&limit=50`,
      token,
    );
    if (falhou(numeros)) continue;
    if ((numeros.data ?? []).some((n) => n.id === phoneNumberId)) return { wabaId: waba.id };
  }

  return { erro: "nenhuma WABA visível para este token contém o phone_number_id configurado" };
}

async function diagnosticarNumero(
  grupo: NumeroGrupo,
  phoneNumberId: string,
  token: string,
  graphVersion: string,
) {
  const numero = await graph<{
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
  }>(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
    token,
  );

  const base = {
    grupo,
    phone_number_id: mascarar(phoneNumberId),
    token_autentica: !falhou(numero),
  };

  if (falhou(numero)) {
    return { ...base, erro: numero.erro };
  }

  const waba = await acharWaba(phoneNumberId, token, graphVersion);
  const numeroInfo = {
    ...base,
    numero: numero.display_phone_number ?? null,
    nome_verificado: numero.verified_name ?? null,
    qualidade: numero.quality_rating ?? null,
    verificacao: numero.code_verification_status ?? null,
  };

  if (falhou(waba)) {
    return { ...numeroInfo, waba: { erro: waba.erro } };
  }

  const inscritos = await graph<{ data?: Array<{ whatsapp_business_api_data?: { id?: string } }> }>(
    `https://graph.facebook.com/${graphVersion}/${waba.wabaId}/subscribed_apps`,
    token,
  );

  const templates = await graph<{ data?: TemplateGraph[] }>(
    `https://graph.facebook.com/${graphVersion}/${waba.wabaId}/message_templates?fields=name,language,status,category&limit=200`,
    token,
  );

  const cobranca = falhou(templates)
    ? { erro: templates.erro }
    : TEMPLATES_COBRANCA.reduce<Record<string, unknown>>((acc, nome) => {
        const achados = (templates.data ?? []).filter((t) => t.name === nome);
        acc[nome] = achados.length
          ? achados.map((t) => ({
              idioma: t.language,
              status: t.status,
              categoria: t.category ?? null,
            }))
          : "não existe nesta WABA";
        return acc;
      }, {});

  return {
    ...numeroInfo,
    waba: {
      id: mascarar(waba.wabaId),
      // Sem app inscrito na WABA, a Meta não entrega nada ao nosso webhook.
      apps_inscritos: falhou(inscritos) ? { erro: inscritos.erro } : (inscritos.data ?? []).length,
    },
    templates_cobranca: cobranca,
  };
}

// Evidência de recebimento: o que o webhook já gravou para cada número.
async function recebimentoNoBanco(phoneNumberId: string) {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .select("id, unidade, numero_grupo, last_message_at, last_message_direction")
    .eq("phone_number_id", phoneNumberId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error) return { erro: error.message };

  const conversas = (data ?? []) as unknown as Array<{
    id: string;
    unidade: string | null;
    numero_grupo: string | null;
    last_message_at: string | null;
    last_message_direction: string | null;
  }>;

  return {
    conversas: conversas.length,
    ultimas: conversas.map((c) => ({
      unidade: c.unidade,
      numero_grupo: c.numero_grupo,
      last_message_at: c.last_message_at,
      last_message_direction: c.last_message_direction,
    })),
  };
}

export async function handleWhatsAppDiagnosticoApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROTA) return null;
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);

  if (!(await autorizadoComoAdmin(request))) {
    return json({ error: "Não autorizado." }, 401);
  }

  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  const numeros = getNumerosWhatsApp();

  const belvedereConfigurado = numeros.some((n) => n.grupo === "belvedere");

  const resultados = [];
  for (const n of numeros) {
    const diagnostico = await diagnosticarNumero(n.grupo, n.phoneNumberId, n.token, graphVersion);
    resultados.push({ ...diagnostico, webhook: await recebimentoNoBanco(n.phoneNumberId) });
  }

  return json({
    rota: ROTA,
    graph_version: graphVersion,
    numeros_configurados: numeros.map((n) => n.grupo),
    belvedere_configurado: belvedereConfigurado,
    numeros: resultados,
  });
}
