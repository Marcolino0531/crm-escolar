// Reações do WhatsApp (lógica pura).
//
// A Meta entrega a reação como uma mensagem `type: "reaction"`, cujo corpo
// aponta o wamid da mensagem reagida e o emoji escolhido. Tirar a reação chega
// como o mesmo evento com o emoji vazio. A reação não é uma mensagem nova: ela
// se cola à mensagem original, como no WhatsApp nativo.

export interface ReactionLikeMessage {
  type?: string;
  reaction?: { message_id?: string; emoji?: string };
}

export interface ReacaoRecebida {
  // wamid da mensagem que recebeu a reação.
  alvoWamid: string;
  // Emoji da reação; null quando o contato REMOVEU a reação.
  emoji: string | null;
}

// Interpreta o evento de reação. Devolve null quando não é reação ou quando o
// evento não identifica a mensagem alvo (nada a aplicar).
export function parseReacao(msg: ReactionLikeMessage): ReacaoRecebida | null {
  if (msg.type !== "reaction") return null;
  const alvoWamid = (msg.reaction?.message_id ?? "").trim();
  if (!alvoWamid) return null;
  const emoji = (msg.reaction?.emoji ?? "").trim();
  return { alvoWamid, emoji: emoji || null };
}
