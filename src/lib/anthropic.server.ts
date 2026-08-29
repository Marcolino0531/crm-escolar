// Cliente da API da Anthropic (server-only), usado pelo assistente de IA do
// Atendimento. Sem SDK: chamada HTTP direta ao endpoint /v1/messages, no mesmo
// padrão das outras integrações do projeto (Resend, Cloud API da Meta).
//
// NUNCA logar a API key. A chamada é PAGA por token processado, então quem chama
// é responsável por limitar o tamanho do contexto e registrar o uso.

export type AnthropicConfig = {
  apiKey: string;
  modelo: string;
};

export const MODELO_PADRAO = "claude-sonnet-4-5";

// Teto de tokens da resposta: uma mensagem de WhatsApp cabe folgadamente aqui, e
// o limite protege a fatura de uma geração fora de controle.
const MAX_TOKENS_RESPOSTA = 700;

export function getAnthropicConfig(): AnthropicConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { apiKey, modelo: process.env.ANTHROPIC_MODEL || MODELO_PADRAO };
}

export type MensagemAnthropic = { role: "user" | "assistant"; content: string };

export type RespostaAnthropic = {
  texto: string;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
};

// Falha da chamada com motivo classificado, para a tela dizer o que fazer em vez
// de mostrar o corpo cru do erro HTTP.
export type MotivoFalhaIA =
  | "nao_configurada"
  | "chave_invalida"
  | "sem_credito"
  | "limite_taxa"
  | "sobrecarga"
  | "resposta_vazia"
  | "desconhecido";

export class ErroIA extends Error {
  readonly motivo: MotivoFalhaIA;
  readonly detalhe: string;

  constructor(motivo: MotivoFalhaIA, detalhe = "") {
    super(mensagemFalhaIA(motivo));
    this.name = "ErroIA";
    this.motivo = motivo;
    this.detalhe = detalhe;
  }
}

export function mensagemFalhaIA(motivo: MotivoFalhaIA): string {
  switch (motivo) {
    case "nao_configurada":
      return "Assistente de IA não configurado: falta a variável ANTHROPIC_API_KEY no servidor.";
    case "chave_invalida":
      return "A chave da API da Anthropic foi recusada. Gere uma nova chave no console da Anthropic e atualize ANTHROPIC_API_KEY.";
    case "sem_credito":
      return "A conta da Anthropic está sem crédito. A API é pré-paga: adicione créditos no console da Anthropic para voltar a gerar sugestões.";
    case "limite_taxa":
      return "Muitas sugestões em sequência (limite de requisições da Anthropic). Aguarde alguns segundos e tente de novo.";
    case "sobrecarga":
      return "A API da Anthropic está sobrecarregada neste momento. Tente novamente em instantes.";
    case "resposta_vazia":
      return "A IA respondeu sem texto. Tente gerar a sugestão novamente.";
    default:
      return "Não foi possível gerar a sugestão por um problema técnico na integração com a IA. Tente novamente; se persistir, o erro técnico está no log do servidor.";
  }
}

function classificarStatus(status: number, corpo: string): MotivoFalhaIA {
  const texto = corpo.toLowerCase();
  if (status === 401 || status === 403) return "chave_invalida";
  if (status === 429) return texto.includes("credit") ? "sem_credito" : "limite_taxa";
  if (status === 400 && texto.includes("credit")) return "sem_credito";
  if (status === 529 || status === 503) return "sobrecarga";
  return "desconhecido";
}

type CorpoResposta = {
  model?: string;
  content?: BlocoResposta[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type BlocoResposta = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

// Extrai o texto dos blocos de conteúdo da resposta. A API devolve uma lista de
// blocos tipados; só os de texto interessam aqui.
function textoDosBlocos(corpo: CorpoResposta): string {
  const blocos = Array.isArray(corpo.content) ? corpo.content : [];
  return blocos
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => (b.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function chamarMessages(
  cfg: AnthropicConfig,
  corpo: Record<string, unknown>,
): Promise<CorpoResposta> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(corpo),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    // Corpo do erro da Anthropic apenas; nenhum header/credencial é registrado.
    throw new ErroIA(
      classificarStatus(res.status, bodyText),
      `Anthropic HTTP ${res.status}: ${bodyText.slice(0, 500)}`,
    );
  }

  try {
    return JSON.parse(bodyText) as CorpoResposta;
  } catch {
    throw new ErroIA("desconhecido", `Resposta não-JSON da Anthropic: ${bodyText.slice(0, 300)}`);
  }
}

export async function gerarMensagemIA(
  cfg: AnthropicConfig,
  input: { system: string; mensagens: MensagemAnthropic[] },
): Promise<RespostaAnthropic> {
  const corpo = await chamarMessages(cfg, {
    model: cfg.modelo,
    max_tokens: MAX_TOKENS_RESPOSTA,
    system: input.system,
    messages: input.mensagens,
  });

  const texto = textoDosBlocos(corpo);
  if (!texto) throw new ErroIA("resposta_vazia", JSON.stringify(corpo).slice(0, 300));

  return {
    texto,
    modelo: corpo.model ?? cfg.modelo,
    tokensEntrada: corpo.usage?.input_tokens ?? 0,
    tokensSaida: corpo.usage?.output_tokens ?? 0,
  };
}

// ─── Tool calling ────────────────────────────────────────────────────────────
//
// A lista de ferramentas é sempre montada pelo servidor (nunca pela entrada do
// usuário) e o modelo só devolve NOME + ARGUMENTOS: quem executa a consulta é o
// chamador, depois de validar o nome contra a sua allowlist.

export type FerramentaAnthropic = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type UsoFerramenta = { id: string; nome: string; args: unknown };

// Blocos aceitos no histórico enviado de volta à API: texto do usuário, os
// blocos crus do turno do assistente e o resultado de cada ferramenta.
export type ConteudoMensagem = string | Record<string, unknown>[];
export type MensagemComFerramentas = { role: "user" | "assistant"; content: ConteudoMensagem };

export type RespostaComFerramentas = {
  texto: string;
  usos: UsoFerramenta[];
  // Blocos crus do turno do assistente, para reenviar no próximo round.
  blocosAssistente: Record<string, unknown>[];
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
};

export async function gerarComFerramentas(
  cfg: AnthropicConfig,
  input: {
    system: string;
    mensagens: MensagemComFerramentas[];
    ferramentas: FerramentaAnthropic[];
    maxTokens?: number;
  },
): Promise<RespostaComFerramentas> {
  const corpo = await chamarMessages(cfg, {
    model: cfg.modelo,
    max_tokens: input.maxTokens ?? MAX_TOKENS_RESPOSTA,
    system: input.system,
    messages: input.mensagens,
    tools: input.ferramentas,
  });

  const blocos = Array.isArray(corpo.content) ? corpo.content : [];
  const usos: UsoFerramenta[] = blocos
    .filter((b) => b?.type === "tool_use" && typeof b.name === "string" && typeof b.id === "string")
    .map((b) => ({ id: b.id as string, nome: b.name as string, args: b.input }));

  return {
    texto: textoDosBlocos(corpo),
    usos,
    blocosAssistente: blocos as Record<string, unknown>[],
    modelo: corpo.model ?? cfg.modelo,
    tokensEntrada: corpo.usage?.input_tokens ?? 0,
    tokensSaida: corpo.usage?.output_tokens ?? 0,
  };
}
