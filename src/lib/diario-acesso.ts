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

// Botões do cabeçalho do modal do aluno e o que o PlanEditor libera.
// "Plano" abre para quem só visualiza (leitura); "Foto" e o salvar exigem edição.
export interface AcoesPlanoAluno {
  mostrarBotaoPlano: boolean;
  mostrarBotaoFoto: boolean;
  planoEditavel: boolean;
  mostrarSalvarPlano: boolean;
}

export function acoesPlanoAluno(p: { canView: boolean; canEdit: boolean }): AcoesPlanoAluno {
  const editavel = p.canView && p.canEdit;
  return {
    mostrarBotaoPlano: p.canView,
    mostrarBotaoFoto: editavel,
    planoEditavel: editavel,
    mostrarSalvarPlano: editavel,
  };
}
