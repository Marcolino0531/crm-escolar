// Biblioteca de exemplos de treinamento (few-shot) do assistente do Atendimento —
// lógica pura (sem rede, sem Supabase).
//
// Um exemplo é o par "o que a IA sugeriu" → "o que a escola realmente enviou",
// salvo por decisão explícita do operador. Em cada nova sugestão, alguns exemplos
// parecidos com a situação atual entram no contexto para o modelo copiar o estilo
// e o conteúdo de respostas reais, sem que isso vire regra geral.
//
// A seleção é deliberadamente simples (situação + palavras em comum + recência),
// mas isolada nestas funções: trocar por busca semântica depois é substituir
// `pontuarExemplo` sem mexer no resto.

import {
  LABEL_SITUACAO,
  classificarSituacao,
  resumirContexto,
  textoDaMensagem,
  ultimaDoResponsavel,
  type MensagemContexto,
  type SituacaoAtendimento,
} from "./atendimento-ia";

// Quantos exemplos entram no prompt. Poucos de propósito: cada um custa tokens em
// toda sugestão gerada.
export const MAX_EXEMPLOS_CONTEXTO = 3;

// Peso de bater a mesma situação (pedido de acordo, dúvida de valor…). Alto o
// bastante para que um exemplo da mesma situação ganhe de um genérico recente.
export const PESO_SITUACAO = 10;

export interface ExemploTreinamento {
  id: string;
  situacao: SituacaoAtendimento;
  contexto: string;
  // Vazio quando a resposta foi escrita do zero, sem sugestão da IA.
  sugestao_original: string;
  resposta_final: string;
  ativo: boolean;
  criado_em: string;
}

const STOPWORDS = new Set([
  "para",
  "pelo",
  "pela",
  "como",
  "esse",
  "essa",
  "isso",
  "esta",
  "este",
  "isto",
  "aquele",
  "aquela",
  "voce",
  "vocês",
  "voces",
  "sobre",
  "quando",
  "porque",
  "porem",
  "mesmo",
  "ainda",
  "tambem",
  "muito",
  "pouco",
  "seria",
  "estou",
  "estar",
  "fazer",
  "poder",
  "posso",
  "pode",
  "tenho",
  "tem",
  "dia",
  "bom",
  "boa",
  "obrigado",
  "obrigada",
  "favor",
  "sim",
  "nao",
]);

function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Palavras significativas de um texto: sem acento, sem número solto, sem palavra
// curta nem palavra vazia de sentido. É o vocabulário usado na comparação.
export function palavrasChave(texto: string): Set<string> {
  const tokens = normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !/^\d+$/.test(p) && !STOPWORDS.has(p));
  return new Set(tokens);
}

// Quantas palavras significativas os dois textos têm em comum.
export function palavrasEmComum(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const p of a) if (b.has(p)) n++;
  return n;
}

// Relevância de um exemplo para a situação atual. Mesma situação pesa mais que
// qualquer sobreposição de vocabulário; a recência só desempata.
export function pontuarExemplo(
  exemplo: ExemploTreinamento,
  alvo: { situacao: SituacaoAtendimento; palavras: Set<string> },
): number {
  const mesmaSituacao = exemplo.situacao === alvo.situacao ? PESO_SITUACAO : 0;
  const vocabulario = palavrasEmComum(
    alvo.palavras,
    palavrasChave(`${exemplo.contexto} ${exemplo.resposta_final}`),
  );
  return mesmaSituacao + vocabulario;
}

// Exemplos que vão ao contexto: ativos, com resposta final, ordenados por
// relevância e, no empate, pelo mais recente.
export function selecionarExemplos(
  exemplos: ExemploTreinamento[],
  input: { mensagens: MensagemContexto[]; max?: number },
): ExemploTreinamento[] {
  const max = input.max ?? MAX_EXEMPLOS_CONTEXTO;
  if (max <= 0) return [];

  const ultima = ultimaDoResponsavel(input.mensagens);
  const alvo = {
    situacao: classificarSituacao(input.mensagens),
    palavras: palavrasChave(ultima ? textoDaMensagem(ultima) : ""),
  };

  return exemplos
    .filter((e) => e.ativo && e.resposta_final.trim() !== "")
    .map((e) => ({ exemplo: e, pontos: pontuarExemplo(e, alvo) }))
    .sort((a, b) =>
      b.pontos !== a.pontos
        ? b.pontos - a.pontos
        : b.exemplo.criado_em.localeCompare(a.exemplo.criado_em),
    )
    .slice(0, max)
    .map((x) => x.exemplo);
}

// Bloco few-shot anexado ao system prompt. Fica separado das instruções de
// propósito: instrução é regra, exemplo é referência de estilo.
export function blocoExemplos(exemplos: ExemploTreinamento[]): string {
  if (exemplos.length === 0) return "";
  const partes = exemplos.map((e, i) => {
    const linhas = [
      `Exemplo ${i + 1} — ${LABEL_SITUACAO[e.situacao] ?? e.situacao}`,
      `Contexto: ${e.contexto || "—"}`,
      `Resposta enviada pela escola: ${e.resposta_final.trim()}`,
    ];
    return linhas.join("\n");
  });
  return [
    "Respostas reais já enviadas pela escola em situações parecidas. Use como referência de estilo, tamanho e nível de detalhe — nunca copie valores, datas ou nomes delas: esses dados só podem vir do bloco da situação financeira.",
    ...partes,
  ].join("\n\n");
}

export interface RegistroExemplo {
  suggestion_id: string | null;
  conversation_id: string | null;
  aluno_id: string | null;
  unidade: string;
  situacao: SituacaoAtendimento;
  contexto: string;
  sugestao_original: string;
  resposta_final: string;
  ativo: boolean;
  criado_por: string;
  criado_por_nome: string;
}

// Linha gravada quando o operador clica em "Salvar como exemplo de treinamento".
// `sugestao_original` vazia significa resposta escrita do zero — também é um
// exemplo válido, e dos mais informativos.
export function montarRegistroExemplo(input: {
  suggestionId: string | null;
  conversationId: string | null;
  alunoId: string | null;
  unidade: string;
  mensagens: MensagemContexto[];
  sugestaoOriginal: string;
  respostaFinal: string;
  userId: string;
  userNome: string;
}): RegistroExemplo {
  return {
    suggestion_id: input.suggestionId || null,
    conversation_id: input.conversationId || null,
    aluno_id: input.alunoId || null,
    unidade: input.unidade,
    situacao: classificarSituacao(input.mensagens),
    contexto: resumirContexto(input.mensagens),
    sugestao_original: input.sugestaoOriginal.trim(),
    resposta_final: input.respostaFinal.trim(),
    ativo: true,
    criado_por: input.userId,
    criado_por_nome: input.userNome,
  };
}
