// Server function do Dashboard de Matrículas: reenvia ao Sponte uma submissão
// que falhou, a partir do payload original gravado na auditoria.
//
// A linha existente é ATUALIZADA (não se cria outra) para que o histórico da
// submissão continue único — o índice de idempotência do webhook depende disso.
// Se o aluno já tinha sido criado na tentativa anterior, o reenvio vai direto
// para os responsáveis (`alunoIdExistente`), sem duplicar o cadastro.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { UNIDADES_SPONTE } from "@/lib/sponte.functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MatriculaSchema, problemasDoPayload } from "@/lib/matriculas.schema";
import { BUCKET_DOCUMENTOS_MATRICULA } from "@/lib/matricula-form";
import {
  FILTRO_OR_PENDENCIA,
  motivosPendencia,
  type LancamentoFicha,
  type SituacaoSubmissao,
} from "@/lib/matricula-integracao";
import {
  existeAlgoNoSponte,
  resumirIntegracao,
  type LancamentoResumo,
  type StatusIntegracao,
} from "@/lib/matricula-exclusao";
import {
  MatriculaError,
  processarMatricula,
  type MatriculaPayload,
  type MatriculaResultado,
} from "@/lib/matriculas.sponte";

export interface ReprocessarMatriculaResult {
  ok: boolean;
  status?: string;
  alunoId?: number | null;
  error?: string;
  problemas?: string[];
}

type SubmissaoRow = {
  id: string;
  status: string;
  sponte_aluno_id: number | null;
  payload: unknown;
  tentativas: number | null;
};

const STATUS_REPROCESSAVEIS = ["erro_aluno", "erro_responsavel"];

async function assertCanEditAdmissoes(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "admissoes" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para reprocessar matrículas.");
}

async function assertCanViewAdmissoes(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_view_module" as never,
    { _user_id: userId, _module: "admissoes" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para ver as matrículas.");
}

const ReprocessarInputSchema = z.object({ id: z.string().uuid() });

export const reprocessarMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReprocessarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReprocessarMatriculaResult> => {
    await assertCanEditAdmissoes(context.userId);

    const { data: row } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("id, status, sponte_aluno_id, payload, tentativas")
      .eq("id", data.id)
      .maybeSingle();
    const submissao = row as unknown as SubmissaoRow | null;
    if (!submissao) return { ok: false, error: "Submissão não encontrada." };

    if (!STATUS_REPROCESSAVEIS.includes(submissao.status)) {
      return {
        ok: false,
        error: "Só é possível reprocessar submissões que falharam no envio ao Sponte.",
      };
    }

    const parsed = MatriculaSchema.safeParse(submissao.payload);
    if (!parsed.success) {
      return {
        ok: false,
        error: "O payload gravado não atende ao contrato do webhook — corrija na origem.",
        problemas: problemasDoPayload(parsed.error),
      };
    }

    const payload: MatriculaPayload = {
      ...(parsed.data as MatriculaPayload),
      // O aluno da tentativa anterior é reaproveitado; sem isso a releitura por
      // CPF devolveria "duplicado" e os responsáveis nunca seriam criados.
      alunoIdExistente: submissao.sponte_aluno_id ?? undefined,
    };

    let resultado: MatriculaResultado | null = null;
    let status = submissao.status;
    let erro: string | null = null;

    try {
      resultado = await processarMatricula(payload, { dryRun: false });
      status = resultado.status;
      erro = resultado.error ?? null;
    } catch (e) {
      status = e instanceof MatriculaError ? e.status : "erro_aluno";
      erro = e instanceof Error ? e.message : String(e);
      console.error("[matrículas] falha ao reprocessar a submissão:", erro);
    }

    const { error: updateError } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .update({
        status,
        erro,
        resultado,
        sponte_aluno_id: resultado?.alunoId ?? submissao.sponte_aluno_id,
        tentativas: (submissao.tentativas ?? 1) + 1,
        reprocessado_em: new Date().toISOString(),
        reprocessado_por: context.userId,
      } as never)
      .eq("id", submissao.id);

    if (updateError) {
      return {
        ok: false,
        status,
        error: `O reenvio rodou (status "${status}"), mas a auditoria não pôde ser atualizada: ${updateError.message}`,
      };
    }

    return {
      ok: status === "sucesso",
      status,
      alunoId: resultado?.alunoId ?? submissao.sponte_aluno_id,
      error: erro ?? undefined,
    };
  });

// ─── Detalhe completo da submissão (rotina, saúde e documentos) ─────────────
//
// São dados locais do School Hub, fora do payload enviado ao Sponte. Os
// arquivos ficam num bucket privado: o link é assinado aqui, depois de checar
// a permissão de Admissões, e expira em poucos minutos.

const VALIDADE_LINK_DOCUMENTO = 300;

export interface RotinaSubmissao {
  serie: string | null;
  origem: string;
  anoLetivo: number | null;
  dataInicio: string;
  diasAtivos: number[];
  periodoManha: boolean;
  periodoTarde: boolean;
  horarioEstendido: boolean;
  horarios: { weekday: number; entrada: string; saida: string }[];
  semRefeicoes: boolean;
  refeicoes: Record<string, number[]>;
}

export interface SaudeSubmissao {
  contatoEmergencia: string;
  alergia: string;
  alergiaDetalhe: string;
  problemaSaude: string;
  problemaSaudeDetalhe: string;
  medicamentoContinuo: string;
  medicamentoContinuoDetalhe: string;
  planoSaude: string;
  planoSaudeDetalhe: string;
  pessoasAutorizadas: string;
  corRaca: string;
  outrasInformacoes: string;
}

export interface DocumentoSubmissao {
  documento: string;
  nomeArquivo: string;
  tipoArquivo: string;
  tamanhoBytes: number;
  // Assinado agora, de curta duração; null se o arquivo sumiu do bucket.
  url: string | null;
}

export interface DetalheMatriculaResult {
  ok: boolean;
  error?: string;
  rotina?: RotinaSubmissao | null;
  saude?: SaudeSubmissao | null;
  documentos?: DocumentoSubmissao[];
  lancamentos?: LancamentoFicha[];
}

const DetalheInputSchema = z.object({ submissionId: z.string().min(1).max(200) });

export const detalheMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DetalheInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<DetalheMatriculaResult> => {
    await assertCanViewAdmissoes(context.userId);

    const [rotinaRes, saudeRes, docsRes, lancRes] = await Promise.all([
      supabaseAdmin
        .from("student_routine" as never)
        .select(
          "serie, origem, ano_letivo, data_inicio, dias_ativos, horarios, periodo_manha, periodo_tarde, horario_estendido, sem_refeicoes, refeicoes",
        )
        .eq("submission_id", data.submissionId)
        .maybeSingle(),
      supabaseAdmin
        .from("matricula_saude" as never)
        .select("*")
        .eq("submission_id", data.submissionId)
        .maybeSingle(),
      supabaseAdmin
        .from("matricula_documentos" as never)
        .select("documento, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes")
        .eq("submission_id", data.submissionId)
        .order("documento"),
      supabaseAdmin
        .from("matricula_faturamento_lancamentos" as never)
        .select(
          "tipo, parcelas, valor_parcela, valor_primeira_parcela, primeiro_vencimento, total, status, erro, sponte_conta_receber_id",
        )
        .eq("submission_id", data.submissionId)
        .order("created_at"),
    ]);

    const linhaRotina = rotinaRes.data as unknown as {
      serie: string | null;
      origem: string;
      ano_letivo: number | null;
      data_inicio: string;
      dias_ativos: number[];
      horarios: { weekday: number; entrada: string; saida: string }[];
      periodo_manha: boolean;
      periodo_tarde: boolean;
      horario_estendido: boolean;
      sem_refeicoes: boolean;
      refeicoes: Record<string, number[]>;
    } | null;

    const linhaSaude = saudeRes.data as unknown as Record<string, string> | null;

    const linhasDoc = (docsRes.data ?? []) as unknown as {
      documento: string;
      storage_path: string;
      nome_arquivo: string;
      tipo_arquivo: string;
      tamanho_bytes: number;
    }[];

    const documentos: DocumentoSubmissao[] = [];
    for (const doc of linhasDoc) {
      const { data: assinado } = await supabaseAdmin.storage
        .from("matricula-documentos")
        .createSignedUrl(doc.storage_path, VALIDADE_LINK_DOCUMENTO);
      documentos.push({
        documento: doc.documento,
        nomeArquivo: doc.nome_arquivo,
        tipoArquivo: doc.tipo_arquivo,
        tamanhoBytes: doc.tamanho_bytes,
        url: assinado?.signedUrl ?? null,
      });
    }

    return {
      ok: true,
      rotina: linhaRotina
        ? {
            serie: linhaRotina.serie,
            origem: linhaRotina.origem,
            anoLetivo: linhaRotina.ano_letivo,
            dataInicio: linhaRotina.data_inicio,
            diasAtivos: linhaRotina.dias_ativos ?? [],
            periodoManha: linhaRotina.periodo_manha,
            periodoTarde: linhaRotina.periodo_tarde,
            horarioEstendido: linhaRotina.horario_estendido,
            horarios: linhaRotina.horarios ?? [],
            semRefeicoes: linhaRotina.sem_refeicoes,
            refeicoes: linhaRotina.refeicoes ?? {},
          }
        : null,
      saude: linhaSaude
        ? {
            contatoEmergencia: linhaSaude.contato_emergencia,
            alergia: linhaSaude.alergia,
            alergiaDetalhe: linhaSaude.alergia_detalhe,
            problemaSaude: linhaSaude.problema_saude,
            problemaSaudeDetalhe: linhaSaude.problema_saude_detalhe,
            medicamentoContinuo: linhaSaude.medicamento_continuo,
            medicamentoContinuoDetalhe: linhaSaude.medicamento_continuo_detalhe,
            planoSaude: linhaSaude.plano_saude,
            planoSaudeDetalhe: linhaSaude.plano_saude_detalhe,
            pessoasAutorizadas: linhaSaude.pessoas_autorizadas,
            corRaca: linhaSaude.cor_raca,
            outrasInformacoes: linhaSaude.outras_informacoes,
          }
        : null,
      documentos,
      lancamentos: (lancRes.data ?? []) as unknown as LancamentoFicha[],
    };
  });

// ─── Pendências de integração (aviso do sino, só admin) ──────────────────────
//
// A pendência é derivada do que está gravado (erro na criação, turma pendente
// ou com erro, cobrança pendente/parcial/erro) e some sozinha quando o
// reprocessamento resolve; quando a secretaria trata direto no Sponte, o admin
// dá baixa manual pela ficha (`pendencia_resolvida_em`).

export interface PendenciaMatricula {
  id: string;
  submissionId: string | null;
  alunoNome: string;
  unidade: string;
  criadoEm: string;
  motivos: string[];
}

async function ehAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles" as never)
    .select("role")
    .eq("user_id", userId);
  return ((data ?? []) as { role: string }[]).some((r) => r.role === "admin");
}

export const listarPendenciasMatricula = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendenciaMatricula[]> => {
    if (!(await ehAdmin(context.userId))) return [];
    const { data, error } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select(
        "id, submission_id, unidade, aluno_nome, created_at, status, erro, turma_status, turma_pendencia, turma_nome, faturamento_status, faturamento_pendencia, pendencia_resolvida_em",
      )
      .is("pendencia_resolvida_em", null)
      .or(FILTRO_OR_PENDENCIA)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as (SituacaoSubmissao & {
      id: string;
      submission_id: string | null;
      unidade: string | null;
      aluno_nome: string | null;
      created_at: string;
    })[];
    return rows
      .map((r) => ({
        id: r.id,
        submissionId: r.submission_id,
        alunoNome: r.aluno_nome ?? "Aluno sem nome",
        unidade: r.unidade ?? "",
        criadoEm: r.created_at,
        motivos: motivosPendencia(r),
      }))
      .filter((p) => p.motivos.length > 0);
  });

const ResolverPendenciaSchema = z.object({ id: z.string().uuid() });

export const resolverPendenciaMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResolverPendenciaSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (!(await ehAdmin(context.userId)))
      throw new Error("Apenas administradores podem dar baixa numa pendência.");
    const { error } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .update({
        pendencia_resolvida_em: new Date().toISOString(),
        pendencia_resolvida_por: await nomeDoUsuario(context.userId),
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Valores opcionais por unidade (refeição e hora extra) ──────────────────
//
// Matrícula e mensalidade vêm do plano nativo do Sponte (GetPlanosCursos) e o
// material da tela "Material Pedagógico por Série". Só alimentação e hora extra
// não existem como conceito estruturado no Sponte, então ficam aqui — uma linha
// por unidade, sempre a unidade selecionada no seletor global do topo.

export interface ValoresOpcionaisRegistro {
  unidade: string;
  valorRefeicao: number;
  valorHoraExtra: number;
  atualizadoEm: string | null;
  atualizadoPor: string;
}

export const obterValoresOpcionais = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ unidade: z.string().trim().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<ValoresOpcionaisRegistro> => {
    await assertCanViewAdmissoes(context.userId);
    if (!UNIDADES_SPONTE.includes(data.unidade)) {
      throw new Error("Escolha uma unidade específica no seletor do topo.");
    }

    const { data: linha, error } = await supabaseAdmin
      .from("unidade_valores_opcionais" as never)
      .select("valor_refeicao, valor_hora_extra, updated_at, updated_by_nome")
      .eq("unidade", data.unidade)
      .maybeSingle<{
        valor_refeicao: number;
        valor_hora_extra: number;
        updated_at: string;
        updated_by_nome: string | null;
      }>();
    if (error) throw new Error(error.message);

    return {
      unidade: data.unidade,
      valorRefeicao: Number(linha?.valor_refeicao ?? 0),
      valorHoraExtra: Number(linha?.valor_hora_extra ?? 0),
      atualizadoEm: linha?.updated_at ?? null,
      atualizadoPor: linha?.updated_by_nome ?? "",
    };
  });

const SalvarValoresOpcionaisSchema = z.object({
  unidade: z.string().trim().min(1, "Escolha a unidade."),
  valorRefeicao: z.number().min(0, "O valor por refeição não pode ser negativo."),
  valorHoraExtra: z.number().min(0, "O valor de hora extra não pode ser negativo."),
});

export const salvarValoresOpcionais = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarValoresOpcionaisSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertCanEditAdmissoes(context.userId);
    if (!UNIDADES_SPONTE.includes(data.unidade)) {
      throw new Error("Escolha uma unidade específica no seletor do topo.");
    }

    const { error } = await supabaseAdmin.from("unidade_valores_opcionais" as never).upsert(
      {
        unidade: data.unidade,
        valor_refeicao: data.valorRefeicao,
        valor_hora_extra: data.valorHoraExtra,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: await nomeDoUsuario(context.userId),
      } as never,
      { onConflict: "unidade" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Exclusão de submissão (somente admin) ──────────────────────────────────
//
// Remove a submissão e TODOS os registros ligados por submission_id no School
// Hub (student_routine, matricula_saude, matricula_documentos + arquivos do
// bucket matricula-documentos, onboarding, matricula_faturamento_lancamentos).
// Nada é alterado no Sponte nem no Diário do Aluno: o resumo do que já existe
// lá é mostrado na confirmação e gravado em matricula_exclusoes ANTES de
// apagar. Os arquivos só saem do bucket depois que todas as linhas foram
// apagadas com sucesso; falha ao apagar arquivo vai para o log.

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles" as never)
    .select("role")
    .eq("user_id", userId);
  const admin = ((data ?? []) as { role: string }[]).some((r) => r.role === "admin");
  if (!admin) throw new Error("Apenas administradores podem excluir uma submissão.");
}

type SubmissaoExclusaoRow = {
  id: string;
  submission_id: string | null;
  unidade: string | null;
  aluno_nome: string | null;
  aluno_cpf: string | null;
  sponte_aluno_id: number | null;
  turma_status: string | null;
  turma_nome: string | null;
  created_at: string;
};

export interface ResumoExclusaoMatricula {
  id: string;
  alunoNome: string;
  cpf: string;
  unidade: string;
  enviadoEm: string;
  integracao: StatusIntegracao;
  exigeCiencia: boolean;
}

async function carregarResumoExclusao(id: string): Promise<{
  row: SubmissaoExclusaoRow;
  resumo: ResumoExclusaoMatricula;
}> {
  const { data } = await supabaseAdmin
    .from("enrollment_submissions" as never)
    .select(
      "id, submission_id, unidade, aluno_nome, aluno_cpf, sponte_aluno_id, turma_status, turma_nome, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as unknown as SubmissaoExclusaoRow | null;
  if (!row) throw new Error("Submissão não encontrada.");

  let lancamentos: LancamentoResumo[] = [];
  if (row.submission_id) {
    const { data: lanc } = await supabaseAdmin
      .from("matricula_faturamento_lancamentos" as never)
      .select("tipo, status")
      .eq("submission_id", row.submission_id);
    lancamentos = (lanc ?? []) as unknown as LancamentoResumo[];
  }

  const integracao = resumirIntegracao({
    sponteAlunoId: row.sponte_aluno_id,
    turmaStatus: row.turma_status,
    turmaNome: row.turma_nome,
    lancamentos,
  });

  return {
    row,
    resumo: {
      id: row.id,
      alunoNome: row.aluno_nome ?? "",
      cpf: row.aluno_cpf ?? "",
      unidade: row.unidade ?? "",
      enviadoEm: row.created_at,
      integracao,
      exigeCiencia: existeAlgoNoSponte(integracao),
    },
  };
}

const ExclusaoIdSchema = z.object({ id: z.string().uuid() });

export const resumoExclusaoMatricula = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExclusaoIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<ResumoExclusaoMatricula> => {
    await assertAdmin(context.userId);
    return (await carregarResumoExclusao(data.id)).resumo;
  });

const ExcluirInputSchema = z.object({ id: z.string().uuid(), ciente: z.boolean() });

const TABELAS_LIGADAS = [
  "student_routine",
  "matricula_saude",
  "matricula_documentos",
  "onboarding",
  "matricula_faturamento_lancamentos",
] as const;

export const excluirMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExcluirInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; arquivosRemovidos: number }> => {
    await assertAdmin(context.userId);
    const { row, resumo } = await carregarResumoExclusao(data.id);
    if (resumo.exigeCiencia && !data.ciente)
      throw new Error("Confirme que está ciente de que o Sponte não será alterado.");

    const { error: auditErr } = await supabaseAdmin.from("matricula_exclusoes" as never).insert({
      submission_id: row.submission_id ?? row.id,
      aluno_nome: resumo.alunoNome,
      cpf: resumo.cpf,
      unidade: resumo.unidade,
      status_integracao: resumo.integracao,
      enviado_em: row.created_at,
      excluido_por: context.userId,
      excluido_por_nome: await nomeDoUsuario(context.userId),
    } as never);
    if (auditErr) throw new Error(`Falha ao registrar a exclusão: ${auditErr.message}`);

    let caminhos: string[] = [];
    if (row.submission_id) {
      const { data: docs } = await supabaseAdmin
        .from("matricula_documentos" as never)
        .select("storage_path")
        .eq("submission_id", row.submission_id);
      caminhos = ((docs ?? []) as unknown as { storage_path: string }[]).map((d) => d.storage_path);

      for (const tabela of TABELAS_LIGADAS) {
        const { error } = await supabaseAdmin
          .from(tabela as never)
          .delete()
          .eq("submission_id", row.submission_id);
        if (error) throw new Error(`Falha ao apagar ${tabela}: ${error.message}`);
      }
    }

    const { error: delErr } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .delete()
      .eq("id", row.id);
    if (delErr) throw new Error(`Falha ao apagar a submissão: ${delErr.message}`);

    let arquivosRemovidos = 0;
    if (caminhos.length > 0) {
      const { data: removidos, error: stErr } = await supabaseAdmin.storage
        .from(BUCKET_DOCUMENTOS_MATRICULA)
        .remove(caminhos);
      if (stErr) {
        console.error(
          `[matrículas] submissão ${row.id} apagada, mas falhou ao remover arquivos do bucket:`,
          stErr.message,
          caminhos,
        );
      } else {
        arquivosRemovidos = removidos?.length ?? 0;
      }
    }

    return { ok: true, arquivosRemovidos };
  });
