// Acesso à sub-visão "Salário" de RH → Pagamentos. Depende SOMENTE do módulo
// dedicado 'rh_salario' — editar 'rh' não dá acesso nem à leitura.

export interface PermissoesRhSalario {
  canViewRhSalario: boolean;
  canEditRhSalario: boolean;
}

export interface AcessoSalario {
  // Mostrar a sub-visão "Salário" e permitir abrir (inclusive por URL direta).
  visivel: boolean;
  // Cadastrar/editar valores.
  editavel: boolean;
}

export function acessoSalario(p: PermissoesRhSalario): AcessoSalario {
  const visivel = p.canViewRhSalario;
  return { visivel, editavel: visivel && p.canEditRhSalario };
}

// Sub-visão de Pagamentos que abre por padrão; "salario" nunca é aceita sem
// permissão (ex.: valor vindo da URL).
export type SubPagamentos = "vt" | "salario";

export function subPagamentosPermitida(
  pedida: string | null | undefined,
  acesso: AcessoSalario,
): SubPagamentos {
  return pedida === "salario" && acesso.visivel ? "salario" : "vt";
}
