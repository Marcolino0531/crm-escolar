// Lógica pura de arquivamento de conversas do Atendimento (estilo WhatsApp).
//
// Arquivar é apenas organização visual: a conversa some da aba "Gerais" e
// aparece em "Arquivadas", sem perder mensagens nem o contador de não-lidas.
// Quando o responsável envia uma nova mensagem, a conversa VOLTA automaticamente
// para "Gerais" (desarquiva), como no WhatsApp.
//
// Este módulo não toca o banco — só computa transições de estado e partições —
// para ser testável isoladamente.

export type AbaAtendimento = "ativas" | "arquivadas";

export interface ConversaArquivavel {
  archived: boolean;
  unread_count: number;
}

// Patch aplicado ao arquivar manualmente uma conversa.
export function statusAoArquivar(): { archived: true } {
  return { archived: true };
}

// Patch aplicado ao desarquivar manualmente uma conversa.
export function statusAoDesarquivar(): { archived: false } {
  return { archived: false };
}

// Patch aplicado quando o responsável envia uma nova mensagem: a conversa
// sempre retorna para "Gerais" (desarquiva, mesmo que já estivesse ativa) e o
// contador de não-lidas é incrementado.
export function statusAoReceberMensagem(c: ConversaArquivavel): {
  archived: false;
  unread_count: number;
} {
  return { archived: false, unread_count: c.unread_count + 1 };
}

// Uma conversa deve reaparecer em "Gerais" ao receber mensagem só se estava
// arquivada (útil para decidir se há mudança de aba a comunicar na UI).
export function deveDesarquivarAoReceber(c: ConversaArquivavel): boolean {
  return c.archived === true;
}

// A que aba uma conversa pertence.
export function pertenceAAba(c: ConversaArquivavel, aba: AbaAtendimento): boolean {
  return aba === "arquivadas" ? c.archived === true : c.archived !== true;
}

// Particiona a lista nas duas abas, preservando a ordem original.
export function separarPorAba<T extends ConversaArquivavel>(
  conversas: T[],
): { ativas: T[]; arquivadas: T[] } {
  const ativas: T[] = [];
  const arquivadas: T[] = [];
  for (const c of conversas) {
    if (c.archived === true) arquivadas.push(c);
    else ativas.push(c);
  }
  return { ativas, arquivadas };
}

// Soma de não-lidas de uma lista (o contador segue valendo em ambas as abas).
export function totalNaoLidas(conversas: ConversaArquivavel[]): number {
  return conversas.reduce((acc, c) => acc + (c.unread_count > 0 ? c.unread_count : 0), 0);
}
