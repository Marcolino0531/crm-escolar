// Faturamento dos Extras do Diário do Aluno — lógica pura.
//
// Junta os consumos fora do plano (diario_events com extra_charge) que ainda
// não entraram em nenhum faturamento, agrupa por aluno e aplica a Tabela de
// Preços do ano/unidade: refeição × ocorrência, Hora Extra × minutos/60. O
// resultado vira UM título no Sponte por aluno, no padrão da Cantina
// (reivindicar antes de lançar, guardar o id do título, saída manual).

import { MEAL_LABEL, type MealKey } from "@/lib/diario";
import {
  ROTULO_CATEGORIA_EXTRA,
  valorHoraExtra,
  valorRefeicoes,
  type CategoriaExtra,
  type TabelaPrecos,
} from "@/lib/diario-precos";
import { formatarMinutos } from "@/lib/diario-hora-extra";

// Categoria financeira do Sponte em que o título dos Extras é criado (já
// existe na conta do colégio, usada também pela matrícula formalizada).
export const CATEGORIA_EXTRAS_DIARIO_SPONTE = "Alimentação e Integral Extras";

export interface EventoExtra {
  id: string;
  studentId: string;
  eventType: string;
  meal: MealKey | null;
  extraMinutes: number | null;
  createdAt: string; // ISO
  // Consumo que o diretor decidiu não cobrar: nunca entra em faturamento.
  isento?: boolean;
}

export interface ItemFaturamento {
  categoria: CategoriaExtra;
  rotulo: string;
  // Refeições: ocorrências. Hora Extra: minutos (já sem as tolerâncias).
  quantidade: number;
  precoUnitario: number | null;
  valor: number;
}

export interface PendenciaAluno {
  studentId: string;
  eventIds: string[];
  periodoInicio: string; // ISO do evento mais antigo
  periodoFim: string; // ISO do evento mais recente
  itens: ItemFaturamento[];
  total: number;
  // Motivos que impedem o faturamento automático deste aluno.
  bloqueios: string[];
  // Eventos de Entrada/Saída sem duração (dia sem horário contratado).
  eventosSemDuracao: { id: string; createdAt: string }[];
}

function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}

export function anoDoEvento(createdAtISO: string): number {
  return Number(createdAtISO.slice(0, 4));
}

// Consolida os eventos de UM aluno. `precos` é a tabela do ano/unidade do
// aluno; categoria com consumo e sem preço bloqueia o faturamento (nunca
// lançamos R$ 0 por falta de cadastro).
export function consolidarAluno(
  eventos: readonly EventoExtra[],
  precos: TabelaPrecos,
): PendenciaAluno {
  const ordenados = [...eventos].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const studentId = ordenados[0]?.studentId ?? "";
  const refeicoes = new Map<MealKey, number>();
  let minutos = 0;
  const semDuracao: { id: string; createdAt: string }[] = [];

  for (const e of ordenados) {
    if (e.eventType === "meal" && e.meal) {
      refeicoes.set(e.meal, (refeicoes.get(e.meal) ?? 0) + 1);
    } else if (e.eventType === "checkinout") {
      if (e.extraMinutes === null) semDuracao.push({ id: e.id, createdAt: e.createdAt });
      else minutos += e.extraMinutes;
    }
  }

  const itens: ItemFaturamento[] = [];
  const bloqueios: string[] = [];
  for (const [meal, n] of refeicoes) {
    const preco = precos[meal];
    itens.push({
      categoria: meal,
      rotulo: MEAL_LABEL[meal],
      quantidade: n,
      precoUnitario: preco ?? null,
      valor: preco === undefined ? 0 : valorRefeicoes(n, preco),
    });
    if (preco === undefined) bloqueios.push(`Sem preço de ${MEAL_LABEL[meal]} na Tabela de Preços`);
  }
  if (minutos > 0) {
    const preco = precos.hora_extra;
    itens.push({
      categoria: "hora_extra",
      rotulo: ROTULO_CATEGORIA_EXTRA.hora_extra,
      quantidade: minutos,
      precoUnitario: preco ?? null,
      valor: preco === undefined ? 0 : valorHoraExtra(minutos, preco),
    });
    if (preco === undefined) bloqueios.push("Sem preço de Hora Extra na Tabela de Preços");
  }
  if (semDuracao.length > 0) {
    bloqueios.push(
      `${semDuracao.length} registro(s) de Entrada/Saída sem duração — informe os minutos antes de faturar`,
    );
  }

  const total = centavos(itens.reduce((s, i) => s + i.valor, 0));
  if (bloqueios.length === 0 && total <= 0) {
    bloqueios.push("Nenhum valor a faturar");
  }

  return {
    studentId,
    eventIds: ordenados.map((e) => e.id),
    periodoInicio: ordenados[0]?.createdAt ?? "",
    periodoFim: ordenados[ordenados.length - 1]?.createdAt ?? "",
    itens,
    total,
    bloqueios,
    eventosSemDuracao: semDuracao,
  };
}

// Agrupa os eventos ainda não faturados por aluno. Os preços são resolvidos
// por ano do evento (`precosPorAno`), então um aluno com consumos em dois anos
// letivos gera dois faturamentos separados — o preço de cada ano é o dele.
export function pendenciasPorAluno(
  eventos: readonly EventoExtra[],
  precosPorAno: ReadonlyMap<number, TabelaPrecos>,
): PendenciaAluno[] {
  const grupos = new Map<string, EventoExtra[]>();
  for (const e of eventos) {
    if (e.isento) continue;
    const chave = `${e.studentId}|${anoDoEvento(e.createdAt)}`;
    const g = grupos.get(chave) ?? [];
    g.push(e);
    grupos.set(chave, g);
  }
  const saida: PendenciaAluno[] = [];
  for (const [chave, g] of grupos) {
    const ano = Number(chave.split("|")[1]);
    saida.push(consolidarAluno(g, precosPorAno.get(ano) ?? {}));
  }
  return saida;
}

export function podeFaturar(p: PendenciaAluno): boolean {
  return p.bloqueios.length === 0 && p.total > 0;
}

function dataBR(iso: string): string {
  const d = iso.slice(0, 10);
  const [y, m, dd] = d.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : d;
}

export function descreverItem(i: ItemFaturamento): string {
  if (i.categoria === "hora_extra") return `Hora Extra ${formatarMinutos(i.quantidade)}`;
  return `${i.rotulo} ×${i.quantidade}`;
}

// Observação do título no Sponte: período e composição, para a secretaria
// conseguir explicar o valor ao responsável sem abrir o School Hub.
export function observacaoFaturamentoSponte(
  itens: readonly ItemFaturamento[],
  periodoInicioISO: string,
  periodoFimISO: string,
): string {
  const composicao = itens.map(descreverItem).join(", ");
  return `Extras do Diário ${dataBR(periodoInicioISO)} a ${dataBR(periodoFimISO)}: ${composicao}`;
}

// ─── Ciclo de vida do faturamento ───────────────────────────────────────────
//
//  faturando ──(Sponte confirmou)──▶ lancado
//      │
//      └──(Sponte falhou)──▶ erro ──(retentativa OK)──▶ lancado
//                              └──(marcado manual)────▶ lancado (automatico=false)

export type StatusFaturamento = "faturando" | "erro" | "lancado";

// Um faturamento vive em 'faturando' só durante a chamada ao Sponte. Passado
// este prazo, o processo foi interrompido (deploy, timeout): vira 'erro' para a
// equipe conferir no Sponte e relançar ou marcar manual.
export const FATURANDO_INTERROMPIDO_MS = 10 * 60 * 1000;
export const ERRO_FATURAMENTO_INTERROMPIDO =
  "Lançamento interrompido antes da confirmação — confira no Sponte se o título existe antes de relançar.";

export function faturandoInterrompido(createdAtISO: string, agoraISO: string): boolean {
  return Date.parse(agoraISO) - Date.parse(createdAtISO) > FATURANDO_INTERROMPIDO_MS;
}
export type AcaoFaturamento = "lancar" | "marcar_manual";

export interface TransicaoFaturamento {
  ok: boolean;
  erro?: string;
}

export function transicaoFaturamento(
  atual: StatusFaturamento,
  acao: AcaoFaturamento,
  temTituloSponte: boolean,
): TransicaoFaturamento {
  if (atual === "lancado")
    return { ok: false, erro: "Este faturamento já está lançado no Sponte." };
  if (temTituloSponte) {
    return { ok: false, erro: "Este faturamento já tem cobrança criada no Sponte." };
  }
  if (atual === "faturando") {
    return { ok: false, erro: "Este faturamento ainda está em andamento." };
  }
  return acao === "lancar" || acao === "marcar_manual"
    ? { ok: true }
    : { ok: false, erro: "Ação inválida." };
}

// ─── Situação de um consumo extra na aba Consumos Extras ────────────────────

export type StatusConsumoExtra = "pendente" | "isento" | StatusFaturamento;

export interface ConsumoFaturavel {
  isento: boolean;
  faturamentoId: string | null;
  // Status do faturamento vinculado; null quando o vínculo não foi resolvido.
  faturamentoStatus: StatusFaturamento | null;
}

export function statusConsumoExtra(c: ConsumoFaturavel): StatusConsumoExtra {
  if (c.isento) return "isento";
  if (!c.faturamentoId) return "pendente";
  return c.faturamentoStatus ?? "faturando";
}

export const ROTULO_STATUS_CONSUMO: Record<StatusConsumoExtra, string> = {
  pendente: "Pendente",
  isento: "Isento",
  faturando: "Faturando",
  lancado: "Lançado",
  erro: "Erro no lançamento",
};

// Só um consumo ainda pendente pode ser isentado; se já entrou num
// faturamento (em qualquer status) o diretor resolve o faturamento primeiro.
export function podeIsentar(c: ConsumoFaturavel): TransicaoFaturamento {
  if (c.isento) return { ok: false, erro: "Este consumo já está isento." };
  if (c.faturamentoId) {
    return {
      ok: false,
      erro: "Este consumo já entrou em um faturamento. Resolva o faturamento (relançar ou marcar manual) antes de isentar.",
    };
  }
  return { ok: true };
}
