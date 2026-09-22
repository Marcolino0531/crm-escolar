// Fechamento mensal MANUAL da inadimplência por unidade — regras puras.
//
// O fechamento congela, para um mês "YYYY-MM" e uma unidade, os mesmos números
// que o card "Inadimplência Anual" do Dashboard calcula ao vivo:
//   • inadimplente = Σ (valorTotalBoleto − valorAcordo) dos boletos em aberto no
//     Sponte (desconto item a item do Acordo, igual a fetchSponteInadimplenciaAnual);
//   • faturamento  = faturamento_retroativo_jan_mai (só 2026) + receitas
//     operacionais do extrato via faturamentoRecebido (mesmas exclusões).
// Só valores em R$ são gravados; percentuais são sempre derivados dos valores,
// para o consolidado somar R$ das quatro unidades e nunca fazer média de %.

import { MESES_PT } from "@/lib/rh-periodo";
import {
  faturamentoRecebido,
  janelaAnual,
  type ReceitaExtrato,
} from "@/lib/inadimplencia-faturamento";
import type { IdsFinanceiros } from "@/lib/dashboard-financeiro";

/** Primeiro mês que pode ser fechado (nada retroativo de Jan–Ago/2026). */
export const PRIMEIRO_MES_FECHAMENTO = "2026-09";
/** O lembrete no sino só aparece a partir deste dia do mês seguinte. */
export const DIA_INICIO_AVISO_FECHAMENTO = 2;

// ── Valores ──────────────────────────────────────────────────────────────────

export interface BoletoAberto {
  valorTotalBoleto: number;
  valorAcordo: number;
}

export function arredondarReais(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Total inadimplente líquido de Acordo e quantidade de boletos com saldo. Mesma
 * regra de fetchSponteInadimplenciaAnual: boleto misto entra só com a parte fora
 * do Acordo; boleto 100% Acordo contribui zero e não é contado.
 */
export function inadimplenteLiquido(pendencias: readonly BoletoAberto[]): {
  total: number;
  boletos: number;
} {
  let total = 0;
  let boletos = 0;
  for (const p of pendencias) {
    const liquido = p.valorTotalBoleto - p.valorAcordo;
    total += liquido;
    if (liquido > 0.005) boletos++;
  }
  return { total: arredondarReais(total), boletos };
}

/** inadimplente ÷ faturamento × 100; `null` quando não há faturamento. */
export function percentualInadimplencia(inadimplente: number, faturamento: number): number | null {
  if (!(faturamento > 0)) return null;
  return (inadimplente / faturamento) * 100;
}

/** Exibição com 1 casa decimal, igual ao card atual ("4,0%"). */
export function formatarPercentual(p: number | null): string {
  if (p === null) return "sem faturamento";
  return `${p.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// ── Janelas de datas ─────────────────────────────────────────────────────────

const RE_ANO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function anoMesValido(anoMes: string): boolean {
  return RE_ANO_MES.test(anoMes);
}

export function ultimoDiaDoMesYMD(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const dia = new Date(ano, mes, 0).getDate();
  return `${anoMes}-${String(dia).padStart(2, "0")}`;
}

/** 01/MM → último dia de MM. */
export function janelaMes(anoMes: string): { inicioYMD: string; fimYMD: string } {
  return { inicioYMD: `${anoMes}-01`, fimYMD: ultimoDiaDoMesYMD(anoMes) };
}

/**
 * 01/01 → último dia de MM, com a regra do card atual para o extrato:
 * em 2026 receitas só desde 01/06 + retroativo Jan–Mai; depois, o ano inteiro.
 * Reaproveita janelaAnual passando o último dia do mês como "hoje".
 */
export function janelaAcumulada(anoMes: string) {
  const ano = Number(anoMes.slice(0, 4));
  return janelaAnual(ano, ultimoDiaDoMesYMD(anoMes));
}

/**
 * Faturamento acumulado no ano até o fim do mês: retroativo Jan–Mai (quando o
 * ano usa retroativo) + receitas operacionais do extrato já filtradas pela
 * janela acumulada. `retroativo` null = não configurado (o chamador trava antes).
 */
export function faturamentoAcumulado(
  retroativo: number | null,
  usaRetroativo: boolean,
  receitas: readonly ReceitaExtrato[],
  ids: IdsFinanceiros,
): number {
  const base = usaRetroativo ? (retroativo ?? 0) : 0;
  return arredondarReais(base + faturamentoRecebido(receitas, ids));
}

// ── Calendário (Brasília) ────────────────────────────────────────────────────

export function anoMesDeData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function mesAnterior(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const d = new Date(ano, mes - 2, 1);
  return anoMesDeData(d);
}

export function rotuloMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  return `${MESES_PT[mes - 1]}/${ano}`;
}

/** "MM/AA", mesmo formato dos demais gráficos do Dashboard. */
export function rotuloCurto(anoMes: string): string {
  return `${anoMes.slice(5, 7)}/${anoMes.slice(2, 4)}`;
}

/**
 * Meses que podem ser fechados hoje: de PRIMEIRO_MES_FECHAMENTO até o mês
 * anterior ao atual (só meses já encerrados), em ordem crescente.
 */
export function mesesFechaveis(hoje: Date): string[] {
  const limite = mesAnterior(anoMesDeData(hoje));
  const meses: string[] = [];
  let m = PRIMEIRO_MES_FECHAMENTO;
  while (m <= limite) {
    meses.push(m);
    const [ano, mes] = m.split("-").map(Number);
    m = anoMesDeData(new Date(ano, mes, 1));
  }
  return meses;
}

/** Trava de calendário: só mês encerrado e a partir de 2026-09. */
export function podeFecharMes(
  anoMes: string,
  hoje: Date,
): { ok: true } | { ok: false; motivo: string } {
  if (!anoMesValido(anoMes)) return { ok: false, motivo: "Mês inválido." };
  if (anoMes < PRIMEIRO_MES_FECHAMENTO)
    return {
      ok: false,
      motivo: `Só é possível fechar a partir de ${rotuloMes(PRIMEIRO_MES_FECHAMENTO)}.`,
    };
  if (anoMes >= anoMesDeData(hoje))
    return { ok: false, motivo: `${rotuloMes(anoMes)} ainda não encerrou.` };
  return { ok: true };
}

// ── Histórico gravado ────────────────────────────────────────────────────────

export interface FechamentoRow {
  school_id: string;
  ano_mes: string;
  inadimplente_mes: number;
  faturamento_mes: number;
  inadimplente_acumulado: number;
  faturamento_acumulado: number;
  boletos_mes: number;
  boletos_acumulado: number;
  fechado_por: string;
  fechado_em: string;
}

export interface PontoInadimplencia {
  anoMes: string;
  month: string;
  inadimplenteMes: number;
  faturamentoMes: number;
  inadimplenteAcumulado: number;
  faturamentoAcumulado: number;
  boletosMes: number;
  boletosAcumulado: number;
  /** % mensal (null = sem faturamento). */
  mensal: number | null;
  /** % acumulada no ano (null = sem faturamento). */
  acumulada: number | null;
}

export interface MesParcial {
  anoMes: string;
  faltam: string[];
}

export interface SerieInadimplencia {
  pontos: PontoInadimplencia[];
  parciais: MesParcial[];
}

/**
 * Série do gráfico para o conjunto de unidades exigidas (uma unidade, ou as
 * quatro em "Todas as Unidades"). Um mês só vira ponto quando TODAS as unidades
 * exigidas têm fechamento; o ponto soma os R$ e calcula o % sobre as somas.
 * Meses incompletos vão para `parciais` com as unidades que faltam.
 */
export function serieInadimplencia(
  rows: readonly FechamentoRow[],
  unidadesExigidas: readonly string[],
): SerieInadimplencia {
  const exigidas = new Set(unidadesExigidas);
  const porMes = new Map<string, FechamentoRow[]>();
  for (const r of rows) {
    if (!exigidas.has(r.school_id)) continue;
    const lista = porMes.get(r.ano_mes) ?? [];
    lista.push(r);
    porMes.set(r.ano_mes, lista);
  }
  const pontos: PontoInadimplencia[] = [];
  const parciais: MesParcial[] = [];
  for (const [anoMes, lista] of [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const presentes = new Set(lista.map((r) => r.school_id));
    const faltam = unidadesExigidas.filter((id) => !presentes.has(id));
    if (faltam.length > 0) {
      parciais.push({ anoMes, faltam });
      continue;
    }
    const soma = (f: (r: FechamentoRow) => number) =>
      arredondarReais(lista.reduce((s, r) => s + Number(f(r)), 0));
    const inadimplenteMes = soma((r) => r.inadimplente_mes);
    const faturamentoMes = soma((r) => r.faturamento_mes);
    const inadimplenteAcumulado = soma((r) => r.inadimplente_acumulado);
    const faturamentoAcumulado = soma((r) => r.faturamento_acumulado);
    pontos.push({
      anoMes,
      month: rotuloCurto(anoMes),
      inadimplenteMes,
      faturamentoMes,
      inadimplenteAcumulado,
      faturamentoAcumulado,
      boletosMes: lista.reduce((s, r) => s + Number(r.boletos_mes), 0),
      boletosAcumulado: lista.reduce((s, r) => s + Number(r.boletos_acumulado), 0),
      mensal: percentualInadimplencia(inadimplenteMes, faturamentoMes),
      acumulada: percentualInadimplencia(inadimplenteAcumulado, faturamentoAcumulado),
    });
  }
  return { pontos, parciais };
}

/** Último ponto completo da série (para o card "Último mês fechado"). */
export function ultimoFechamento(serie: SerieInadimplencia): PontoInadimplencia | null {
  return serie.pontos.length > 0 ? serie.pontos[serie.pontos.length - 1] : null;
}

export function formatarDataBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function diaMesBr(iso: string): string {
  return formatarDataBr(iso).slice(0, 5);
}

/**
 * Resumo do mês por unidade para "Todas as Unidades":
 * "Setembro/2026: CEC fechado em 02/10, CEC Baby fechado em 02/10, Núcleo Belvedere pendente".
 */
export function resumoMesPorUnidade(
  rows: readonly FechamentoRow[],
  anoMes: string,
  unidades: readonly { id: string; name: string }[],
): string {
  const partes = unidades.map((u) => {
    const r = rows.find((x) => x.school_id === u.id && x.ano_mes === anoMes);
    return r ? `${u.name} fechado em ${diaMesBr(r.fechado_em)}` : `${u.name} pendente`;
  });
  return `${rotuloMes(anoMes)}: ${partes.join(", ")}`;
}

// ── Pendências e lembrete no sino ────────────────────────────────────────────

export interface MesPendente {
  school_id: string;
  ano_mes: string;
}

/**
 * Para cada unidade, os meses fecháveis (2026-09 → mês anterior) que ainda não
 * têm fechamento gravado. Ordem: mês crescente, depois unidade na ordem dada.
 */
export function mesesPendentes(
  fechados: readonly Pick<FechamentoRow, "school_id" | "ano_mes">[],
  schoolIds: readonly string[],
  hoje: Date,
): MesPendente[] {
  const feitos = new Set(fechados.map((f) => `${f.school_id}|${f.ano_mes}`));
  const out: MesPendente[] = [];
  for (const anoMes of mesesFechaveis(hoje)) {
    for (const school_id of schoolIds) {
      if (!feitos.has(`${school_id}|${anoMes}`)) out.push({ school_id, ano_mes: anoMes });
    }
  }
  return out;
}

/** O lembrete só aparece a partir do dia 02 (dia 01 ainda não há retorno bancário). */
export function deveAvisarFechamento(hoje: Date): boolean {
  return hoje.getDate() >= DIA_INICIO_AVISO_FECHAMENTO;
}

export function textoAvisoFechamento(anoMes: string, unidadeNome: string): string {
  return `Inadimplência de ${rotuloMes(anoMes)} ainda não fechada: ${unidadeNome}`;
}

/** Avisos do sino: um por unidade × mês pendente; vazio antes do dia 02. */
export function avisosFechamentoPendente(
  pendentes: readonly MesPendente[],
  nomeUnidade: (schoolId: string) => string,
  hoje: Date,
): { school_id: string; ano_mes: string; texto: string }[] {
  if (!deveAvisarFechamento(hoje)) return [];
  return pendentes.map((p) => ({
    ...p,
    texto: textoAvisoFechamento(p.ano_mes, nomeUnidade(p.school_id)),
  }));
}
