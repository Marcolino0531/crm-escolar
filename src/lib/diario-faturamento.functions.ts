// Faturamento dos Extras do Diário — servidor.
//
// Mesma robustez do módulo Cantina (cantina.functions.ts):
//  1. reivindica ANTES de falar com o Sponte — o INSERT em diario_faturamentos
//     (índice único por aluno em aberto) e a amarração dos eventos
//     (faturamento_id IS NULL) são as travas contra clique duplo/duas pessoas;
//  2. guarda o id do título criado e nunca lança de novo se ele existir;
//  3. saída manual: "lançado manualmente no Sponte" sem tocar no Sponte.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import {
  CATEGORIA_EXTRAS_DIARIO_SPONTE,
  ERRO_FATURAMENTO_INTERROMPIDO,
  anoDoEvento,
  faturandoInterrompido,
  observacaoFaturamentoSponte,
  pendenciasPorAluno,
  podeFaturar,
  podeIsentar,
  transicaoFaturamento,
  type EventoExtra,
  type ItemFaturamento,
  type PendenciaAluno,
  type StatusFaturamento,
} from "@/lib/diario-faturamento";
import { precosExtrasDoAno } from "@/lib/diario-precos.functions";
import type { TabelaPrecos } from "@/lib/diario-precos";
import type { MealKey } from "@/lib/diario";
import { primeiroVencimentoMaterial } from "@/lib/rematricula";
import { coletarTitulosAluno, inserirPlanoSponte } from "@/lib/sponte.functions";
import { selectAll } from "@/lib/supabase-paginate";

const LOG_TAG = "[Diário][Faturamento]";

async function exigirPermissaoDiario(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "diario" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para faturar os Extras do Diário."
        : "Você não tem permissão para ver o faturamento do Diário.",
    );
  }
}

async function schoolIdDaUnidade(unidade: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("name", unidade)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Unidade "${unidade}" não encontrada.`);
  return data.id;
}

function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

type StudentRow = {
  id: string;
  name: string;
  class_name: string;
  sponte_aluno_id: string | null;
};

type EventRow = {
  id: string;
  student_id: string;
  event_type: string;
  meal: MealKey | null;
  extra_minutes: number | null;
  created_at: string;
  isento: boolean;
};

function paraEvento(r: EventRow): EventoExtra {
  return {
    id: r.id,
    studentId: r.student_id,
    eventType: r.event_type,
    meal: r.meal,
    extraMinutes: r.extra_minutes,
    createdAt: r.created_at,
    isento: r.isento,
  };
}

async function alunosDaUnidade(schoolId: string): Promise<Map<string, StudentRow>> {
  const alunos = await selectAll<StudentRow>(() =>
    supabaseAdmin
      .from("diario_students" as never)
      .select("id, name, class_name, sponte_aluno_id")
      .eq("school_id", schoolId)
      .order("id"),
  );
  return new Map(alunos.map((a) => [a.id, a]));
}

// Eventos cobráveis ainda sem faturamento (e não isentos) dos alunos informados.
async function eventosPendentes(studentIds: readonly string[]): Promise<EventoExtra[]> {
  if (studentIds.length === 0) return [];
  const rows = await selectAll<EventRow>(() =>
    supabaseAdmin
      .from("diario_events" as never)
      .select("id, student_id, event_type, meal, extra_minutes, created_at, isento")
      .in("student_id", studentIds)
      .eq("extra_charge", true)
      .eq("isento", false)
      .is("faturamento_id", null)
      .order("created_at"),
  );
  return rows.map(paraEvento);
}

async function precosPorAno(
  unidade: string,
  anos: Iterable<number>,
): Promise<Map<number, TabelaPrecos>> {
  const mapa = new Map<number, TabelaPrecos>();
  for (const ano of new Set(anos)) mapa.set(ano, await precosExtrasDoAno(unidade, ano));
  return mapa;
}

export interface PendenciaFaturamento extends PendenciaAluno {
  aluno: string;
  turma: string;
  sponteAlunoId: string | null;
  anoLetivo: number;
}

function decorar(p: PendenciaAluno, alunos: ReadonlyMap<string, StudentRow>): PendenciaFaturamento {
  const a = alunos.get(p.studentId);
  const bloqueios = [...p.bloqueios];
  if (!a?.sponte_aluno_id) bloqueios.push("Aluno sem vínculo com o Sponte (sincronize o Diário)");
  return {
    ...p,
    bloqueios,
    aluno: a?.name ?? "Aluno removido",
    turma: a?.class_name ?? "",
    sponteAlunoId: a?.sponte_aluno_id ?? null,
    anoLetivo: anoDoEvento(p.periodoInicio),
  };
}

async function calcularPendencias(
  unidade: string,
  schoolId: string,
  somenteAluno?: string,
): Promise<{ pendencias: PendenciaFaturamento[]; alunos: Map<string, StudentRow> }> {
  const alunos = await alunosDaUnidade(schoolId);
  const ids = somenteAluno ? [somenteAluno].filter((id) => alunos.has(id)) : [...alunos.keys()];
  const eventos = await eventosPendentes(ids);
  const precos = await precosPorAno(
    unidade,
    eventos.map((e) => anoDoEvento(e.createdAt)),
  );
  const pendencias = pendenciasPorAluno(eventos, precos)
    .map((p) => decorar(p, alunos))
    .sort((a, b) => a.aluno.localeCompare(b.aluno) || a.anoLetivo - b.anoLetivo);
  return { pendencias, alunos };
}

const UnidadeSchema = z.object({ unidade: z.string().trim().min(1) });

export const listarPendenciasFaturamentoDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<PendenciaFaturamento[]> => {
    await exigirPermissaoDiario(context.userId, false);
    const schoolId = await schoolIdDaUnidade(data.unidade);
    return (await calcularPendencias(data.unidade, schoolId)).pendencias;
  });

// ─── Histórico ──────────────────────────────────────────────────────────────

export interface FaturamentoDiario {
  id: string;
  unidade: string;
  studentId: string;
  aluno: string;
  turma: string;
  anoLetivo: number;
  periodoInicio: string;
  periodoFim: string;
  itens: ItemFaturamento[];
  valorTotal: number;
  status: StatusFaturamento;
  sponteContaReceberId: string | null;
  sponteVencimento: string | null;
  sponteErro: string;
  lancadoAt: string | null;
  lancadoPorNome: string;
  lancadoAutomatico: boolean | null;
  observacao: string;
  createdAt: string;
  createdByNome: string;
}

type FaturamentoRow = {
  id: string;
  school_id: string;
  unidade: string;
  student_id: string;
  sponte_aluno_id: string;
  aluno_nome: string;
  turma: string;
  ano_letivo: number;
  periodo_inicio: string;
  periodo_fim: string;
  itens: ItemFaturamento[];
  valor_total: number | string;
  status: StatusFaturamento;
  sponte_conta_receber_id: string | null;
  sponte_vencimento: string | null;
  sponte_erro: string;
  lancado_at: string | null;
  lancado_por_nome: string;
  lancado_automatico: boolean | null;
  observacao: string;
  created_at: string;
  created_by_nome: string;
};

const COLUNAS_FATURAMENTO =
  "id, school_id, unidade, student_id, sponte_aluno_id, aluno_nome, turma, ano_letivo, periodo_inicio, periodo_fim, itens, valor_total, status, sponte_conta_receber_id, sponte_vencimento, sponte_erro, lancado_at, lancado_por_nome, lancado_automatico, observacao, created_at, created_by_nome";

function paraFaturamento(r: FaturamentoRow): FaturamentoDiario {
  return {
    id: r.id,
    unidade: r.unidade,
    studentId: r.student_id,
    aluno: r.aluno_nome,
    turma: r.turma,
    anoLetivo: Number(r.ano_letivo),
    periodoInicio: r.periodo_inicio,
    periodoFim: r.periodo_fim,
    itens: r.itens ?? [],
    valorTotal: Number(r.valor_total),
    status: r.status,
    sponteContaReceberId: r.sponte_conta_receber_id,
    sponteVencimento: r.sponte_vencimento,
    sponteErro: r.sponte_erro ?? "",
    lancadoAt: r.lancado_at,
    lancadoPorNome: r.lancado_por_nome ?? "",
    lancadoAutomatico: r.lancado_automatico,
    observacao: r.observacao ?? "",
    createdAt: r.created_at,
    createdByNome: r.created_by_nome ?? "",
  };
}

export const listarFaturamentosDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<FaturamentoDiario[]> => {
    await exigirPermissaoDiario(context.userId, false);
    const schoolId = await schoolIdDaUnidade(data.unidade);
    await marcarInterrompidos(schoolId);
    const rows = await selectAll<FaturamentoRow>(() =>
      supabaseAdmin
        .from("diario_faturamentos" as never)
        .select(COLUNAS_FATURAMENTO)
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false }),
    );
    return rows.map(paraFaturamento);
  });

// 'faturando' antigo = processo morreu no meio: vira 'erro' para a equipe agir.
async function marcarInterrompidos(schoolId: string): Promise<void> {
  const agoraISO = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("diario_faturamentos" as never)
    .select("id, created_at")
    .eq("school_id", schoolId)
    .eq("status", "faturando")
    .returns<{ id: string; created_at: string }[]>();
  const ids = (data ?? [])
    .filter((r) => faturandoInterrompido(r.created_at, agoraISO))
    .map((r) => r.id);
  if (ids.length === 0) return;
  await supabaseAdmin
    .from("diario_faturamentos" as never)
    .update({ status: "erro", sponte_erro: ERRO_FATURAMENTO_INTERROMPIDO } as never)
    .in("id", ids)
    .eq("status", "faturando");
}

async function carregarFaturamento(id: string): Promise<FaturamentoRow | null> {
  const { data, error } = await supabaseAdmin
    .from("diario_faturamentos" as never)
    .select(COLUNAS_FATURAMENTO)
    .eq("id", id)
    .maybeSingle<FaturamentoRow>();
  if (error || !data) return null;
  return data;
}

// ─── Lançamento no Sponte ───────────────────────────────────────────────────

export interface ResultadoFaturamento {
  ok: boolean;
  erro?: string;
  faturamentoId?: string;
  lancadoNoSponte?: boolean;
  sponteContaReceberId?: string;
  sponteVencimento?: string;
  sponteErro?: string;
}

async function registrarErroSponte(id: string, erro: string): Promise<void> {
  await supabaseAdmin
    .from("diario_faturamentos" as never)
    .update({ status: "erro", sponte_erro: erro } as never)
    .eq("id", id)
    .neq("status", "lancado");
}

// Cria o título no Sponte para um faturamento já reivindicado (faturando/erro,
// sem título). A gravação final exige que a linha ainda não esteja 'lancado'.
async function lancarNoSponte(
  f: FaturamentoRow,
  nome: string,
  userId: string,
): Promise<ResultadoFaturamento> {
  const hojeYMD = hojeSaoPaulo();
  const titulos = await coletarTitulosAluno(f.unidade, f.sponte_aluno_id);
  if (titulos.indisponivel || titulos.error) {
    const erro =
      titulos.error ??
      "Credenciais do Sponte ausentes para esta unidade — nenhuma cobrança foi criada.";
    await registrarErroSponte(f.id, erro);
    return { ok: true, faturamentoId: f.id, lancadoNoSponte: false, sponteErro: erro };
  }

  // Vencimento: a próxima mensalidade em aberto do aluno (mesmo critério do
  // Material Pedagógico).
  const { vencimento } = primeiroVencimentoMaterial(titulos.titulos, hojeYMD);

  const inserido = await inserirPlanoSponte({
    unidade: f.unidade,
    sponteAlunoId: f.sponte_aluno_id,
    valor: Number(f.valor_total),
    vencimento,
    categoria: CATEGORIA_EXTRAS_DIARIO_SPONTE,
    observacao: observacaoFaturamentoSponte(f.itens, Number(f.valor_total)),
    logTag: LOG_TAG,
  });

  if (!inserido.ok) {
    const erro =
      inserido.error ??
      "O Sponte não confirmou a criação da cobrança — nenhuma cobrança foi criada.";
    await registrarErroSponte(f.id, erro);
    return { ok: true, faturamentoId: f.id, lancadoNoSponte: false, sponteErro: erro };
  }

  const agoraISO = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("diario_faturamentos" as never)
    .update({
      status: "lancado",
      lancado_at: agoraISO,
      lancado_por: userId,
      lancado_por_nome: nome,
      lancado_automatico: true,
      sponte_conta_receber_id: inserido.contaReceberID ?? "",
      sponte_vencimento: vencimento,
      sponte_erro: "",
    } as never)
    .eq("id", f.id)
    .neq("status", "lancado");

  // A cobrança EXISTE no Sponte mesmo se a gravação local falhar.
  if (error) {
    const erro = `Cobrança criada no Sponte (conta ${inserido.contaReceberID ?? "sem número"}), mas o School Hub não conseguiu registrar o status. NÃO lance novamente.`;
    await registrarErroSponte(f.id, erro);
    return { ok: true, faturamentoId: f.id, lancadoNoSponte: false, sponteErro: erro };
  }

  return {
    ok: true,
    faturamentoId: f.id,
    lancadoNoSponte: true,
    sponteContaReceberId: inserido.contaReceberID,
    sponteVencimento: vencimento,
  };
}

// Reivindica os eventos pendentes de um aluno num faturamento novo e lança.
async function faturarAluno(
  unidade: string,
  schoolId: string,
  studentId: string,
  nome: string,
  userId: string,
): Promise<ResultadoFaturamento> {
  const { pendencias } = await calcularPendencias(unidade, schoolId, studentId);
  const p = pendencias[0];
  if (!p) return { ok: false, erro: "Este aluno não tem consumo pendente de faturamento." };
  if (!podeFaturar(p) || !p.sponteAlunoId) {
    return { ok: false, erro: p.bloqueios.join("; ") || "Nada a faturar." };
  }

  // 1) Reivindica: só um faturamento em aberto por aluno (índice único).
  const { data: criado, error: eIns } = await supabaseAdmin
    .from("diario_faturamentos" as never)
    .insert({
      school_id: schoolId,
      unidade,
      student_id: studentId,
      sponte_aluno_id: p.sponteAlunoId,
      aluno_nome: p.aluno,
      turma: p.turma,
      ano_letivo: p.anoLetivo,
      periodo_inicio: p.periodoInicio,
      periodo_fim: p.periodoFim,
      itens: p.itens,
      valor_total: p.total,
      status: "faturando",
      created_by: userId,
      created_by_nome: nome,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (eIns || !criado) {
    return {
      ok: false,
      erro:
        eIns?.code === "23505"
          ? "Já existe um faturamento em andamento para este aluno."
          : "Não foi possível iniciar o faturamento.",
    };
  }

  // 2) Amarra os eventos (só os ainda livres). Se algum já foi levado por
  //    outro faturamento nesse meio-tempo, o valor calculado não bate: desfaz.
  const { data: amarrados, error: eUpd } = await supabaseAdmin
    .from("diario_events" as never)
    .update({ faturamento_id: criado.id } as never)
    .in("id", p.eventIds)
    .is("faturamento_id", null)
    .select("id");
  if (eUpd || (amarrados ?? []).length !== p.eventIds.length) {
    await supabaseAdmin
      .from("diario_events" as never)
      .update({ faturamento_id: null } as never)
      .eq("faturamento_id", criado.id);
    await supabaseAdmin
      .from("diario_faturamentos" as never)
      .delete()
      .eq("id", criado.id);
    return {
      ok: false,
      erro: "Os consumos deste aluno mudaram enquanto o faturamento era iniciado. Recarregue e tente de novo.",
    };
  }

  const f = await carregarFaturamento(criado.id);
  if (!f) return { ok: false, erro: "Faturamento não encontrado após a criação." };
  return lancarNoSponte(f, nome, userId);
}

const FaturarSchema = z.object({
  unidade: z.string().trim().min(1),
  studentId: z.string().uuid(),
});

export const faturarExtrasDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FaturarSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoFaturamento> => {
    await exigirPermissaoDiario(context.userId, true);
    const nome = await nomeDoUsuario(context.userId);
    const schoolId = await schoolIdDaUnidade(data.unidade);
    return faturarAluno(data.unidade, schoolId, data.studentId, nome, context.userId);
  });

export interface ResultadoFaturarTodos {
  lancados: number;
  comErro: { aluno: string; erro: string }[];
}

// Lote: um faturamento por aluno faturável, em sequência, cada um com a sua
// própria reivindicação — não é um fechamento em bloco.
export const faturarTodosExtrasDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoFaturarTodos> => {
    await exigirPermissaoDiario(context.userId, true);
    const nome = await nomeDoUsuario(context.userId);
    const schoolId = await schoolIdDaUnidade(data.unidade);
    const { pendencias } = await calcularPendencias(data.unidade, schoolId);
    const resultado: ResultadoFaturarTodos = { lancados: 0, comErro: [] };
    for (const p of pendencias) {
      if (!podeFaturar(p) || !p.sponteAlunoId) continue;
      const r = await faturarAluno(data.unidade, schoolId, p.studentId, nome, context.userId);
      if (r.ok && r.lancadoNoSponte) resultado.lancados += 1;
      else resultado.comErro.push({ aluno: p.aluno, erro: r.erro ?? r.sponteErro ?? "Falha" });
    }
    return resultado;
  });

const IdSchema = z.object({ id: z.string().uuid() });

// Retentativa quando o Sponte falhou.
export const relancarFaturamentoDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoFaturamento> => {
    await exigirPermissaoDiario(context.userId, true);
    const nome = await nomeDoUsuario(context.userId);
    const f = await carregarFaturamento(data.id);
    if (!f) return { ok: false, erro: "Faturamento não encontrado." };
    const t = transicaoFaturamento(f.status, "lancar", Boolean(f.sponte_conta_receber_id));
    if (!t.ok) return { ok: false, erro: t.erro };
    return lancarNoSponte(f, nome, context.userId);
  });

const ManualSchema = z.object({
  id: z.string().uuid(),
  observacao: z.string().max(500).optional(),
});

// Saída de emergência: a equipe lançou à mão no Sponte. Nada é escrito no
// Sponte; lancado_automatico = false distingue do lançamento do sistema.
export const marcarFaturamentoDiarioManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ManualSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; erro?: string }> => {
    await exigirPermissaoDiario(context.userId, true);
    const nome = await nomeDoUsuario(context.userId);
    const f = await carregarFaturamento(data.id);
    if (!f) return { ok: false, erro: "Faturamento não encontrado." };
    const t = transicaoFaturamento(f.status, "marcar_manual", Boolean(f.sponte_conta_receber_id));
    if (!t.ok) return { ok: false, erro: t.erro };

    const { data: atualizadas, error } = await supabaseAdmin
      .from("diario_faturamentos" as never)
      .update({
        status: "lancado",
        lancado_at: new Date().toISOString(),
        lancado_por: context.userId,
        lancado_por_nome: nome,
        lancado_automatico: false,
        observacao: data.observacao ?? "",
        sponte_erro: "",
      } as never)
      .eq("id", f.id)
      .eq("status", "erro")
      .select("id");
    if (error) return { ok: false, erro: "Não foi possível registrar o lançamento manual." };
    if ((atualizadas ?? []).length === 0) {
      return { ok: false, erro: "Este faturamento já foi lançado." };
    }
    return { ok: true };
  });

const MinutosSchema = z.object({
  eventId: z.string().uuid(),
  minutos: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
});

// Entrada/Saída registrada em dia sem horário contratado fica sem duração; a
// secretaria informa os minutos aqui para liberar o faturamento.
export const definirMinutosHoraExtraDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MinutosSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; erro?: string }> => {
    await exigirPermissaoDiario(context.userId, true);
    const { data: atualizadas, error } = await supabaseAdmin
      .from("diario_events" as never)
      .update({ extra_minutes: data.minutos, extra_charge: data.minutos > 0 } as never)
      .eq("id", data.eventId)
      .eq("event_type", "checkinout")
      .is("faturamento_id", null)
      .select("id");
    if (error) return { ok: false, erro: "Não foi possível gravar a duração." };
    if ((atualizadas ?? []).length === 0) {
      return { ok: false, erro: "Registro não encontrado ou já faturado." };
    }
    return { ok: true };
  });

const IsentarSchema = z.object({
  eventId: z.string().uuid(),
  motivo: z.string().trim().min(3, "Informe o motivo da isenção.").max(300),
});

// Isenta um consumo ainda pendente: o UPDATE condicional (faturamento_id IS
// NULL, isento = false) é a trava contra isentar algo que acabou de ser
// reivindicado por um faturamento.
export const isentarEventoDiario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IsentarSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; erro?: string }> => {
    await exigirPermissaoDiario(context.userId, true);
    const { data: atual, error: eSel } = await supabaseAdmin
      .from("diario_events" as never)
      .select("id, faturamento_id, isento")
      .eq("id", data.eventId)
      .eq("extra_charge", true)
      .maybeSingle<{ id: string; faturamento_id: string | null; isento: boolean }>();
    if (eSel) return { ok: false, erro: "Não foi possível localizar o consumo." };
    if (!atual) return { ok: false, erro: "Consumo extra não encontrado." };
    const t = podeIsentar({
      isento: atual.isento,
      faturamentoId: atual.faturamento_id,
      faturamentoStatus: null,
    });
    if (!t.ok) return { ok: false, erro: t.erro };

    const nome = await nomeDoUsuario(context.userId);
    const { data: atualizadas, error } = await supabaseAdmin
      .from("diario_events" as never)
      .update({
        isento: true,
        isento_em: new Date().toISOString(),
        isento_por: context.userId,
        isento_por_nome: nome,
        isento_motivo: data.motivo,
      } as never)
      .eq("id", data.eventId)
      .eq("isento", false)
      .is("faturamento_id", null)
      .select("id");
    if (error) return { ok: false, erro: "Não foi possível registrar a isenção." };
    if ((atualizadas ?? []).length === 0) {
      return {
        ok: false,
        erro: "Este consumo acabou de entrar em um faturamento ou já está isento.",
      };
    }
    return { ok: true };
  });
