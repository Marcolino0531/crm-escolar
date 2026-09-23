// Cobrança manual — controle processual (server functions). Mesmo padrão do
// cobranca-casos.functions.ts: service role + RBAC do módulo e da unidade.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AnexoCaso, CasoCompleto, CasoResumo } from "@/lib/cobranca-casos";
import {
  arquivoExiste,
  carregarCasoRow,
  exigirAberto,
  exigirPermissao,
  exigirUnidade,
  hojeYMD,
  linkAssinado,
} from "@/lib/cobranca-casos.functions";
import {
  MARCOS_AVISO,
  TIPOS_ACAO,
  TIPOS_ANDAMENTO,
  TIPOS_RECEBIMENTO,
  avisosPrazoPendentes,
  demonstrativosDoCaso,
  sugestaoValorCausa,
  validarAndamento,
  validarProcesso,
  validarRecebimento,
  type AndamentoProcesso,
  type AvisoPrazo,
  type MarcoAviso,
  type PrazoAndamento,
  type ProcessoCaso,
  type RecebimentoProcesso,
} from "@/lib/cobranca-processos";
import { allowedSponteUnidades } from "@/lib/sponte.functions";
import { fetchAllRows } from "@/lib/supabase-paginate";

const CasoIdSchema = z.object({ casoId: z.string().uuid() });
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TipoAcaoSchema = z.enum(TIPOS_ACAO.map((t) => t.id) as [string, ...string[]]);
const TipoAndamentoSchema = z.enum(TIPOS_ANDAMENTO.map((t) => t.id) as [string, ...string[]]);
const TipoRecebimentoSchema = z.enum(TIPOS_RECEBIMENTO.map((t) => t.id) as [string, ...string[]]);

// ─── Linhas ──────────────────────────────────────────────────────────────────

type ProcessoRow = Omit<ProcessoCaso, "valor_causa"> & { valor_causa: number | string };
type RecebimentoRow = Omit<RecebimentoProcesso, "valor"> & { valor: number | string };

const SELECT_PROCESSO =
  "id, caso_id, tipo_acao, numero_processo, comarca, vara, data_ajuizamento, valor_causa, created_by, created_at";
const SELECT_ANDAMENTO =
  "id, processo_id, data, tipo, descricao, anexo_path, prazo_data, prazo_descricao, created_by, created_at";
const SELECT_RECEBIMENTO =
  "id, processo_id, data, tipo, valor, observacao, anexo_path, created_by, created_at";

function paraProcesso(r: ProcessoRow): ProcessoCaso {
  return { ...r, valor_causa: Number(r.valor_causa) };
}

async function carregarProcessoRow(casoId: string): Promise<ProcessoCaso | null> {
  const { data, error } = await supabaseAdmin
    .from("cobranca_processos" as never)
    .select(SELECT_PROCESSO)
    .eq("caso_id", casoId)
    .maybeSingle<ProcessoRow>();
  if (error) throw new Error(error.message);
  return data ? paraProcesso(data) : null;
}

async function carregarAndamentos(processoId: string): Promise<AndamentoProcesso[]> {
  return fetchAllRows<AndamentoProcesso>((from, to) =>
    supabaseAdmin
      .from("cobranca_andamentos" as never)
      .select(SELECT_ANDAMENTO)
      .eq("processo_id", processoId)
      .order("data")
      .order("created_at")
      .range(from, to)
      .returns<AndamentoProcesso[]>(),
  );
}

async function carregarRecebimentos(processoId: string): Promise<RecebimentoProcesso[]> {
  const rows = await fetchAllRows<RecebimentoRow>((from, to) =>
    supabaseAdmin
      .from("cobranca_recebimentos" as never)
      .select(SELECT_RECEBIMENTO)
      .eq("processo_id", processoId)
      .order("data")
      .order("created_at")
      .range(from, to)
      .returns<RecebimentoRow[]>(),
  );
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }));
}

async function exigirCasoEditavel(userId: string, casoId: string): Promise<CasoCompleto> {
  await exigirPermissao(userId, true);
  const caso = await carregarCasoRow(casoId);
  await exigirUnidade(userId, caso.unidade);
  exigirAberto(caso);
  return caso;
}

async function validarAnexo(
  caso: CasoCompleto,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (!path.startsWith(`${caso.id}/`)) throw new Error("Caminho do anexo inválido.");
  if (!(await arquivoExiste(path))) throw new Error("Anexo não encontrado no armazenamento.");
  return path;
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export type AndamentoComLink = AndamentoProcesso & { anexo_url: string | null };
export type RecebimentoComLink = RecebimentoProcesso & { anexo_url: string | null };

export interface ProcessoDetalhe {
  processo: ProcessoCaso | null;
  andamentos: AndamentoComLink[];
  recebimentos: RecebimentoComLink[];
  /** Sugestão do valor da causa (demonstrativo mais recente ou valor_inicial). */
  sugestaoValorCausa: number;
  hojeYMD: string;
}

export const carregarProcessoCaso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CasoIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ProcessoDetalhe> => {
    await exigirPermissao(context.userId, false);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    const processo = await carregarProcessoRow(caso.id);

    const { data: anexos, error } = await supabaseAdmin
      .from("cobranca_anexos" as never)
      .select("categoria, origem, created_at, nome_personalizado")
      .eq("caso_id", caso.id)
      .returns<Pick<AnexoCaso, "categoria" | "origem" | "created_at" | "nome_personalizado">[]>();
    if (error) throw new Error(error.message);
    const sugestao = sugestaoValorCausa(caso, demonstrativosDoCaso(anexos ?? []));

    if (!processo)
      return {
        processo: null,
        andamentos: [],
        recebimentos: [],
        sugestaoValorCausa: sugestao,
        hojeYMD: hojeYMD(),
      };

    const [andamentos, recebimentos] = await Promise.all([
      carregarAndamentos(processo.id),
      carregarRecebimentos(processo.id),
    ]);
    const andamentosComLink: AndamentoComLink[] = [];
    for (const a of andamentos)
      andamentosComLink.push({
        ...a,
        anexo_url: a.anexo_path ? await linkAssinado(a.anexo_path) : null,
      });
    const recebimentosComLink: RecebimentoComLink[] = [];
    for (const r of recebimentos)
      recebimentosComLink.push({
        ...r,
        anexo_url: r.anexo_path ? await linkAssinado(r.anexo_path) : null,
      });

    return {
      processo,
      andamentos: andamentosComLink,
      recebimentos: recebimentosComLink,
      sugestaoValorCausa: sugestao,
      hojeYMD: hojeYMD(),
    };
  });

// ─── Iniciar / editar processo ───────────────────────────────────────────────

const DadosProcessoSchema = z.object({
  tipoAcao: TipoAcaoSchema,
  numeroProcesso: z.string().max(60).default(""),
  comarca: z.string().max(120).default(""),
  vara: z.string().max(120).default(""),
  dataAjuizamento: YMD,
  valorCausa: z.number().nonnegative(),
});

const IniciarProcessoSchema = CasoIdSchema.extend(DadosProcessoSchema.shape);

function colunasProcesso(d: z.infer<typeof DadosProcessoSchema>) {
  return {
    tipo_acao: d.tipoAcao,
    numero_processo: d.numeroProcesso.trim() || null,
    comarca: d.comarca.trim() || null,
    vara: d.vara.trim() || null,
    data_ajuizamento: d.dataAjuizamento,
    valor_causa: Math.round(d.valorCausa * 100) / 100,
  };
}

export const iniciarProcessoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IniciarProcessoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ processoId: string }> => {
    const caso = await exigirCasoEditavel(context.userId, data.casoId);
    if (caso.status !== "aguardando_prazo" || !caso.prazo_final || hojeYMD() <= caso.prazo_final)
      throw new Error("O processo só pode ser iniciado quando o prazo da notificação já encerrou.");
    if (await carregarProcessoRow(caso.id)) throw new Error("Este caso já tem processo.");
    const invalido = validarProcesso({
      tipo_acao: data.tipoAcao,
      data_ajuizamento: data.dataAjuizamento,
      valor_causa: data.valorCausa,
    });
    if (invalido) throw new Error(invalido);

    const { data: inserido, error } = await supabaseAdmin
      .from("cobranca_processos" as never)
      .insert({ caso_id: caso.id, ...colunasProcesso(data), created_by: context.userId } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !inserido) throw new Error(error?.message ?? "Falha ao iniciar o processo.");

    const { error: e2 } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .update({ status: "processo" } as never)
      .eq("id", caso.id);
    if (e2) throw new Error(e2.message);
    return { processoId: inserido.id };
  });

export const atualizarProcessoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IniciarProcessoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const caso = await exigirCasoEditavel(context.userId, data.casoId);
    const processo = await carregarProcessoRow(caso.id);
    if (!processo) throw new Error("Este caso ainda não tem processo.");
    const invalido = validarProcesso({
      tipo_acao: data.tipoAcao,
      data_ajuizamento: data.dataAjuizamento,
      valor_causa: data.valorCausa,
    });
    if (invalido) throw new Error(invalido);
    const { error } = await supabaseAdmin
      .from("cobranca_processos" as never)
      .update(colunasProcesso(data) as never)
      .eq("id", processo.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Andamentos ──────────────────────────────────────────────────────────────

const AndamentoSchema = CasoIdSchema.extend({
  data: YMD,
  tipo: TipoAndamentoSchema,
  descricao: z.string().max(4000).default(""),
  anexoPath: z.string().min(1).nullable().default(null),
  prazoData: YMD.nullable().default(null),
  prazoDescricao: z.string().max(500).default(""),
});

export const registrarAndamentoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AndamentoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ andamentoId: string }> => {
    const caso = await exigirCasoEditavel(context.userId, data.casoId);
    const processo = await carregarProcessoRow(caso.id);
    if (!processo) throw new Error("Inicie o processo antes de registrar andamentos.");
    const invalido = validarAndamento({
      data: data.data,
      tipo: data.tipo,
      prazo_data: data.prazoData,
      prazo_descricao: data.prazoDescricao,
    });
    if (invalido) throw new Error(invalido);
    const anexo = await validarAnexo(caso, data.anexoPath);
    const { data: inserido, error } = await supabaseAdmin
      .from("cobranca_andamentos" as never)
      .insert({
        processo_id: processo.id,
        data: data.data,
        tipo: data.tipo,
        descricao: data.descricao.trim() || null,
        anexo_path: anexo,
        prazo_data: data.prazoData,
        prazo_descricao: data.prazoData ? data.prazoDescricao.trim() || null : null,
        created_by: context.userId,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !inserido) throw new Error(error?.message ?? "Falha ao registrar o andamento.");
    return { andamentoId: inserido.id };
  });

// ─── Recebimentos ────────────────────────────────────────────────────────────

const RecebimentoSchema = CasoIdSchema.extend({
  data: YMD,
  tipo: TipoRecebimentoSchema,
  valor: z.number().positive(),
  observacao: z.string().max(2000).default(""),
  anexoPath: z.string().min(1).nullable().default(null),
});

export const registrarRecebimentoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RecebimentoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ recebimentoId: string }> => {
    const caso = await exigirCasoEditavel(context.userId, data.casoId);
    const processo = await carregarProcessoRow(caso.id);
    if (!processo) throw new Error("Inicie o processo antes de registrar recebimentos.");
    const invalido = validarRecebimento({ data: data.data, tipo: data.tipo, valor: data.valor });
    if (invalido) throw new Error(invalido);
    const anexo = await validarAnexo(caso, data.anexoPath);
    const { data: inserido, error } = await supabaseAdmin
      .from("cobranca_recebimentos" as never)
      .insert({
        processo_id: processo.id,
        data: data.data,
        tipo: data.tipo,
        valor: Math.round(data.valor * 100) / 100,
        observacao: data.observacao.trim() || null,
        anexo_path: anexo,
        created_by: context.userId,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !inserido) throw new Error(error?.message ?? "Falha ao registrar o recebimento.");
    return { recebimentoId: inserido.id };
  });

// ─── Avisos de prazo (sino) ──────────────────────────────────────────────────

interface AndamentoPrazoRow {
  id: string;
  tipo: AndamentoProcesso["tipo"];
  prazo_data: string;
  prazo_descricao: string | null;
  processo_id: string;
}
interface ProcessoLeveRow {
  id: string;
  caso_id: string;
  numero_processo: string | null;
}
type CasoLeveRow = Pick<CasoResumo, "id" | "unidade" | "responsavel_nome" | "status">;

/** Avisos de prazo/audiência visíveis hoje para o usuário (só quem edita a Cobrança). */
export const avisosPrazoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AvisoPrazo[]> => {
    const { data: podeEditar } = await supabaseAdmin.rpc(
      "can_edit_module" as never,
      { _user_id: context.userId, _module: "financeiro_cobranca" } as never,
    );
    if (!podeEditar) return [];
    const hoje = hojeYMD();
    // Janela: prazos de hoje até daqui a 5 dias (marcos 5/3/1).
    const limite = new Date(`${hoje}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + 5);
    const limiteYMD = limite.toISOString().slice(0, 10);

    const andamentos = await fetchAllRows<AndamentoPrazoRow>((from, to) =>
      supabaseAdmin
        .from("cobranca_andamentos" as never)
        .select("id, tipo, prazo_data, prazo_descricao, processo_id")
        .gte("prazo_data", hoje)
        .lte("prazo_data", limiteYMD)
        .order("prazo_data")
        .range(from, to)
        .returns<AndamentoPrazoRow[]>(),
    );
    if (andamentos.length === 0) return [];

    const processoIds = [...new Set(andamentos.map((a) => a.processo_id))];
    const processos = await fetchAllRows<ProcessoLeveRow>((from, to) =>
      supabaseAdmin
        .from("cobranca_processos" as never)
        .select("id, caso_id, numero_processo")
        .in("id", processoIds)
        .order("id")
        .range(from, to)
        .returns<ProcessoLeveRow[]>(),
    );
    const casoIds = [...new Set(processos.map((p) => p.caso_id))];
    const casos = await fetchAllRows<CasoLeveRow>((from, to) =>
      supabaseAdmin
        .from("cobranca_casos" as never)
        .select("id, unidade, responsavel_nome, status")
        .in("id", casoIds)
        .order("id")
        .range(from, to)
        .returns<CasoLeveRow[]>(),
    );
    const dispensados = await fetchAllRows<{ andamento_id: string; marco: number }>((from, to) =>
      supabaseAdmin
        .from("cobranca_avisos_dispensados" as never)
        .select("andamento_id, marco")
        .eq("user_id", context.userId)
        .in(
          "andamento_id",
          andamentos.map((a) => a.id),
        )
        .order("andamento_id")
        .range(from, to)
        .returns<{ andamento_id: string; marco: number }[]>(),
    );

    const allowed = await allowedSponteUnidades(context.userId);
    const porProcesso = new Map(processos.map((p) => [p.id, p]));
    const porCaso = new Map(casos.map((c) => [c.id, c]));
    const prazos: PrazoAndamento[] = [];
    for (const a of andamentos) {
      const p = porProcesso.get(a.processo_id);
      const c = p ? porCaso.get(p.caso_id) : undefined;
      if (!p || !c) continue;
      if (allowed !== null && !allowed.includes(c.unidade)) continue;
      prazos.push({
        andamentoId: a.id,
        casoId: c.id,
        unidade: c.unidade,
        responsavelNome: c.responsavel_nome,
        numeroProcesso: p.numero_processo,
        tipo: a.tipo,
        prazoData: a.prazo_data,
        prazoDescricao: a.prazo_descricao,
        casoStatus: c.status,
      });
    }
    return avisosPrazoPendentes(
      prazos,
      dispensados.map((d) => ({ andamentoId: d.andamento_id, marco: d.marco as MarcoAviso })),
      hoje,
    );
  });

const DispensarSchema = z.object({
  andamentoId: z.string().uuid(),
  marco: z.union(
    MARCOS_AVISO.map((m) => z.literal(m)) as [z.ZodLiteral<5>, z.ZodLiteral<3>, z.ZodLiteral<1>],
  ),
});

export const dispensarAvisoPrazo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DispensarSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    const { error } = await supabaseAdmin
      .from("cobranca_avisos_dispensados" as never)
      .upsert(
        { andamento_id: data.andamentoId, marco: data.marco, user_id: context.userId } as never,
        { onConflict: "andamento_id,marco,user_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
