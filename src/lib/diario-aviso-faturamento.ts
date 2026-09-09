// Aviso único no sino: Extras do Diário pendentes de faturar, a partir do
// dia 25. Não é dismissível — some sozinho sem pendência ou ao virar o mês.

import { MESES_PT } from "@/lib/rh-periodo";

export const DIA_INICIO_AVISO_EXTRAS = 25;

export interface AvisoExtrasPendentes {
  titulo: string;
  descricao: string;
}

export function nomeMesSeguinte(hoje: Date): string {
  return MESES_PT[(hoje.getMonth() + 1) % 12].toLowerCase();
}

// `pendencias`: quantidade de alunos/unidades com algo a faturar hoje
// (já excluídos faturados e isentos — mesma consulta da aba Faturamento).
export function avisoExtrasPendentes(
  hoje: Date,
  pendencias: number,
  unidades: readonly string[] = [],
): AvisoExtrasPendentes | null {
  if (hoje.getDate() < DIA_INICIO_AVISO_EXTRAS) return null;
  if (pendencias <= 0) return null;
  const onde = unidades.length > 0 ? ` (${unidades.join(", ")})` : "";
  return {
    titulo: "Extras do Diário do Aluno pendentes de faturar",
    descricao: `Lance até o fim do mês para entrarem no boleto de ${nomeMesSeguinte(hoje)}${onde}.`,
  };
}
