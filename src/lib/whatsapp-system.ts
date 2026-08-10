// Lógica pura dos eventos "system" do webhook da Meta (WhatsApp Cloud API).
//
// Mensagens type:"system" não são comunicação real de uma pessoa — são avisos
// administrativos (troca de número do contato, mudança de identidade de
// segurança). Este módulo decide, sem tocar rede/banco, se o evento deve ser
// ignorado ou tratado como migração de número (com uma nota interna).

// Formato relevante de uma mensagem "system" recebida no webhook.
export interface SystemLikeMessage {
  from?: string;
  type?: string;
  system?: {
    body?: string;
    // user_changed_number | customer_changed_number | customer_identity_changed
    type?: string;
    wa_id?: string; // novo wa_id (Graph API v12+)
    new_wa_id?: string; // novo wa_id (Graph API v11-)
    customer?: string; // novo wa_id (variação customer_changed_number)
  };
}

export interface SystemEvent {
  isSystem: boolean;
  changeType: string | null; // system.type
  oldWaId: string; // número antigo (msg.from)
  newWaId: string | null; // número novo, só quando é troca de número
  body: string; // system.body (descrição da Meta)
}

// Tipos de evento que representam TROCA DE NÚMERO (têm um novo wa_id de destino).
const NUMBER_CHANGE_TYPES = new Set(["user_changed_number", "customer_changed_number"]);

export function parseSystemEvent(msg: SystemLikeMessage): SystemEvent {
  const sys = msg.system ?? {};
  const changeType = sys.type?.trim() || null;
  const novo = sys.wa_id?.trim() || sys.new_wa_id?.trim() || sys.customer?.trim() || null;
  return {
    isSystem: msg.type === "system",
    changeType,
    oldWaId: msg.from?.trim() ?? "",
    newWaId: NUMBER_CHANGE_TYPES.has(changeType ?? "") ? novo : null,
    body: sys.body?.trim() ?? "",
  };
}

export type SystemAction =
  | { action: "ignore" }
  | { action: "migrate"; oldWaId: string; newWaId: string; note: string };

// Decide o que fazer com um evento system:
//   - migrar: é uma troca de número com destino conhecido (novo wa_id) e temos o
//     número antigo → o chamador migra a conversa existente e grava a nota.
//   - ignorar: qualquer outro caso (identidade, sem novo número, sem origem) —
//     nunca cria conversa nem mensagem "não suportada".
export function decideSystemAction(event: SystemEvent): SystemAction {
  if (!event.isSystem) return { action: "ignore" };
  if (!event.newWaId || !event.oldWaId) return { action: "ignore" };
  const note = event.body || `Número atualizado de ${event.oldWaId} para ${event.newWaId}`;
  return { action: "migrate", oldWaId: event.oldWaId, newWaId: event.newWaId, note };
}
