import { describe, expect, it } from "vitest";
import {
  DIAS_PARA_PACOTE,
  FRANQUIA_MINUTOS,
  VALOR_DIARIA_AVULSA,
  VALOR_HORA_EXTRA,
  VALOR_LANCHE,
  VALOR_PACOTE_SEMANAL,
  VALOR_REFEICAO_PRINCIPAL,
  computeDayBilling,
  computeWeekBilling,
  computeWeekPermanencia,
  mealValue,
  sponteAtivoNoMes,
} from "@/lib/colonia-billing";
import {
  COLONIA_VALORES_PADRAO,
  mesesValidos,
  resolverValoresColonia,
  valoresValidos,
  type ColoniaValores,
  type ColoniaValoresRegistro,
} from "@/lib/colonia-valores";
import type { ColoniaRecord, ColoniaRecordType } from "@/lib/colonia";

const CEC = "11111111-1111-1111-1111-111111111111";
const BABY = "22222222-2222-2222-2222-222222222222";

const CUSTOM: ColoniaValores = {
  diariaAvulsa: 150,
  pacoteSemanal: 700,
  horaExtraPorHora: 20,
  lanchePorRegistro: 10,
  refeicaoPrincipalPorRegistro: 30,
  franquiaMinutos: 240,
  diasParaPacote: 4,
  mesesCreditoIsencao: [1, 7],
};

const REGISTRO_CEC_2026: ColoniaValoresRegistro = {
  ...CUSTOM,
  id: "r1",
  schoolId: CEC,
  unidade: "CEC",
  anoLetivo: 2026,
  atualizadoEm: "2026-01-01T00:00:00Z",
  atualizadoPor: "Teste",
};

let seq = 0;
function rec(type: ColoniaRecordType, iso: string): ColoniaRecord {
  return { id: `r${++seq}`, record_type: type, occurred_at: iso };
}
// Dia com 5h30 de permanência (1h acima da franquia padrão) + almoço + lanche.
function diaCheio(dia: number): ColoniaRecord[] {
  const d = String(dia).padStart(2, "0");
  return [
    rec("entry", `2026-07-${d}T08:00:00-03:00`),
    rec("lunch", `2026-07-${d}T12:00:00-03:00`),
    rec("snack", `2026-07-${d}T15:00:00-03:00`),
    rec("exit", `2026-07-${d}T13:30:00-03:00`),
  ];
}

describe("valores padrão (fallback) da Colônia", () => {
  it("batem exatamente com as constantes históricas", () => {
    expect(COLONIA_VALORES_PADRAO).toEqual({
      franquiaMinutos: 270,
      diariaAvulsa: 130,
      pacoteSemanal: 596,
      horaExtraPorHora: 11.3,
      lanchePorRegistro: 17.9,
      refeicaoPrincipalPorRegistro: 21.5,
      diasParaPacote: 5,
      mesesCreditoIsencao: [7, 12],
    });
    expect(FRANQUIA_MINUTOS).toBe(270);
    expect(VALOR_DIARIA_AVULSA).toBe(130);
    expect(VALOR_PACOTE_SEMANAL).toBe(596);
    expect(VALOR_HORA_EXTRA).toBe(11.3);
    expect(VALOR_LANCHE).toBe(17.9);
    expect(VALOR_REFEICAO_PRINCIPAL).toBe(21.5);
    expect(DIAS_PARA_PACOTE).toBe(5);
  });

  it("sem cadastro para a unidade/ano → padrão + aviso com unidade e ano", () => {
    const r = resolverValoresColonia([REGISTRO_CEC_2026], BABY, 2026, "CEC Baby");
    expect(r.padrao).toBe(true);
    expect(r.valores).toEqual(COLONIA_VALORES_PADRAO);
    expect(r.aviso).toContain("CEC Baby");
    expect(r.aviso).toContain("2026");
    expect(r.aviso).toContain("padrão");
  });

  it("mesma unidade em outro ano também cai no padrão", () => {
    const r = resolverValoresColonia([REGISTRO_CEC_2026], CEC, 2027, "CEC");
    expect(r.padrao).toBe(true);
    expect(r.aviso).toContain("2027");
  });

  it("com cadastro para a unidade/ano → usa os valores da tabela, sem aviso", () => {
    const r = resolverValoresColonia([REGISTRO_CEC_2026], CEC, 2026, "CEC");
    expect(r.padrao).toBe(false);
    expect(r.aviso).toBeNull();
    expect(r.valores).toEqual(CUSTOM);
  });
});

describe("cálculo da Colônia com valores customizados vs. padrão", () => {
  it("refeições usam o valor da tabela", () => {
    expect(mealValue("lunch")).toBe(21.5);
    expect(mealValue("snack")).toBe(17.9);
    expect(mealValue("lunch", CUSTOM)).toBe(30);
    expect(mealValue("breakfast", CUSTOM)).toBe(10);
  });

  it("dia: franquia e hora extra seguem a tabela", () => {
    const padrao = computeDayBilling(diaCheio(6), 1, new Set());
    // 5h30 − 4h30 = 1h → 1 × 11,30; almoço 21,50 + lanche 17,90
    expect(padrao.horasExtras).toBe(1);
    expect(padrao.custoHorasExtras).toBe(11.3);
    expect(padrao.custoRefeicoes).toBe(39.4);

    const custom = computeDayBilling(diaCheio(6), 1, new Set(), CUSTOM);
    // 5h30 − 4h00 = 1h30 → 2h × 20; almoço 30 + lanche 10
    expect(custom.horasExtras).toBe(2);
    expect(custom.custoHorasExtras).toBe(40);
    expect(custom.custoRefeicoes).toBe(40);
  });

  it("semana: diária, pacote e limiar de dias seguem a tabela", () => {
    const dias4 = [6, 7, 8, 9].map((d, i) => computeDayBilling(diaCheio(d), i + 1, new Set()));
    // padrão: 4 dias não fecham pacote → 4 × 130 + 4 × 11,30
    expect(computeWeekPermanencia(dias4)).toBe(565.2);
    const semana = computeWeekBilling({
      days: dias4,
      permanenciaSemanasAnteriores: 0,
      creditoHoraExtra: 0,
    });
    expect(semana.isPacote).toBe(false);
    expect(semana.diariaValor).toBe(520);

    const dias4c = [6, 7, 8, 9].map((d, i) =>
      computeDayBilling(diaCheio(d), i + 1, new Set(), CUSTOM),
    );
    // custom: 4 dias já fecham pacote (700) + 4 × 2h × 20
    expect(computeWeekPermanencia(dias4c, CUSTOM)).toBe(860);
    const semanaC = computeWeekBilling({
      days: dias4c,
      permanenciaSemanasAnteriores: 0,
      creditoHoraExtra: 0,
      valores: CUSTOM,
    });
    expect(semanaC.isPacote).toBe(true);
    expect(semanaC.diariaValor).toBe(700);
    expect(semanaC.horasExtrasValor).toBe(160);
    expect(semanaC.refeicoesValor).toBe(160);
    expect(semanaC.total).toBe(1020);
  });

  it("meses de crédito/isenção: padrão Julho/Dezembro; customizado segue a tabela", () => {
    expect(sponteAtivoNoMes(7)).toBe(true);
    expect(sponteAtivoNoMes(12)).toBe(true);
    expect(sponteAtivoNoMes(1)).toBe(false);
    expect(sponteAtivoNoMes(1, CUSTOM.mesesCreditoIsencao)).toBe(true);
    expect(sponteAtivoNoMes(12, CUSTOM.mesesCreditoIsencao)).toBe(false);
  });
});

describe("validação do cadastro", () => {
  it("meses fora de 1-12 são inválidos", () => {
    expect(mesesValidos([7, 12])).toBe(true);
    expect(mesesValidos([])).toBe(true);
    expect(mesesValidos([0, 7])).toBe(false);
    expect(mesesValidos([13])).toBe(false);
    expect(mesesValidos([6.5])).toBe(false);
  });

  it("valores negativos, dias fora de 1-5 e franquia fracionária são rejeitados", () => {
    expect(valoresValidos(COLONIA_VALORES_PADRAO)).toBeNull();
    expect(valoresValidos({ ...CUSTOM, diariaAvulsa: -1 })).not.toBeNull();
    expect(valoresValidos({ ...CUSTOM, diasParaPacote: 6 })).not.toBeNull();
    expect(valoresValidos({ ...CUSTOM, franquiaMinutos: 10.5 })).not.toBeNull();
    expect(valoresValidos({ ...CUSTOM, mesesCreditoIsencao: [14] })).not.toBeNull();
  });
});
