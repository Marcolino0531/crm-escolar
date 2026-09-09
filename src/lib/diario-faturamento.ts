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
import {
  dataNoMes,
  diaVencimentoHabitual,
  mesSeguinte,
  vencimentoPadraoRecarga,
  type ParcelaAberta,
} from "@/lib/cantina";
import { proximoDiaUtil } from "@/lib/billing-schedule";

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
  // Data (dd/mm/aaaa) de cada registro que compôs o item, na ordem em que
  // aconteceram. Ausente nos faturamentos gravados antes deste campo existir.
  datas?: string[];
  // Hora Extra: minutos de cada registro, paralelo a `datas`.
  minutosPorRegistro?: number[];
}

// Um consumo individual que compõe a pendência do aluno (alvo da isenção).
export interface EventoPendente {
  id: string;
  createdAt: string; // ISO
  rotulo: string;
  // Hora Extra: minutos do registro (null = sem duração, a conferir).
  extraMinutes: number | null;
}

export interface PendenciaAluno {
  studentId: string;
  eventIds: string[];
  eventos: EventoPendente[];
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
  const refeicoes = new Map<MealKey, string[]>();
  let minutos = 0;
  const registrosHora: { data: string; minutos: number }[] = [];
  const semDuracao: { id: string; createdAt: string }[] = [];
  const eventosDetalhe: EventoPendente[] = [];

  for (const e of ordenados) {
    eventosDetalhe.push({
      id: e.id,
      createdAt: e.createdAt,
      rotulo:
        e.eventType === "meal" && e.meal ? MEAL_LABEL[e.meal] : ROTULO_CATEGORIA_EXTRA.hora_extra,
      extraMinutes: e.eventType === "meal" ? null : e.extraMinutes,
    });
    if (e.eventType === "meal" && e.meal) {
      const datas = refeicoes.get(e.meal) ?? [];
      datas.push(dataBR(e.createdAt));
      refeicoes.set(e.meal, datas);
    } else if (e.eventType === "checkinout") {
      if (e.extraMinutes === null) semDuracao.push({ id: e.id, createdAt: e.createdAt });
      else if (e.extraMinutes > 0) {
        minutos += e.extraMinutes;
        registrosHora.push({ data: dataBR(e.createdAt), minutos: e.extraMinutes });
      }
    }
  }

  const itens: ItemFaturamento[] = [];
  const bloqueios: string[] = [];
  for (const [meal, datas] of refeicoes) {
    const preco = precos[meal];
    const n = datas.length;
    itens.push({
      categoria: meal,
      rotulo: MEAL_LABEL[meal],
      quantidade: n,
      precoUnitario: preco ?? null,
      valor: preco === undefined ? 0 : valorRefeicoes(n, preco),
      datas,
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
      datas: registrosHora.map((r) => r.data),
      minutosPorRegistro: registrosHora.map((r) => r.minutos),
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
    eventos: eventosDetalhe,
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

// dd/mm/aaaa no fuso da escola (o evento é gravado em UTC).
export function dataBR(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function juntar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

// "03/09, 04/09 e 08/09/2026": o ano só na última data quando todas são do
// mesmo ano; com anos diferentes, cada data sai completa.
export function listarDatas(datas: readonly string[], sufixos?: readonly string[]): string {
  const anos = new Set(datas.map((d) => d.slice(6)));
  const partes = datas.map((d, i) => {
    const curta = anos.size === 1 && i < datas.length - 1 ? d.slice(0, 5) : d;
    const sufixo = sufixos?.[i];
    return sufixo ? `${curta} (${sufixo})` : curta;
  });
  return juntar(partes);
}

export function descreverItem(i: ItemFaturamento): string {
  const datas = i.datas ?? [];
  if (i.categoria === "hora_extra") {
    const total = formatarMinutos(i.quantidade);
    if (datas.length === 0) return `Hora Extra ${total}`;
    const minutos = i.minutosPorRegistro ?? [];
    const sufixos =
      minutos.length === datas.length ? minutos.map((m) => formatarMinutos(m)) : undefined;
    return `Hora Extra em ${listarDatas(datas, sufixos)} = ${total}`;
  }
  if (datas.length === 0) return `${i.rotulo} ×${i.quantidade}`;
  return `${i.rotulo} em ${listarDatas(datas)}`;
}

function brl(v: number): string {
  return `R$ ${v
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

// Observação do título no Sponte: cada item com as datas exatas dos consumos
// e o valor, para a secretaria explicar a cobrança ao responsável sem abrir o
// School Hub.
export function observacaoFaturamentoSponte(
  itens: readonly ItemFaturamento[],
  total: number,
): string {
  const composicao = itens.map((i) => `${descreverItem(i)} — ${brl(i.valor)}`).join("; ");
  const sufixo = itens.length > 1 ? `. Total ${brl(total)}` : "";
  return `Extras do Diário: ${composicao}${sufixo}`;
}

// ─── Ciclo de vida do faturamento ───────────────────────────────────────────
//
//  faturando ──(Sponte confirmou)──▶ lancado
//      │
//      └──(Sponte falhou)──▶ erro ──(retentativa OK)──▶ lancado
//                              └──(marcado manual)────▶ lancado (automatico=false)

//      lancado ──(Cancelar; título cancelado à mão no Sponte)──▶ cancelado
//        (eventos voltam a pendentes e podem entrar num faturamento novo)

export type StatusFaturamento = "faturando" | "erro" | "lancado" | "cancelado";

// Status que ocupam a vaga de "faturamento em aberto" do aluno (espelha o
// índice único parcial diario_faturamentos_aberto_por_aluno_idx).
export function faturamentoEmAberto(status: StatusFaturamento): boolean {
  return status !== "lancado" && status !== "cancelado";
}

// Um aluno só abre faturamento novo se nenhum dos existentes ocupar a vaga.
export function podeAbrirFaturamento(existentes: readonly StatusFaturamento[]): boolean {
  return !existentes.some(faturamentoEmAberto);
}

export interface CancelamentoFaturamento {
  status: "cancelado";
  cancelado_em: string;
  cancelado_por: string;
  cancelado_por_nome: string;
}

// Registro do cancelamento: quem, quando; a linha nunca é apagada.
export function registroCancelamento(
  userId: string,
  nome: string,
  agoraISO: string,
): CancelamentoFaturamento {
  return {
    status: "cancelado",
    cancelado_em: agoraISO,
    cancelado_por: userId,
    cancelado_por_nome: nome,
  };
}

// Só um faturamento lançado pode ser cancelado; faturando/erro têm o fluxo
// próprio (relançar ou marcar manual).
export function podeCancelar(status: StatusFaturamento): TransicaoFaturamento {
  if (status === "lancado") return { ok: true };
  if (status === "cancelado") return { ok: false, erro: "Este faturamento já foi cancelado." };
  return {
    ok: false,
    erro: "Só um faturamento lançado pode ser cancelado. Use Relançar ou Marcar lançado manualmente.",
  };
}

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
  if (atual === "cancelado") return { ok: false, erro: "Este faturamento foi cancelado." };
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
  cancelado: "Cancelado",
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

export interface VencimentoExtrasDiario {
  vencimento: string; // YYYY-MM-DD
  origem: "dia_habitual" | "padrao";
}

// Vencimento do título dos Extras: sempre no mês seguinte ao do faturamento,
// no dia habitual de cobrança do aluno (próximo dia útil). Os boletos do mês
// corrente já foram enviados às famílias, então a mensalidade em aberto mais
// próxima NÃO serve de referência aqui — quitada ou não, o mês vigente é pulado.
// O dia habitual é o das parcelas que ainda vão vencer (dia de cobrança atual
// do aluno), não o do histórico inteiro.
export function proximoVencimentoExtrasDiario<T extends ParcelaAberta>(
  parcelas: readonly T[],
  hojeYMD: string,
): VencimentoExtrasDiario {
  const dia = diaVencimentoHabitual(parcelas, hojeYMD);
  if (dia !== null) {
    return {
      vencimento: proximoDiaUtil(dataNoMes(mesSeguinte(hojeYMD), dia)),
      origem: "dia_habitual",
    };
  }
  return { vencimento: proximoDiaUtil(vencimentoPadraoRecarga(hojeYMD)), origem: "padrao" };
}
