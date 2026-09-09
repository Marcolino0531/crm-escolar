// Divisão de acesso do Diário do Aluno, no mesmo padrão da Colônia de Férias:
//   • 'diario'            → operacional: Registro e Consumos Extras.
//   • 'diario_financeiro' → financeiro: Auditoria Sponte, Tabela de Preços e
//                           Faturamento (onde fica a isenção de consumo).

export type AbaDiario = "registro" | "extras" | "auditoria" | "precos" | "faturamento";

export const ABAS_OPERACIONAIS_DIARIO: readonly AbaDiario[] = ["registro", "extras"];
export const ABAS_FINANCEIRAS_DIARIO: readonly AbaDiario[] = ["auditoria", "precos", "faturamento"];

export interface AcessoDiario {
  operacional: boolean;
  financeiro: boolean;
}

export function podeAbrirDiario(a: AcessoDiario): boolean {
  return a.operacional || a.financeiro;
}

export function abasDiarioVisiveis(a: AcessoDiario): AbaDiario[] {
  return [
    ...(a.operacional ? ABAS_OPERACIONAIS_DIARIO : []),
    ...(a.financeiro ? ABAS_FINANCEIRAS_DIARIO : []),
  ];
}

// Aba que abre por padrão: a primeira visível.
export function abaInicialDiario(a: AcessoDiario): AbaDiario | null {
  return abasDiarioVisiveis(a)[0] ?? null;
}
