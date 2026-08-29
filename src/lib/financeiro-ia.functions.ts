// Server function das Análises com IA do Financeiro.
//
// Fluxo por pergunta:
//   1. autentica e confere a permissão do módulo Financeiro;
//   2. manda a pergunta à Anthropic COM a lista fechada de ferramentas;
//   3. valida nome + argumentos de cada chamada devolvida (allowlist + schema);
//   4. executa a consulta real e devolve à IA só o resultado sanitizado;
//   5. pede o texto final, que só pode se apoiar nesses resultados;
//   6. grava a auditoria (quem, quando, pergunta, ferramentas disparadas).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ErroIA,
  gerarComFerramentas,
  getAnthropicConfig,
  mensagemFalhaIA,
  type FerramentaAnthropic,
  type MensagemComFerramentas,
} from "@/lib/anthropic.server";
import {
  executarFerramenta,
  FERRAMENTAS_ANALISE,
  montarSystemPrompt,
  validarChamadaFerramenta,
  type EscopoAnalise,
} from "@/lib/financeiro-ia";
import {
  assertPermissaoAnaliseFinanceira,
  criarFonteDados,
  registrarAnalise,
  unidadesPermitidas,
} from "@/lib/financeiro-ia.server";

const PerguntaInputSchema = z.object({
  pergunta: z.string().trim().min(5).max(1000),
});

export type AnaliseResult = {
  ok: boolean;
  resposta: string;
  // Ferramentas que realmente rodaram, na ordem, para a tela mostrar a origem.
  ferramentas: { nome: string; fonte: string; filtros: Record<string, string>; erro?: string }[];
  erro?: string;
};

// Rodadas de ferramenta por pergunta: uma análise costuma precisar de 1 a 3
// consultas. O teto evita loop e limita o custo por pergunta.
const MAX_RODADAS = 4;
const MAX_TOKENS_RESPOSTA = 1500;

const ferramentasParaIA: FerramentaAnthropic[] = FERRAMENTAS_ANALISE.map((f) => ({
  name: f.nome,
  description: f.descricao,
  input_schema: f.schemaJson,
}));

export const perguntarAnaliseFinanceira = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PerguntaInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<AnaliseResult> => {
    await assertPermissaoAnaliseFinanceira(context.userId);

    const cfg = getAnthropicConfig();
    if (!cfg) {
      const erro = mensagemFalhaIA("nao_configurada");
      await registrarAnalise({
        userId: context.userId,
        pergunta: data.pergunta,
        ferramentas: [],
        argumentos: [],
        sucesso: false,
        erro,
      });
      return { ok: false, resposta: "", ferramentas: [], erro };
    }

    const escopo: EscopoAnalise = {
      unidadesPermitidas: await unidadesPermitidas(context.userId),
      hoje: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
    };
    const fonte = criarFonteDados(context.userId);
    const system = montarSystemPrompt(escopo);

    const mensagens: MensagemComFerramentas[] = [{ role: "user", content: data.pergunta }];
    const usadas: AnaliseResult["ferramentas"] = [];
    const argumentos: unknown[] = [];
    let tokensEntrada = 0;
    let tokensSaida = 0;
    let modelo = "";

    try {
      for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
        const resposta = await gerarComFerramentas(cfg, {
          system,
          mensagens,
          ferramentas: ferramentasParaIA,
          maxTokens: MAX_TOKENS_RESPOSTA,
        });
        tokensEntrada += resposta.tokensEntrada;
        tokensSaida += resposta.tokensSaida;
        modelo = resposta.modelo;

        if (resposta.usos.length === 0) {
          const texto = resposta.texto.trim();
          if (!texto) throw new ErroIA("resposta_vazia");
          await registrarAnalise({
            userId: context.userId,
            pergunta: data.pergunta,
            ferramentas: usadas.map((u) => u.nome),
            argumentos,
            sucesso: true,
            modelo,
            tokensEntrada,
            tokensSaida,
          });
          return { ok: true, resposta: texto, ferramentas: usadas };
        }

        mensagens.push({ role: "assistant", content: resposta.blocosAssistente });
        const resultados: Record<string, unknown>[] = [];

        for (const uso of resposta.usos) {
          const validacao = validarChamadaFerramenta(uso.nome, uso.args);
          if (!validacao.ok) {
            // Ferramenta inexistente, SQL/código enviado no lugar de argumentos,
            // campo extra ou tipo errado: nada é executado; o modelo recebe o
            // motivo e pode corrigir dentro da lista fechada.
            usadas.push({
              nome: uso.nome,
              fonte: "—",
              filtros: {},
              erro: validacao.erro,
            });
            resultados.push({
              type: "tool_result",
              tool_use_id: uso.id,
              is_error: true,
              content: validacao.erro,
            });
            continue;
          }

          argumentos.push({ ferramenta: validacao.chamada.nome, args: validacao.chamada.args });
          let resultado: Awaited<ReturnType<typeof executarFerramenta>>;
          try {
            resultado = await executarFerramenta(validacao.chamada, fonte, escopo);
          } catch (falha) {
            // A mensagem crua da fonte (banco/Sponte) pode carregar detalhe de
            // infraestrutura; a IA e a tela recebem só o fato da falha, e o
            // motivo real fica no log do servidor.
            console.error(
              `[analises-ia] falha na ferramenta ${validacao.chamada.nome}:`,
              falha instanceof Error ? falha.message : falha,
            );
            resultado = {
              ferramenta: validacao.chamada.nome,
              fonte: "—",
              filtros: {},
              erro: "A consulta falhou ao ler os dados desta fonte. Tente novamente ou reduza o período.",
            };
          }
          usadas.push({
            nome: resultado.ferramenta,
            fonte: resultado.fonte,
            filtros: resultado.filtros,
            erro: resultado.erro,
          });
          resultados.push({
            type: "tool_result",
            tool_use_id: uso.id,
            is_error: Boolean(resultado.erro),
            content: JSON.stringify(resultado),
          });
        }

        mensagens.push({ role: "user", content: resultados });
      }

      throw new Error(
        "A análise precisou de consultas demais para uma pergunta só. Tente perguntar de forma mais específica (uma unidade e um período por vez).",
      );
    } catch (e) {
      const erro =
        e instanceof ErroIA
          ? e.message
          : e instanceof Error
            ? e.message
            : "Falha inesperada na análise.";
      await registrarAnalise({
        userId: context.userId,
        pergunta: data.pergunta,
        ferramentas: usadas.map((u) => u.nome),
        argumentos,
        sucesso: false,
        erro,
        modelo,
        tokensEntrada,
        tokensSaida,
      });
      return { ok: false, resposta: "", ferramentas: usadas, erro };
    }
  });
