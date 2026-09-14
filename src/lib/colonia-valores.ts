// Valores e regras de cálculo da Colônia de Férias por unidade × ano letivo —
// lógica pura. Sem cadastro para a unidade/ano, o cálculo usa os valores
// padrão (os que estavam fixos no código) e avisa.

export type ColoniaValores = {
  diariaAvulsa: number;
  pacoteSemanal: number;
  horaExtraPorHora: number;
  lanchePorRegistro: number;
  refeicaoPrincipalPorRegistro: number;
  franquiaMinutos: number;
  diasParaPacote: number;
  mesesCreditoIsencao: number[]; // 1-12
};

export const COLONIA_VALORES_PADRAO: ColoniaValores = {
  diariaAvulsa: 130,
  pacoteSemanal: 596,
  horaExtraPorHora: 11.3,
  lanchePorRegistro: 17.9,
  refeicaoPrincipalPorRegistro: 21.5,
  franquiaMinutos: 270, // 4h30
  diasParaPacote: 5,
  mesesCreditoIsencao: [7, 12],
};

export interface ColoniaValoresRegistro extends ColoniaValores {
  id: string;
  schoolId: string;
  unidade: string;
  anoLetivo: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

export type ColoniaValoresResolvidos = {
  valores: ColoniaValores;
  padrao: boolean;
  aviso: string | null;
};

// Valores de uma unidade/ano; cai no padrão (com aviso) quando não há cadastro.
export function resolverValoresColonia(
  registros: readonly ColoniaValoresRegistro[],
  schoolId: string,
  anoLetivo: number,
  nomeUnidade?: string,
): ColoniaValoresResolvidos {
  const r = registros.find((x) => x.schoolId === schoolId && x.anoLetivo === anoLetivo);
  if (r) {
    return {
      valores: {
        diariaAvulsa: r.diariaAvulsa,
        pacoteSemanal: r.pacoteSemanal,
        horaExtraPorHora: r.horaExtraPorHora,
        lanchePorRegistro: r.lanchePorRegistro,
        refeicaoPrincipalPorRegistro: r.refeicaoPrincipalPorRegistro,
        franquiaMinutos: r.franquiaMinutos,
        diasParaPacote: r.diasParaPacote,
        mesesCreditoIsencao: [...r.mesesCreditoIsencao].sort((a, b) => a - b),
      },
      padrao: false,
      aviso: null,
    };
  }
  return {
    valores: COLONIA_VALORES_PADRAO,
    padrao: true,
    aviso: avisoValoresPadrao(nomeUnidade ?? schoolId, anoLetivo),
  };
}

export function avisoValoresPadrao(unidade: string, anoLetivo: number): string {
  return `Sem cadastro de Valor Colônia de Férias para ${unidade} em ${anoLetivo}: usando os valores padrão. Cadastre em Configurações → Cadastros Gerais.`;
}

export const MESES_ROTULO: Record<number, string> = {
  1: "Jan",
  2: "Fev",
  3: "Mar",
  4: "Abr",
  5: "Mai",
  6: "Jun",
  7: "Jul",
  8: "Ago",
  9: "Set",
  10: "Out",
  11: "Nov",
  12: "Dez",
};

export function mesesValidos(meses: readonly number[]): boolean {
  return meses.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
}

export function valoresValidos(v: ColoniaValores): string | null {
  const numeros: [string, number][] = [
    ["Diária avulsa", v.diariaAvulsa],
    ["Pacote semanal", v.pacoteSemanal],
    ["Hora extra", v.horaExtraPorHora],
    ["Lanche", v.lanchePorRegistro],
    ["Refeição principal", v.refeicaoPrincipalPorRegistro],
  ];
  for (const [rotulo, n] of numeros) {
    if (!Number.isFinite(n) || n < 0) return `${rotulo}: informe um valor maior ou igual a zero.`;
  }
  if (!Number.isInteger(v.franquiaMinutos) || v.franquiaMinutos < 0)
    return "Franquia (minutos): informe um inteiro maior ou igual a zero.";
  if (!Number.isInteger(v.diasParaPacote) || v.diasParaPacote < 1 || v.diasParaPacote > 5)
    return "Dias para pacote: informe um inteiro entre 1 e 5.";
  if (!mesesValidos(v.mesesCreditoIsencao)) return "Meses de crédito/isenção: use meses de 1 a 12.";
  return null;
}
