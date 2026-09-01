// Período dos rankings do RH (faltas manuais e folha de ponto).
//
// Os dois rankings da lateral da tela de Funcionários compartilham o mesmo
// filtro: um mês específico ou o ano inteiro (todos os meses somados). Lógica
// pura, sem dependência de fuso: as datas do cadastro são ISO "YYYY-MM-DD" e a
// competência da folha de ponto é "YYYY-MM", então a comparação é textual.

export type ModoPeriodo = "mes" | "ano";

export type PeriodoRh = {
  modo: ModoPeriodo;
  ano: number;
  // Mês 1–12. Ignorado quando o modo é "ano".
  mes: number;
};

export const MESES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

// Padrão ao abrir a tela: mês atual.
export function periodoAtual(hoje: Date = new Date()): PeriodoRh {
  return { modo: "mes", ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
}

export function rotuloPeriodo(periodo: PeriodoRh): string {
  if (periodo.modo === "ano") return String(periodo.ano);
  return `${MESES_PT[periodo.mes - 1]}/${periodo.ano}`;
}

// Competências ("YYYY-MM") cobertas pelo período: uma no modo mês, doze no ano.
export function competenciasDoPeriodo(periodo: PeriodoRh): string[] {
  if (periodo.modo === "ano") {
    return MESES_PT.map((_, i) => `${periodo.ano}-${String(i + 1).padStart(2, "0")}`);
  }
  return [`${periodo.ano}-${String(periodo.mes).padStart(2, "0")}`];
}

// `data` é ISO ("YYYY-MM-DD"); datas fora do formato ficam fora do período.
export function dentroDoPeriodo(data: string | undefined, periodo: PeriodoRh): boolean {
  if (!data || data.length < 7) return false;
  if (periodo.modo === "ano") return data.slice(0, 4) === String(periodo.ano);
  return data.slice(0, 7) === competenciasDoPeriodo(periodo)[0];
}

// Anos oferecidos no seletor: do ano mais antigo com registro até o ano atual,
// sempre incluindo o ano corrente mesmo quando não há nada lançado.
export function anosDisponiveis(datas: readonly string[], hoje: Date = new Date()): number[] {
  const atual = hoje.getFullYear();
  const anos = new Set<number>([atual]);
  for (const d of datas) {
    const ano = Number(d.slice(0, 4));
    if (Number.isInteger(ano) && ano >= 2000 && ano <= atual + 1) anos.add(ano);
  }
  return [...anos].sort((a, b) => b - a);
}
