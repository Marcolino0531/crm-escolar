// Motor financeiro da Colônia de Férias — cálculo progressivo por semana.
//
// Regras (serviço avulso pago por uso):
//  1. Franquia diária de 4h30 de permanência (Entrada → Saída).
//  2. Diárias avulsas de R$ 130,00/dia para 1 a 4 dias na semana.
//  3. Virada de pacote: ao atingir 5 dias na semana, a soma das diárias é
//     substituída pelo pacote fechado de R$ 596,00.
//  4. Hora extra: R$ 11,30 por hora (fração conta como hora cheia) que exceder
//     a franquia diária, tanto na diária avulsa quanto no pacote.
//  5. Lanches (manhã/tarde): R$ 17,90 por registro.
//  6. Refeições principais (almoço/jantar): R$ 21,50 por registro.
//  7. Trava de calendário: crédito/isenção do Sponte valem SÓ em Julho e
//     Dezembro. Nos demais meses (ex.: Colônia de Janeiro) cobra-se 100%.
//  8. Crédito de hora extra (Julho/Dezembro): valor mensal pago de "Hora Extra"
//     na mensalidade vira um banco de crédito, abatido das diárias+horas e que
//     transita entre as semanas do mês até zerar.
//  9. Isenção de refeição (Julho/Dezembro): refeição inclusa na mensalidade tem
//     a cobrança zerada nos dias em que for registrada na colônia.
import { COLONIA_RECORD_LABEL, type ColoniaRecord, type ColoniaRecordType } from "@/lib/colonia";

export const FRANQUIA_MINUTOS = 270; // 4h30
export const VALOR_DIARIA_AVULSA = 130;
export const VALOR_PACOTE_SEMANAL = 596;
export const VALOR_HORA_EXTRA = 11.3;
export const VALOR_LANCHE = 17.9; // breakfast, snack
export const VALOR_REFEICAO_PRINCIPAL = 21.5; // lunch, dinner
export const DIAS_PARA_PACOTE = 5;

export const LANCHE_TYPES: ColoniaRecordType[] = ["breakfast", "snack"];
export const REFEICAO_TYPES: ColoniaRecordType[] = ["lunch", "dinner"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isLanche(t: ColoniaRecordType): boolean {
  return t === "breakfast" || t === "snack";
}
export function isRefeicaoPrincipal(t: ColoniaRecordType): boolean {
  return t === "lunch" || t === "dinner";
}
export function mealValue(t: ColoniaRecordType): number {
  if (isLanche(t)) return VALOR_LANCHE;
  if (isRefeicaoPrincipal(t)) return VALOR_REFEICAO_PRINCIPAL;
  return 0;
}

export type MealCharge = {
  type: ColoniaRecordType;
  label: string;
  valor: number; // já considerando isenção (0 quando isento)
  isento: boolean;
  occurredAt: string;
};

export type DayBilling = {
  weekday: number;
  attended: boolean; // teve Entrada/Saída → conta diária
  entry: string | null;
  exit: string | null;
  permanenciaMin: number; // 0 quando incompleto
  horasExtras: number; // horas cheias acima da franquia
  custoHorasExtras: number;
  meals: MealCharge[];
  custoRefeicoes: number; // soma das refeições não isentas
};

// Menor Entrada e maior Saída do dia definem a janela de permanência.
export function computeDayBilling(
  records: ColoniaRecord[],
  weekday: number,
  exemptions: Set<ColoniaRecordType>,
): DayBilling {
  let entry: string | null = null;
  let exit: string | null = null;
  const meals: MealCharge[] = [];

  for (const r of records) {
    if (r.record_type === "entry") {
      if (!entry || r.occurred_at < entry) entry = r.occurred_at;
    } else if (r.record_type === "exit") {
      if (!exit || r.occurred_at > exit) exit = r.occurred_at;
    } else {
      const isento = exemptions.has(r.record_type);
      meals.push({
        type: r.record_type,
        label: COLONIA_RECORD_LABEL[r.record_type],
        valor: isento ? 0 : mealValue(r.record_type),
        isento,
        occurredAt: r.occurred_at,
      });
    }
  }

  let permanenciaMin = 0;
  if (entry && exit) {
    const diff = (new Date(exit).getTime() - new Date(entry).getTime()) / 60000;
    permanenciaMin = diff > 0 ? diff : 0;
  }
  const excedente = Math.max(0, permanenciaMin - FRANQUIA_MINUTOS);
  const horasExtras = excedente > 0 ? Math.ceil(excedente / 60) : 0;
  const custoHorasExtras = round2(horasExtras * VALOR_HORA_EXTRA);
  const custoRefeicoes = round2(meals.reduce((s, m) => s + m.valor, 0));

  return {
    weekday,
    attended: entry !== null || exit !== null,
    entry,
    exit,
    permanenciaMin,
    horasExtras,
    custoHorasExtras,
    meals,
    custoRefeicoes,
  };
}

// Permanência bruta da semana (diárias + horas extras), antes do crédito. Usada
// tanto no extrato da semana quanto para medir o consumo das semanas anteriores.
export function computeWeekPermanencia(days: DayBilling[]): number {
  const attendedDays = days.filter((d) => d.attended).length;
  const diaria =
    attendedDays >= DIAS_PARA_PACOTE ? VALOR_PACOTE_SEMANAL : attendedDays * VALOR_DIARIA_AVULSA;
  const horas = days.reduce((s, d) => s + d.custoHorasExtras, 0);
  return round2(diaria + horas);
}

export type Rubrica = { label: string; qtd: number; valor: number };

export type CreditoTransparencia = {
  original: number;
  usadoSemanasAnteriores: number;
  restanteAplicadoEstaSemana: number;
};

export type WeekBilling = {
  attendedDays: number;
  isPacote: boolean;
  diariaValor: number;
  horasExtrasQtd: number;
  horasExtrasValor: number;
  permanenciaBruta: number; // diárias + horas (antes do crédito)
  refeicoesValor: number;
  rubricas: Rubrica[];
  isencoes: string[]; // ex.: "Isenção Sponte: Almoço"
  credito: CreditoTransparencia | null;
  avisos: string[];
  total: number;
};

export type WeekBillingInput = {
  days: DayBilling[];
  // Permanência bruta somada das semanas anteriores do MESMO mês (para o crédito
  // transitar). Zero quando é a primeira semana do mês.
  permanenciaSemanasAnteriores: number;
  // Banco de crédito mensal de hora extra (0 se não houver / mês sem Sponte).
  creditoHoraExtra: number;
};

export function computeWeekBilling(input: WeekBillingInput): WeekBilling {
  const { days, permanenciaSemanasAnteriores, creditoHoraExtra } = input;

  const attendedDays = days.filter((d) => d.attended).length;
  const isPacote = attendedDays >= DIAS_PARA_PACOTE;
  const diariaValor = isPacote ? VALOR_PACOTE_SEMANAL : attendedDays * VALOR_DIARIA_AVULSA;

  const horasExtrasQtd = days.reduce((s, d) => s + d.horasExtras, 0);
  const horasExtrasValor = round2(days.reduce((s, d) => s + d.custoHorasExtras, 0));
  const permanenciaBruta = round2(diariaValor + horasExtrasValor);

  const refeicoesValor = round2(days.reduce((s, d) => s + d.custoRefeicoes, 0));

  // Rubricas de permanência.
  const rubricas: Rubrica[] = [];
  if (attendedDays > 0) {
    rubricas.push(
      isPacote
        ? { label: "Pacote Semanal (5 dias)", qtd: 1, valor: VALOR_PACOTE_SEMANAL }
        : {
            label: `${attendedDays} ${attendedDays === 1 ? "Diária Avulsa" : "Diárias Avulsas"}`,
            qtd: attendedDays,
            valor: round2(attendedDays * VALOR_DIARIA_AVULSA),
          },
    );
  }
  if (horasExtrasQtd > 0) {
    rubricas.push({
      label: `${horasExtrasQtd} ${horasExtrasQtd === 1 ? "Hora Extra" : "Horas Extras"}`,
      qtd: horasExtrasQtd,
      valor: horasExtrasValor,
    });
  }

  // Rubricas de alimentação (agrupadas por grupo), contando só os não isentos.
  const lanchesCobrados = days.flatMap((d) => d.meals.filter((m) => isLanche(m.type) && !m.isento));
  const principaisCobradas = days.flatMap((d) =>
    d.meals.filter((m) => isRefeicaoPrincipal(m.type) && !m.isento),
  );
  if (lanchesCobrados.length > 0) {
    rubricas.push({
      label: `${lanchesCobrados.length} ${lanchesCobrados.length === 1 ? "Lanche" : "Lanches"}`,
      qtd: lanchesCobrados.length,
      valor: round2(lanchesCobrados.reduce((s, m) => s + m.valor, 0)),
    });
  }
  if (principaisCobradas.length > 0) {
    rubricas.push({
      label: `${principaisCobradas.length} ${
        principaisCobradas.length === 1 ? "Refeição Principal" : "Refeições Principais"
      }`,
      qtd: principaisCobradas.length,
      valor: round2(principaisCobradas.reduce((s, m) => s + m.valor, 0)),
    });
  }

  // Isenções aplicadas (refeições que apareceram e estavam isentas).
  const isentosTipos = new Set<ColoniaRecordType>();
  for (const d of days) {
    for (const m of d.meals) if (m.isento) isentosTipos.add(m.type);
  }
  const isencoes = [...isentosTipos].map((t) => `Isenção Sponte: ${COLONIA_RECORD_LABEL[t]}`);

  // Crédito de hora extra: transita entre as semanas do mês, abatendo a
  // permanência (diárias + horas). Drenagem monótona ⇒ o usado nas semanas
  // anteriores é min(banco, permanência anterior acumulada).
  const avisos: string[] = [];
  let credito: CreditoTransparencia | null = null;
  let permanenciaLiquida = permanenciaBruta;
  if (creditoHoraExtra > 0) {
    const usadoAntes = Math.min(creditoHoraExtra, round2(permanenciaSemanasAnteriores));
    const restante = round2(creditoHoraExtra - usadoAntes);
    const aplicadoAgora = round2(Math.min(restante, permanenciaBruta));
    permanenciaLiquida = round2(permanenciaBruta - aplicadoAgora);
    credito = {
      original: round2(creditoHoraExtra),
      usadoSemanasAnteriores: round2(usadoAntes),
      restanteAplicadoEstaSemana: aplicadoAgora,
    };
    if (aplicadoAgora > 0) {
      avisos.push(
        `Crédito de hora extra aplicado nesta semana: R$ ${aplicadoAgora.toFixed(2).replace(".", ",")}.`,
      );
    }
  }

  const total = round2(permanenciaLiquida + refeicoesValor);

  return {
    attendedDays,
    isPacote,
    diariaValor: round2(diariaValor),
    horasExtrasQtd,
    horasExtrasValor,
    permanenciaBruta,
    refeicoesValor,
    rubricas,
    isencoes,
    credito,
    avisos,
    total,
  };
}

// Julho e Dezembro habilitam as regras do Sponte (crédito + isenção). mês 1-based.
export function sponteAtivoNoMes(mes1: number): boolean {
  return mes1 === 7 || mes1 === 12;
}
