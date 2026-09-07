// Regras puras do cancelamento de contrato via ZapSign (`POST /refuse/`).
// Sem I/O: usadas pela server function e pelo modal da aba Contratos.

export const MOTIVO_CANCELAMENTO_MIN = 5;
export const MOTIVO_CANCELAMENTO_MAX = 500;

/** Status locais (contratos_matricula) que admitem cancelamento na ZapSign. */
export const STATUS_CONTRATO_CANCELAVEL = ["enviado"] as const;

/** Status ZapSign do documento que ainda pode ser recusado. */
export const STATUS_ZAPSIGN_CANCELAVEL = ["pending", "new", "link_opened"] as const;

export interface PedidoCancelamento {
  motivo: string;
  notificarSignatarios: boolean;
}

export function validarMotivoCancelamento(motivo: string): string | null {
  const m = motivo.trim();
  if (!m) return "Informe o motivo do cancelamento.";
  if (m.length < MOTIVO_CANCELAMENTO_MIN) {
    return `O motivo precisa ter pelo menos ${MOTIVO_CANCELAMENTO_MIN} caracteres.`;
  }
  if (m.length > MOTIVO_CANCELAMENTO_MAX) {
    return `O motivo pode ter no máximo ${MOTIVO_CANCELAMENTO_MAX} caracteres.`;
  }
  return null;
}

export function contratoCancelavel(statusContrato: string, statusZapSign: string | null): boolean {
  if (!(STATUS_CONTRATO_CANCELAVEL as readonly string[]).includes(statusContrato)) return false;
  if (statusZapSign === null) return false;
  return (STATUS_ZAPSIGN_CANCELAVEL as readonly string[]).includes(statusZapSign);
}

/**
 * Corpo enviado à ZapSign. `notify_signer` vai sempre explícito (o padrão da
 * API é avisar), para que "não avisar" seja uma escolha registrada.
 */
export function corpoRecusaZapSign(docToken: string, pedido: PedidoCancelamento) {
  return {
    doc_token: docToken,
    rejected_reason: pedido.motivo.trim(),
    notify_signer: pedido.notificarSignatarios,
  };
}

/** Status ZapSign que representam documento cancelado/recusado. */
export function statusZapSignRecusado(status: string | null | undefined): boolean {
  return status === "refused";
}

export const EVENTO_DOC_RECUSADO = "doc_refused";
