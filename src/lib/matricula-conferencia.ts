// Conferência MANUAL de uma submissão do formulário de matrícula (tela
// Matrículas / e-Formulário). O admin marca "Turma conferida" e "Cobrança
// lançada"; com as duas marcadas a conferência fica fixada (conferido_em) e os
// gatilhos da migration 20261122090000 impedem rotinas automáticas de alterar
// turma, cobrança, pendências e lançamentos da submissão.

export const MENSAGEM_CONFERIDO = "Conferido: turma e cobrança conferidas.";

export const CAMPOS_FIXADOS_CONFERENCIA: readonly string[] = [
  "turma_status",
  "turma_nome",
  "turma_pendencia",
  "faturamento_status",
  "faturamento_pendencia",
  "pendencia_resolvida_em",
  "pendencia_resolvida_por",
];

/** A gravação mexe em algum campo que a conferência fixa? */
export function tocaCamposFixados(campos: Record<string, unknown>): boolean {
  return Object.keys(campos).some((k) => CAMPOS_FIXADOS_CONFERENCIA.includes(k));
}

export interface ConferenciaManual {
  manual: true;
  turmaConferida: boolean;
  cobrancaLancada: boolean;
  em: string;
  por: string;
}

export interface EntradaConferenciaManual {
  turmaConferida: boolean;
  cobrancaLancada: boolean;
  em: string;
  porId: string;
  porNome: string;
}

export interface CamposConferenciaManual {
  campos: Record<string, unknown>;
  fixado: boolean;
}

/**
 * Campos gravados em enrollment_submissions pela conferência manual. Só o que
 * foi marcado muda de status; com as duas marcadas as pendências são dadas
 * como resolvidas e a conferência é fixada.
 */
export function montarCamposConferenciaManual(
  e: EntradaConferenciaManual,
): CamposConferenciaManual {
  const conferencia: ConferenciaManual = {
    manual: true,
    turmaConferida: e.turmaConferida,
    cobrancaLancada: e.cobrancaLancada,
    em: e.em,
    por: e.porNome,
  };
  const campos: Record<string, unknown> = { conferencia };
  if (e.turmaConferida) {
    campos.turma_status = "matriculado";
    campos.turma_pendencia = null;
  }
  if (e.cobrancaLancada) {
    campos.faturamento_status = "lancado";
    campos.faturamento_pendencia = null;
  }
  const fixado = e.turmaConferida && e.cobrancaLancada;
  if (fixado) {
    campos.pendencia_resolvida_em = e.em;
    campos.pendencia_resolvida_por = e.porNome;
    campos.conferido_em = e.em;
    campos.conferido_por = e.porId;
    campos.conferido_por_nome = e.porNome;
  }
  return { campos, fixado };
}

/** Lê a conferência manual gravada (null para ausente ou formato antigo). */
export function lerConferenciaManual(valor: unknown): ConferenciaManual | null {
  if (!valor || typeof valor !== "object") return null;
  const c = valor as Partial<ConferenciaManual>;
  if (c.manual !== true) return null;
  return {
    manual: true,
    turmaConferida: c.turmaConferida === true,
    cobrancaLancada: c.cobrancaLancada === true,
    em: typeof c.em === "string" ? c.em : "",
    por: typeof c.por === "string" ? c.por : "",
  };
}
