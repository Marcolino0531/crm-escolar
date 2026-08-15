// Server functions do assistente de IA do Atendimento.
//
// MODO TREINAMENTO: estas funções geram e registram SUGESTÕES. Nenhuma delas
// envia mensagem ao responsável — o envio continua sendo `enviarMensagemChat`,
// disparado por um clique humano.
//
// A chave da Anthropic e os dados do Sponte nunca vão ao navegador: a consulta é
// feita aqui, no servidor, a cada sugestão (nunca de cache), e o contexto é
// montado por funções puras testáveis em `atendimento-ia.ts`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ErroIA,
  gerarMensagemIA,
  getAnthropicConfig,
  mensagemFalhaIA,
  type MotivoFalhaIA,
} from "@/lib/anthropic.server";
import {
  AVISO_SENSIVEL,
  PROMPT_PADRAO,
  classificarSituacao,
  detectarAssuntoSensivel,
  montarPromptIA,
  montarAtualizacaoEnvio,
  montarRegistroSugestao,
  type FinanceiroContexto,
  type MensagemContexto,
} from "@/lib/atendimento-ia";
import { calcularTotalVencido } from "@/lib/billing-debt";
import { isMesReferencia } from "@/lib/billing-exceptions";
import { buscarResponsavelFinanceiroAluno, coletarDividaAbertaAluno } from "@/lib/sponte.functions";

async function assertPermissaoIA(userId: string, edicao: boolean, acao: string) {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "financeiro_atendimento_ia" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Você não tem permissão para ${acao}.`);
}

async function nomeDoUsuario(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  return nome || (data?.user?.email ?? "");
}

type ConversaIA = {
  id: string;
  wa_phone: string;
  aluno_id: string | null;
  aluno_name: string;
  responsavel_name: string;
  contact_name: string;
  unidade: string;
};

type MensagemBanco = {
  direction: "in" | "out";
  body: string;
  message_type: MensagemContexto["tipo"];
  origem: "chat" | "cobranca";
};

// Data de hoje em São Paulo (YYYY-MM-DD): a Vercel roda em UTC, e o corte de
// "parcela vencida" precisa seguir o fuso da escola.
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Situação financeira consultada no Sponte AGORA (leitura apenas — nenhuma
// escrita é feita no ERP). Quando a consulta falha ou a conversa não tem aluno
// vinculado, `consultaOk` fica false e o prompt proíbe citar valores.
async function coletarFinanceiro(
  conversa: ConversaIA,
  hojeYMD: string,
): Promise<FinanceiroContexto> {
  const base: FinanceiroContexto = {
    alunoNome: conversa.aluno_name,
    alunoId: conversa.aluno_id ?? "",
    unidade: conversa.unidade,
    responsavelNome: conversa.responsavel_name || conversa.contact_name,
    parcelas: [],
    totalVencido: 0,
    acordoMes: null,
    consultaOk: false,
  };
  if (!conversa.aluno_id || !conversa.unidade) return base;

  const [divida, responsavel, excecao] = await Promise.all([
    coletarDividaAbertaAluno(conversa.unidade, conversa.aluno_id),
    buscarResponsavelFinanceiroAluno(conversa.unidade, conversa.aluno_id),
    supabaseAdmin
      .from("whatsapp_billing_exceptions" as never)
      .select("mes_referencia")
      .eq("aluno_id", conversa.aluno_id)
      .maybeSingle(),
  ]);

  const mes = (excecao.data as unknown as { mes_referencia: string } | null)?.mes_referencia ?? "";
  base.acordoMes = isMesReferencia(mes) ? mes : null;
  if (responsavel?.nome) base.responsavelNome = responsavel.nome;
  if (!divida) return base;

  base.consultaOk = true;
  base.parcelas = divida.boletos.map((b) => ({ vencimento: b.vencimento, saldo: b.saldo }));
  base.totalVencido = calcularTotalVencido(base.parcelas, hojeYMD);
  return base;
}

async function lerInstrucoes(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("ai_atendimento_settings" as never)
    .select("system_prompt")
    .maybeSingle();
  const prompt = (data as unknown as { system_prompt: string } | null)?.system_prompt ?? "";
  return prompt.trim() || PROMPT_PADRAO;
}

const GerarSugestaoInputSchema = z.object({
  conversationId: z.string().uuid(),
});

export interface GerarSugestaoResult {
  ok: boolean;
  suggestionId?: string;
  sugestao?: string;
  sensivel?: boolean;
  motivoSensivel?: string;
  situacao?: string;
  // Resumo do que foi enviado à IA, para a tela mostrar em que dados ela se baseou.
  baseFinanceira?: string;
  tokens?: { entrada: number; saida: number };
  error?: string;
  motivo?: MotivoFalhaIA;
}

export const gerarSugestaoResposta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GerarSugestaoInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GerarSugestaoResult> => {
    await assertPermissaoIA(context.userId, true, "gerar sugestões de resposta com IA");

    const cfg = getAnthropicConfig();
    if (!cfg) {
      return { ok: false, motivo: "nao_configurada", error: mensagemFalhaIA("nao_configurada") };
    }

    const { data: convRow } = await supabaseAdmin
      .from("whatsapp_conversations" as never)
      .select("id, wa_phone, aluno_id, aluno_name, responsavel_name, contact_name, unidade")
      .eq("id", data.conversationId)
      .maybeSingle();
    const conversa = convRow as unknown as ConversaIA | null;
    if (!conversa) return { ok: false, error: "Conversa não encontrada." };

    const { data: msgRows, error: msgErro } = await supabaseAdmin
      .from("whatsapp_messages" as never)
      .select("direction, body, message_type, origem")
      .eq("conversation_id", conversa.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (msgErro) return { ok: false, error: msgErro.message };

    const mensagens: MensagemContexto[] = ((msgRows ?? []) as unknown as MensagemBanco[]).map(
      (m) => ({
        direcao: m.direction,
        corpo: m.body ?? "",
        tipo: m.message_type ?? "text",
        automatica: m.origem === "cobranca",
      }),
    );

    const hojeYMD = hojeSaoPaulo();
    const triagem = detectarAssuntoSensivel(mensagens);

    // Caso sensível não vai para a IA: além de não valer um rascunho automático,
    // evita gastar token num texto que não deve ser usado.
    if (triagem.sensivel) {
      const registro = montarRegistroSugestao({
        conversationId: conversa.id,
        alunoId: conversa.aluno_id,
        unidade: conversa.unidade,
        mensagens,
        triagem,
        sugestao: `${AVISO_SENSIVEL} Motivo: ${triagem.motivo}.`,
        modelo: "",
        tokensEntrada: 0,
        tokensSaida: 0,
        userId: context.userId,
      });
      const { data: inserido } = await supabaseAdmin
        .from("ai_suggestions" as never)
        .insert(registro as never)
        .select("id")
        .maybeSingle();
      return {
        ok: true,
        suggestionId: (inserido as unknown as { id: string } | null)?.id,
        sugestao: registro.sugestao,
        sensivel: true,
        motivoSensivel: triagem.motivo,
        situacao: registro.situacao,
        tokens: { entrada: 0, saida: 0 },
      };
    }

    const financeiro = await coletarFinanceiro(conversa, hojeYMD);
    const prompt = montarPromptIA({
      instrucoes: await lerInstrucoes(),
      financeiro,
      mensagens,
      hojeYMD,
    });

    let resposta;
    try {
      resposta = await gerarMensagemIA(cfg, { system: prompt.system, mensagens: prompt.mensagens });
    } catch (e) {
      if (e instanceof ErroIA) {
        console.error("[atendimento-ia] falha na chamada à Anthropic", {
          motivo: e.motivo,
          detalhe: e.detalhe,
          conversationId: conversa.id,
        });
        return { ok: false, motivo: e.motivo, error: e.message };
      }
      console.error("[atendimento-ia] erro inesperado ao gerar sugestão", e);
      return { ok: false, motivo: "desconhecido", error: mensagemFalhaIA("desconhecido") };
    }

    const registro = montarRegistroSugestao({
      conversationId: conversa.id,
      alunoId: conversa.aluno_id,
      unidade: conversa.unidade,
      mensagens,
      triagem,
      sugestao: resposta.texto,
      modelo: resposta.modelo,
      tokensEntrada: resposta.tokensEntrada,
      tokensSaida: resposta.tokensSaida,
      userId: context.userId,
    });
    const { data: inserido, error: insErro } = await supabaseAdmin
      .from("ai_suggestions" as never)
      .insert(registro as never)
      .select("id")
      .maybeSingle();
    if (insErro) console.error("[atendimento-ia] falha ao registrar a sugestão", insErro.message);

    const semDados = !financeiro.consultaOk;
    return {
      ok: true,
      suggestionId: (inserido as unknown as { id: string } | null)?.id,
      sugestao: resposta.texto,
      sensivel: false,
      situacao: classificarSituacao(mensagens),
      baseFinanceira: semDados
        ? "Sponte não consultado (conversa sem aluno vinculado ou consulta indisponível): a sugestão não cita valores."
        : `${financeiro.parcelas.length} parcela(s) em aberto no Sponte · total vencido considerado hoje.`,
      tokens: { entrada: resposta.tokensEntrada, saida: resposta.tokensSaida },
    };
  });

const RegistrarEnvioInputSchema = z.object({
  suggestionId: z.string().uuid(),
  enviado: z.string().trim().min(1).max(4000),
});

// Fecha o par sugestão/versão-final depois que a resposta foi enviada de fato,
// marcando se o texto foi editado à mão. Não envia nada: é só o registro.
export const registrarEnvioDaSugestao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RegistrarEnvioInputSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; editado?: boolean; error?: string }> => {
      await assertPermissaoIA(context.userId, true, "registrar o envio da sugestão");

      const { data: row } = await supabaseAdmin
        .from("ai_suggestions" as never)
        .select("id, sugestao")
        .eq("id", data.suggestionId)
        .maybeSingle();
      const sugestao = row as unknown as { id: string; sugestao: string } | null;
      if (!sugestao) return { ok: false, error: "Sugestão não encontrada." };

      const atualizacao = montarAtualizacaoEnvio(
        sugestao.sugestao,
        data.enviado,
        new Date().toISOString(),
      );
      const { error } = await supabaseAdmin
        .from("ai_suggestions" as never)
        .update(atualizacao as never)
        .eq("id", sugestao.id);
      if (error) return { ok: false, error: error.message };

      return { ok: true, editado: atualizacao.editado };
    },
  );

const SalvarInstrucoesInputSchema = z.object({
  systemPrompt: z.string().trim().min(20).max(20000),
});

export const salvarInstrucoesIA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarInstrucoesInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    await assertPermissaoIA(context.userId, true, "editar as instruções da IA");

    const nome = await nomeDoUsuario(context.userId);

    const { error } = await supabaseAdmin.from("ai_atendimento_settings" as never).upsert(
      {
        id: true,
        system_prompt: data.systemPrompt,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: nome,
      } as never,
      { onConflict: "id" },
    );
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  });
