// Cobrança manual — controle processual (lógica pura, sem Supabase).
// Complementa cobranca-casos.ts: processo judicial, andamentos, valores
// recebidos e avisos de prazo nos marcos de 5, 3 e 1 dia corrido.

import { diasEntreYMD } from "@/lib/billing-debt";
import {
  arredondar2,
  chaveOrdem,
  formatarBRL,
  formatarDataBR,
  type AnexoCaso,
  type CasoResumo,
  type EventoTimeline,
} from "@/lib/cobranca-casos";

// ─── Catálogos ───────────────────────────────────────────────────────────────

export const TIPOS_ACAO = [
  { id: "execucao_titulo", label: "Execução de título extrajudicial" },
  { id: "monitoria", label: "Ação monitória" },
  { id: "cobranca", label: "Ação de cobrança" },
  { id: "juizado_especial", label: "Juizado Especial Cível" },
] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number]["id"];

export const TIPOS_ANDAMENTO = [
  { id: "distribuicao", label: "Distribuição" },
  { id: "citacao", label: "Citação" },
  { id: "audiencia", label: "Audiência" },
  { id: "penhora_bloqueio", label: "Penhora / bloqueio" },
  { id: "acordo", label: "Acordo" },
  { id: "sentenca", label: "Sentença" },
  { id: "pagamento", label: "Pagamento" },
  { id: "arquivamento", label: "Arquivamento" },
  { id: "outro", label: "Outro" },
] as const;
export type TipoAndamento = (typeof TIPOS_ANDAMENTO)[number]["id"];

export const TIPOS_RECEBIMENTO = [
  { id: "parcela_acordo", label: "Parcela de acordo" },
  { id: "bloqueio", label: "Bloqueio judicial" },
  { id: "alvara", label: "Alvará" },
  { id: "pagamento_direto", label: "Pagamento direto" },
  { id: "outro", label: "Outro" },
] as const;
export type TipoRecebimento = (typeof TIPOS_RECEBIMENTO)[number]["id"];

export const MARCOS_AVISO = [5, 3, 1] as const;
export type MarcoAviso = (typeof MARCOS_AVISO)[number];

export function labelTipoAcao(id: string): string {
  return TIPOS_ACAO.find((t) => t.id === id)?.label ?? id;
}
export function labelTipoAndamento(id: string): string {
  return TIPOS_ANDAMENTO.find((t) => t.id === id)?.label ?? id;
}
export function labelTipoRecebimento(id: string): string {
  return TIPOS_RECEBIMENTO.find((t) => t.id === id)?.label ?? id;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ProcessoCaso {
  id: string;
  caso_id: string;
  tipo_acao: TipoAcao;
  numero_processo: string | null;
  comarca: string | null;
  vara: string | null;
  data_ajuizamento: string; // YYYY-MM-DD
  valor_causa: number;
  created_by: string | null;
  created_at: string;
}

export interface AndamentoProcesso {
  id: string;
  processo_id: string;
  data: string; // YYYY-MM-DD
  tipo: TipoAndamento;
  descricao: string | null;
  anexo_path: string | null;
  prazo_data: string | null; // YYYY-MM-DD
  prazo_descricao: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RecebimentoProcesso {
  id: string;
  processo_id: string;
  data: string; // YYYY-MM-DD
  tipo: TipoRecebimento;
  valor: number;
  observacao: string | null;
  anexo_path: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── Valores ─────────────────────────────────────────────────────────────────

/** Soma dos recebimentos (qualquer tipo), 2 casas. */
export function totalRecebido(recebimentos: readonly Pick<RecebimentoProcesso, "valor">[]): number {
  return arredondar2(recebimentos.reduce((s, r) => s + Number(r.valor), 0));
}

/** Saldo = valor da causa − recebido. Negativo quando recebeu acima da causa. */
export function saldoProcesso(valorCausa: number, recebido: number): number {
  return arredondar2(valorCausa - recebido);
}

export interface PainelProcesso {
  valorCausa: number;
  totalRecebido: number;
  saldo: number;
  /** true quando o recebido superou o valor da causa. */
  acimaDaCausa: boolean;
}

export function painelProcesso(
  processo: Pick<ProcessoCaso, "valor_causa">,
  recebimentos: readonly Pick<RecebimentoProcesso, "valor">[],
): PainelProcesso {
  const valorCausa = arredondar2(Number(processo.valor_causa));
  const recebido = totalRecebido(recebimentos);
  const saldo = saldoProcesso(valorCausa, recebido);
  return { valorCausa, totalRecebido: recebido, saldo, acimaDaCausa: saldo < 0 };
}

/**
 * Sugestão do valor da causa: total do demonstrativo mais recente gerado pelo
 * sistema (anexo categoria 'demonstrativo', origem 'gerado', com `total` no
 * nome/metadado); senão o valor inicial do caso.
 */
export function sugestaoValorCausa(
  caso: Pick<CasoResumo, "valor_inicial">,
  demonstrativos: readonly { created_at: string; total: number | null }[],
): number {
  const maisRecente = [...demonstrativos]
    .filter((d) => d.total !== null && Number.isFinite(d.total))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return arredondar2(maisRecente ? Number(maisRecente.total) : Number(caso.valor_inicial));
}

/**
 * Total do demonstrativo gravado no nome personalizado do anexo gerado
 * ("Demonstrativo … — total R$ 1.234,56"). Retorna null se não houver.
 */
export function totalDoNomeDemonstrativo(nome: string | null | undefined): number | null {
  if (!nome) return null;
  const m = /R\$\s*([\d.]+,\d{2})/.exec(nome);
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

export function demonstrativosDoCaso(
  anexos: readonly Pick<AnexoCaso, "categoria" | "origem" | "created_at" | "nome_personalizado">[],
): { created_at: string; total: number | null }[] {
  return anexos
    .filter((a) => a.categoria === "demonstrativo" && a.origem === "gerado")
    .map((a) => ({
      created_at: a.created_at,
      total: totalDoNomeDemonstrativo(a.nome_personalizado),
    }));
}

/** Agregação por unidade dos casos EM PROCESSO (encerrados excluídos). */
export interface AgregadoUnidade {
  unidade: string;
  casos: number;
  valorCausa: number;
  totalRecebido: number;
  saldo: number;
}

export function agregarPorUnidade(
  itens: readonly {
    unidade: string;
    status: CasoResumo["status"];
    valor_causa: number;
    recebimentos: readonly Pick<RecebimentoProcesso, "valor">[];
  }[],
): AgregadoUnidade[] {
  const mapa = new Map<string, AgregadoUnidade>();
  for (const it of itens) {
    if (it.status !== "processo") continue;
    const atual = mapa.get(it.unidade) ?? {
      unidade: it.unidade,
      casos: 0,
      valorCausa: 0,
      totalRecebido: 0,
      saldo: 0,
    };
    atual.casos += 1;
    atual.valorCausa = arredondar2(atual.valorCausa + Number(it.valor_causa));
    atual.totalRecebido = arredondar2(atual.totalRecebido + totalRecebido(it.recebimentos));
    atual.saldo = saldoProcesso(atual.valorCausa, atual.totalRecebido);
    mapa.set(it.unidade, atual);
  }
  return [...mapa.values()].sort((a, b) => a.unidade.localeCompare(b.unidade));
}

// ─── Validações ──────────────────────────────────────────────────────────────

export function validarProcesso(input: {
  tipo_acao: string;
  data_ajuizamento: string;
  valor_causa: number;
}): string | null {
  if (!TIPOS_ACAO.some((t) => t.id === input.tipo_acao)) return "Escolha o tipo de ação.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data_ajuizamento)) return "Informe a data do ajuizamento.";
  if (!Number.isFinite(input.valor_causa) || input.valor_causa < 0)
    return "Informe o valor da causa (maior ou igual a zero).";
  return null;
}

export function validarAndamento(input: {
  data: string;
  tipo: string;
  prazo_data: string | null;
  prazo_descricao: string | null;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data)) return "Informe a data do andamento.";
  if (!TIPOS_ANDAMENTO.some((t) => t.id === input.tipo)) return "Escolha o tipo do andamento.";
  if (input.prazo_data && !/^\d{4}-\d{2}-\d{2}$/.test(input.prazo_data))
    return "Data do prazo inválida.";
  if (input.prazo_descricao?.trim() && !input.prazo_data)
    return "Informe a data do prazo ou da audiência.";
  return null;
}

export function validarRecebimento(input: {
  data: string;
  tipo: string;
  valor: number;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data)) return "Informe a data do recebimento.";
  if (!TIPOS_RECEBIMENTO.some((t) => t.id === input.tipo)) return "Escolha o tipo do recebimento.";
  if (!Number.isFinite(input.valor) || input.valor <= 0) return "Informe um valor maior que zero.";
  return null;
}

// ─── Avisos de prazo (sino) ──────────────────────────────────────────────────

/**
 * Marco ativo para um prazo em `hojeYMD` (calendário de Brasília, decidido
 * pelo chamador): 5 → faltam 5 ou 4 dias; 3 → faltam 3 ou 2; 1 → falta 1 ou é
 * o próprio dia. Fora disso (mais de 5 dias ou já passou) não há aviso.
 */
export function marcoDoPrazo(prazoYMD: string, hojeYMD: string): MarcoAviso | null {
  const dias = diasEntreYMD(hojeYMD, prazoYMD);
  if (dias === 5 || dias === 4) return 5;
  if (dias === 3 || dias === 2) return 3;
  if (dias === 1 || dias === 0) return 1;
  return null;
}

export interface PrazoAndamento {
  andamentoId: string;
  casoId: string;
  unidade: string;
  responsavelNome: string;
  numeroProcesso: string | null;
  tipo: TipoAndamento;
  prazoData: string;
  prazoDescricao: string | null;
  /** Status do caso — encerrados não geram aviso. */
  casoStatus: CasoResumo["status"];
}

export interface AvisoDispensado {
  andamentoId: string;
  marco: MarcoAviso;
}

export interface AvisoPrazo extends PrazoAndamento {
  marco: MarcoAviso;
  diasRestantes: number;
}

/** Avisos visíveis hoje, excluindo casos encerrados e marcos já dispensados. */
export function avisosPrazoPendentes(
  prazos: readonly PrazoAndamento[],
  dispensados: readonly AvisoDispensado[],
  hojeYMD: string,
): AvisoPrazo[] {
  const chave = (id: string, marco: number) => `${id}:${marco}`;
  const vistos = new Set(dispensados.map((d) => chave(d.andamentoId, d.marco)));
  const avisos: AvisoPrazo[] = [];
  for (const p of prazos) {
    if (p.casoStatus === "encerrado") continue;
    const marco = marcoDoPrazo(p.prazoData, hojeYMD);
    if (!marco) continue;
    if (vistos.has(chave(p.andamentoId, marco))) continue;
    avisos.push({ ...p, marco, diasRestantes: diasEntreYMD(hojeYMD, p.prazoData) });
  }
  return avisos.sort(
    (a, b) =>
      a.prazoData.localeCompare(b.prazoData) || a.responsavelNome.localeCompare(b.responsavelNome),
  );
}

/**
 * "[Prazo ou Audiência] em N dia(s), DD/MM: [responsável], processo [número ou
 * 'sem número'], [prazo_descricao]".
 */
export function textoAvisoPrazo(aviso: AvisoPrazo): string {
  const rotulo = aviso.tipo === "audiencia" ? "Audiência" : "Prazo";
  const quando =
    aviso.diasRestantes === 0
      ? "hoje"
      : `em ${aviso.diasRestantes} dia${aviso.diasRestantes === 1 ? "" : "s"}`;
  const [, m, d] = aviso.prazoData.split("-");
  const numero = aviso.numeroProcesso?.trim() ? aviso.numeroProcesso.trim() : "sem número";
  const partes = [`${aviso.responsavelNome}`, `processo ${numero}`];
  if (aviso.prazoDescricao?.trim()) partes.push(aviso.prazoDescricao.trim());
  return `${rotulo} ${quando}, ${d}/${m}: ${partes.join(", ")}`;
}

// ─── Linha do tempo ──────────────────────────────────────────────────────────

/** Eventos do processo para mesclar na linha do tempo do caso. */
export function eventosProcesso(
  processo: ProcessoCaso | null,
  andamentos: readonly AndamentoProcesso[],
  recebimentos: readonly RecebimentoProcesso[],
  hojeYMD: string,
): EventoTimeline[] {
  if (!processo) return [];
  const eventos: EventoTimeline[] = [
    {
      tipo: "processo",
      quando: processo.data_ajuizamento,
      titulo: "Processo judicial iniciado",
      detalhe: `${labelTipoAcao(processo.tipo_acao)} · ${
        processo.numero_processo?.trim() ? `nº ${processo.numero_processo}` : "sem número"
      } · valor da causa ${formatarBRL(Number(processo.valor_causa))}`,
    },
  ];
  for (const a of andamentos) {
    eventos.push({
      tipo: "andamento",
      quando: a.data,
      titulo: `Andamento: ${labelTipoAndamento(a.tipo)}`,
      detalhe: a.descricao?.trim() || undefined,
    });
    if (a.prazo_data)
      eventos.push({
        tipo: "prazo",
        quando: a.prazo_data,
        titulo: a.tipo === "audiencia" ? "Audiência" : "Prazo",
        detalhe: a.prazo_descricao?.trim() || `Ligado ao andamento de ${formatarDataBR(a.data)}`,
        futuro: a.prazo_data >= hojeYMD,
      });
  }
  for (const r of recebimentos)
    eventos.push({
      tipo: "recebimento",
      quando: r.data,
      titulo: `Valor recebido: ${formatarBRL(Number(r.valor))}`,
      detalhe: [labelTipoRecebimento(r.tipo), r.observacao?.trim()].filter(Boolean).join(" · "),
    });
  return eventos;
}

export function mesclarTimeline(
  ...listas: readonly (readonly EventoTimeline[])[]
): EventoTimeline[] {
  return listas.flat().sort((a, b) => chaveOrdem(a.quando).localeCompare(chaveOrdem(b.quando)));
}
