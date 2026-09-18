// Salário base por funcionário × competência (YYYY-MM), histórico preservado.

export type SalarioRegistro = {
  id: string;
  funcionarioId: string;
  competencia: string; // YYYY-MM
  valor: number; // bruto
  valorLiquido: number | null;
  observacao: string;
  criadoEm: string;
  criadoPor: string;
};

const RE_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

export function competenciaValida(c: string): boolean {
  return RE_COMPETENCIA.test(c);
}

export function competenciaAtual(hoje: Date = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

// { ano: 2026, mes: 9 } ⇄ "2026-09"
export function competenciaDe(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export function partesCompetencia(c: string): { ano: number; mes: number } {
  const [ano, mes] = c.split("-");
  return { ano: Number(ano), mes: Number(mes) };
}

// "2026-09" → "09/2026"
export function rotuloCompetencia(c: string): string {
  const [ano, mes] = c.split("-");
  return `${mes}/${ano}`;
}

// Histórico de um funcionário, competência mais recente primeiro. Não muta a entrada.
export function historicoDoFuncionario(
  registros: readonly SalarioRegistro[],
  funcionarioId: string,
): SalarioRegistro[] {
  return registros
    .filter((r) => r.funcionarioId === funcionarioId)
    .sort((a, b) => (a.competencia < b.competencia ? 1 : a.competencia > b.competencia ? -1 : 0));
}

// Salário em vigor numa competência: a linha de maior competência <= a pedida.
// Competência anterior ao primeiro registro → null (sem salário cadastrado ainda).
export function salarioVigente(
  registros: readonly SalarioRegistro[],
  funcionarioId: string,
  competencia: string,
): SalarioRegistro | null {
  return (
    historicoDoFuncionario(registros, funcionarioId).find((r) => r.competencia <= competencia) ??
    null
  );
}

// Valores iniciais do cadastro numa competência. Se já existe registro próprio,
// usa ele; senão herda do vigente (última competência anterior). `proprio`
// diz se o formulário está editando um registro existente ou criando um novo.
export type PreenchimentoSalario = {
  valor: number | null;
  valorLiquido: number | null;
  observacao: string;
  proprio: boolean;
  origem: string | null; // competência de onde os valores vieram
};

export function preenchimentoSalario(
  registros: readonly SalarioRegistro[],
  funcionarioId: string,
  competencia: string,
): PreenchimentoSalario {
  const v = salarioVigente(registros, funcionarioId, competencia);
  if (!v) return { valor: null, valorLiquido: null, observacao: "", proprio: false, origem: null };
  const proprio = v.competencia === competencia;
  return {
    valor: v.valor,
    valorLiquido: v.valorLiquido,
    observacao: proprio ? v.observacao : "",
    proprio,
    origem: v.competencia,
  };
}

export type ErroSalario = { competencia?: string; valor?: string; valorLiquido?: string };

export function validarSalario(input: {
  competencia: string;
  valor: number;
  valorLiquido?: number | null;
}): ErroSalario {
  const erros: ErroSalario = {};
  if (!competenciaValida(input.competencia)) erros.competencia = "Informe a competência (MM/AAAA).";
  if (!Number.isFinite(input.valor) || input.valor < 0) {
    erros.valor = "Informe um valor maior ou igual a zero.";
  }
  const liq = input.valorLiquido;
  if (liq != null && (!Number.isFinite(liq) || liq < 0)) {
    erros.valorLiquido = "Informe um valor líquido maior ou igual a zero.";
  }
  return erros;
}
