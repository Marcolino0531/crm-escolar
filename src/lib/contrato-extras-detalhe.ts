// Lógica PURA do detalhamento da cláusula EXTRAS do Contrato de Matrícula:
// cruza o que o Sponte cobra (valor por categoria) com o plano do aluno no
// Diário (dias de cada refeição e horário de entrada/saída por dia) e com o
// turno regular coberto pela Mensalidade. O Sponte é a fonte do VALOR; o
// Diário só acrescenta dias e horários. Qualquer divergência vira aviso — o
// item continua no texto com nome e valor, sem o detalhe, e o contrato sai.

import type { MealKey, Weekday } from "@/lib/diario";
import type { HorarioDia } from "@/lib/matricula-form";
import {
  CATEGORIAS_EXTRAS,
  listarComE,
  numeroBR,
  TEXTO_SEM_EXTRAS,
  type CategoriaExtra,
  type ExtrasContrato,
} from "@/lib/contrato-matricula";

export interface HorarioRegistrado {
  entry: string;
  exit: string;
}

/** Plano do aluno no Diário para o ano letivo do contrato. */
export interface PlanoDiarioContrato {
  refeicoes: Record<MealKey, Weekday[]>;
  horarios: Partial<Record<Weekday, HorarioRegistrado>>;
  /** Horário do turno regular (HORARIOS_PADRAO); null = turno desconhecido. */
  turnoRegular: HorarioDia | null;
}

export interface IntervaloHoraExtra {
  inicio: string;
  fim: string;
}

const REFEICAO_POR_CATEGORIA: Partial<Record<CategoriaExtra, MealKey>> = {
  "Lanche da Manhã": "breakfast",
  Almoço: "lunch",
  "Lanche da Tarde": "snack",
  Jantar: "dinner",
};

// Ordem de leitura no texto: segunda primeiro, domingo por último.
const ORDEM_DIAS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const NOME_DIA: Record<Weekday, string> = {
  0: "domingo",
  1: "segunda-feira",
  2: "terça-feira",
  3: "quarta-feira",
  4: "quinta-feira",
  5: "sexta-feira",
  6: "sábado",
};
const DIAS_UTEIS: readonly Weekday[] = [1, 2, 3, 4, 5];

function ordenarDias(dias: readonly Weekday[]): Weekday[] {
  const unicos = new Set(dias);
  return ORDEM_DIAS.filter((d) => unicos.has(d));
}

/** "de segunda a sexta-feira" para os 5 dias úteis; senão os dias por extenso. */
export function descreverDias(dias: readonly Weekday[]): string {
  const ordenados = ordenarDias(dias);
  if (ordenados.length === 0) return "";
  if (ordenados.length === 5 && DIAS_UTEIS.every((d) => ordenados.includes(d))) {
    return "de segunda a sexta-feira";
  }
  return listarComE(ordenados.map((d) => NOME_DIA[d]));
}

const RE_HORA = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Minutos desde 00:00; null para texto vazio/inválido. */
export function minutosDoHorario(hhmm: string): number | null {
  const m = RE_HORA.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function hhmm(hora: string): string {
  const m = RE_HORA.exec(hora.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : hora.trim();
}

/**
 * Intervalos de Hora Extra de um dia: o que fica ANTES da entrada regular e o
 * que fica DEPOIS da saída regular. Horário dentro do turno → lista vazia.
 * Horário inválido → null (o chamador avisa).
 */
export function intervalosHoraExtraDoDia(
  registrado: HorarioRegistrado,
  turno: HorarioDia,
): IntervaloHoraExtra[] | null {
  const entrada = minutosDoHorario(registrado.entry);
  const saida = minutosDoHorario(registrado.exit);
  const entradaRegular = minutosDoHorario(turno.entrada);
  const saidaRegular = minutosDoHorario(turno.saida);
  if (entrada === null || saida === null || entradaRegular === null || saidaRegular === null) {
    return null;
  }
  if (saida <= entrada) return null;
  const intervalos: IntervaloHoraExtra[] = [];
  if (entrada < entradaRegular) {
    intervalos.push({ inicio: hhmm(registrado.entry), fim: hhmm(turno.entrada) });
  }
  if (saida > saidaRegular) {
    intervalos.push({ inicio: hhmm(turno.saida), fim: hhmm(registrado.exit) });
  }
  return intervalos;
}

function descreverIntervalos(intervalos: readonly IntervaloHoraExtra[]): string {
  return listarComE(intervalos.map((i) => `das ${i.inicio} às ${i.fim}`));
}

function chaveIntervalos(intervalos: readonly IntervaloHoraExtra[]): string {
  return intervalos.map((i) => `${i.inicio}-${i.fim}`).join("|");
}

export interface HoraExtraDetalhada {
  /** Dias com pelo menos um intervalo extra, na ordem de leitura. */
  dias: Weekday[];
  porDia: Partial<Record<Weekday, IntervaloHoraExtra[]>>;
  /** Minutos extras somados na semana (conferência). */
  minutosSemana: number;
  /** "das 11:00 às 13:00, de segunda a sexta-feira" ou dia a dia; "" sem extra. */
  texto: string;
  avisos: string[];
}

/** Hora Extra da semana a partir do horário registrado × turno regular. */
export function horaExtraDaSemana(
  horarios: PlanoDiarioContrato["horarios"],
  turno: HorarioDia,
): HoraExtraDetalhada {
  const porDia: Partial<Record<Weekday, IntervaloHoraExtra[]>> = {};
  const avisos: string[] = [];
  let minutosSemana = 0;
  for (const dia of ORDEM_DIAS) {
    const registrado = horarios[dia];
    if (!registrado) continue;
    const intervalos = intervalosHoraExtraDoDia(registrado, turno);
    if (intervalos === null) {
      avisos.push(
        `Horário inválido no Diário na ${NOME_DIA[dia]} (${registrado.entry || "?"}–${registrado.exit || "?"}); dia ignorado na Hora Extra.`,
      );
      continue;
    }
    if (intervalos.length === 0) continue;
    porDia[dia] = intervalos;
    for (const i of intervalos) {
      minutosSemana += (minutosDoHorario(i.fim) ?? 0) - (minutosDoHorario(i.inicio) ?? 0);
    }
  }
  const dias = ORDEM_DIAS.filter((d) => porDia[d]);
  if (dias.length === 0) return { dias, porDia, minutosSemana, texto: "", avisos };

  const chaves = new Set(dias.map((d) => chaveIntervalos(porDia[d]!)));
  const texto =
    chaves.size === 1
      ? `${descreverIntervalos(porDia[dias[0]]!)}, ${descreverDias(dias)}`
      : dias.map((d) => `${NOME_DIA[d]} ${descreverIntervalos(porDia[d]!)}`).join(", ");
  return { dias, porDia, minutosSemana, texto, avisos };
}

function item(nome: string, valor: number, detalhe: string): string {
  return detalhe ? `${nome} (R$${numeroBR(valor)}, ${detalhe})` : `${nome} (R$${numeroBR(valor)})`;
}

/**
 * Recalcula `lista` e `avisos` dos extras com o plano do Diário. Sem plano
 * (`null`), cada item sai só com nome e valor e o motivo vai para os avisos.
 * `valorMensal` e `categorias` nunca mudam: o valor é sempre o do Sponte.
 */
export function detalharExtrasContrato(
  extras: ExtrasContrato,
  plano: PlanoDiarioContrato | null,
  motivoSemPlano?: string,
): ExtrasContrato {
  const avisos: string[] = [...extras.avisos];
  if (extras.categorias.length === 0) {
    if (plano) {
      for (const aviso of extrasNoDiarioSemCobranca(extras, plano)) avisos.push(aviso);
    }
    return { ...extras, lista: TEXTO_SEM_EXTRAS, avisos };
  }

  if (!plano) {
    avisos.push(
      motivoSemPlano ??
        "Plano do aluno no Diário não encontrado; EXTRAS sem dias e horários no contrato.",
    );
    return {
      ...extras,
      lista: listarComE(
        extras.categorias.map((c) => item(c, extras.valorPorCategoria[c] ?? 0, "")),
      ),
      avisos,
    };
  }

  let horaExtra: HoraExtraDetalhada | null = null;
  if (plano.turnoRegular) {
    horaExtra = horaExtraDaSemana(plano.horarios, plano.turnoRegular);
    avisos.push(...horaExtra.avisos);
  }

  const itens = extras.categorias.map((cat) => {
    const valor = extras.valorPorCategoria[cat] ?? 0;
    if (cat === "Hora Extra") {
      if (!plano.turnoRegular) {
        avisos.push(
          "Turno regular do aluno desconhecido (sem rotina para o ano do contrato); Hora Extra sem horário no contrato.",
        );
        return item(cat, valor, "");
      }
      if (!horaExtra || horaExtra.dias.length === 0) {
        avisos.push(
          Object.keys(plano.horarios).length === 0
            ? "Hora Extra cobrada no Sponte, mas o Diário não tem horários registrados para o aluno."
            : "Hora Extra cobrada no Sponte, mas o horário registrado no Diário fica dentro do turno regular.",
        );
        return item(cat, valor, "");
      }
      return item(cat, valor, horaExtra.texto);
    }
    const meal = REFEICAO_POR_CATEGORIA[cat];
    const dias = meal ? plano.refeicoes[meal] : [];
    if (!dias || dias.length === 0) {
      avisos.push(`${cat} cobrado no Sponte, mas sem dias marcados no plano do Diário.`);
      return item(cat, valor, "");
    }
    return item(cat, valor, descreverDias(dias));
  });

  for (const aviso of extrasNoDiarioSemCobranca(extras, plano, horaExtra)) avisos.push(aviso);

  return { ...extras, lista: listarComE(itens), avisos };
}

/** Lado inverso: o Diário tem o serviço, mas o Sponte não cobra. */
function extrasNoDiarioSemCobranca(
  extras: ExtrasContrato,
  plano: PlanoDiarioContrato,
  horaExtra: HoraExtraDetalhada | null = plano.turnoRegular
    ? horaExtraDaSemana(plano.horarios, plano.turnoRegular)
    : null,
): string[] {
  const avisos: string[] = [];
  const cobradas = new Set<CategoriaExtra>(extras.categorias);
  for (const cat of CATEGORIAS_EXTRAS) {
    if (cobradas.has(cat)) continue;
    if (cat === "Hora Extra") {
      if (horaExtra && horaExtra.dias.length > 0) {
        avisos.push(
          `Diário registra Hora Extra (${horaExtra.texto}), mas não há cobrança de Hora Extra no Sponte para o ano do contrato.`,
        );
      }
      continue;
    }
    const meal = REFEICAO_POR_CATEGORIA[cat];
    const dias = meal ? plano.refeicoes[meal] : [];
    if (dias && dias.length > 0) {
      avisos.push(
        `Diário marca ${cat} (${descreverDias(dias)}), mas não há cobrança de ${cat} no Sponte para o ano do contrato.`,
      );
    }
  }
  return avisos;
}
