// Server function do Dashboard de Matrículas: reenvia ao Sponte uma submissão
// que falhou, a partir do payload original gravado na auditoria.
//
// A linha existente é ATUALIZADA (não se cria outra) para que o histórico da
// submissão continue único — o índice de idempotência por submission_id depende disso.
// Se o aluno já tinha sido criado na tentativa anterior, o reenvio vai direto
// para os responsáveis (`alunoIdExistente`), sem duplicar o cadastro.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { UNIDADES_SPONTE, coletarTitulosAluno, resolverCredenciais } from "@/lib/sponte.functions";
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
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";
import { sincronizarNomeSubmissao, type NomeSubmissaoResult } from "@/lib/matriculas-nome.server";
import { buscarCursos, buscarTurmasDoAno, matriculasDoAluno } from "@/lib/matricula-turma.sponte";
import {
  CATEGORIA_CONFERENCIA,
  MENSAGEM_CONFERIDO,
  TIPOS_CONFERENCIA,
  conferirCobrancas,
  conferirTurma,
  itemAceito,
  montarEsperadoConferencia,
  montarResultadoConferencia,
  type LancamentoEnvio,
  type ParcelaSponte,
  type ResultadoConferencia,
  type TipoConferencia,
} from "@/lib/matricula-conferencia";

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
  conferido_em: string | null;
};

const STATUS_REPROCESSAVEIS = ["erro_aluno", "erro_responsavel"];

async function assertCanEditAdmissoes(userId: string) {
  await exigirPermissaoPagina(
    userId,
    ["eformulario"],
    "editar",
    "Você não tem permissão para reprocessar matrículas.",
  );
}

async function assertCanViewAdmissoes(userId: string) {
  await exigirPermissaoPagina(
    userId,
    ["eformulario"],
    "ver",
    "Você não tem permissão para ver as matrículas.",
  );
}

const ReprocessarInputSchema = z.object({ id: z.string().uuid() });

export const reprocessarMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReprocessarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<ReprocessarMatriculaResult> => {
    await assertCanEditAdmissoes(context.userId);

    const { data: row } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("id, status, sponte_aluno_id, payload, tentativas, conferido_em")
      .eq("id", data.id)
      .maybeSingle();
    const submissao = row as unknown as SubmissaoRow | null;
    if (!submissao) return { ok: false, error: "Submissão não encontrada." };
    if (submissao.conferido_em) {
      return {
        ok: false,
        error: "Submissão conferida no Sponte — desfaça a conferência antes de reprocessar.",
      };
    }

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
        error: "O payload gravado não atende ao contrato de matrícula — corrija na origem.",
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
      resultado = await processarMatricula(payload);
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
      .is("arquivada_em", null)
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

// ─── Exclusão de submissão (somente admin) ──────────────────────────────────
//
// Remove a submissão e TODOS os registros ligados por submission_id no School
// Hub (student_routine, matricula_saude, matricula_documentos + arquivos do
// bucket matricula-documentos, onboarding, matricula_faturamento_lancamentos).
// Nada é alterado no Sponte nem no Diário do Aluno: o resumo do que já existe
// lá é mostrado na confirmação e gravado em matricula_exclusoes ANTES de
// apagar. Os arquivos só saem do bucket depois que todas as linhas foram
// apagadas com sucesso; falha ao apagar arquivo vai para o log.

async function assertAdmin(
  userId: string,
  mensagem = "Apenas administradores podem excluir uma submissão.",
) {
  const { data } = await supabaseAdmin
    .from("user_roles" as never)
    .select("role")
    .eq("user_id", userId);
  const admin = ((data ?? []) as { role: string }[]).some((r) => r.role === "admin");
  if (!admin) throw new Error(mensagem);
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

// ─── Arquivamento (somente admin) ───────────────────────────────────────────
//
// Arquivar só marca a submissão (arquivada_em/por/por_nome): nada muda no
// Sponte, nas cobranças, na turma, nos documentos nem no status. A submissão
// arquivada sai da lista "Ativas" e das pendências do sino, mas continua
// encontrável pela busca por nome/CPF.

const ArquivarInputSchema = z.object({ id: z.string().uuid() });

async function marcarArquivada(id: string, campos: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("enrollment_submissions" as never)
    .update(campos as never)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (((data ?? []) as unknown[]).length === 0) throw new Error("Submissão não encontrada.");
}

export const arquivarMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArquivarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.userId, "Apenas administradores podem arquivar uma submissão.");
    await marcarArquivada(data.id, {
      arquivada_em: new Date().toISOString(),
      arquivada_por: context.userId,
      arquivada_por_nome: await nomeDoUsuario(context.userId),
    });
    return { ok: true };
  });

export const desarquivarMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArquivarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.userId, "Apenas administradores podem desarquivar uma submissão.");
    await marcarArquivada(data.id, {
      arquivada_em: null,
      arquivada_por: null,
      arquivada_por_nome: null,
    });
    return { ok: true };
  });

// Ao abrir a ficha: relê o nome do aluno no Sponte (só leitura) e atualiza
// aluno_nome quando o cadastro de lá foi corrigido.
export const atualizarNomeMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArquivarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<NomeSubmissaoResult> => {
    await assertCanViewAdmissoes(context.userId);
    return sincronizarNomeSubmissao(data.id);
  });

// ─── Conferência "Verificar no Sponte" (só admin) ───────────────────────────
//
// Compara o que a família escolheu NAQUELE envio (rotina gravada em
// student_routine e plano em matricula_faturamento_lancamentos da submissão)
// com o estado atual do Sponte (GetCursos, GetTurmas, GetMatriculas e
// GetParcelas; só leitura). Credenciais pela unidade gravada na submissão.
// Estando tudo de acordo, fixa a conferência (conferido_em/por/por_nome); o
// gatilho da migration 20261122090000 impede rotinas automáticas de alterar a
// turma, a cobrança, as pendências e os lançamentos a partir daí.

const DispensasSchema = z.record(
  z.enum(TIPOS_CONFERENCIA as [TipoConferencia, ...TipoConferencia[]]),
  z.string().max(300),
);

const VerificarConferenciaSchema = z.object({
  id: z.string().uuid(),
  dispensas: DispensasSchema.default({}),
});

type SubmissaoConferenciaRow = {
  id: string;
  submission_id: string | null;
  unidade: string | null;
  sponte_aluno_id: number | null;
  created_at: string;
  conferido_em: string | null;
};

type RotinaConferenciaRow = {
  serie: string | null;
  ano_letivo: number | null;
  sem_refeicoes: boolean;
  refeicoes: Record<string, number[]> | null;
  horario_estendido: boolean;
};

export interface VerificarConferenciaResult {
  resultado: ResultadoConferencia;
  fixado: boolean;
  mensagem: string;
}

function dataSaoPaulo(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

export const verificarConferenciaMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => VerificarConferenciaSchema.parse(input))
  .handler(async ({ data, context }): Promise<VerificarConferenciaResult> => {
    await assertCanViewAdmissoes(context.userId);
    await assertAdmin(context.userId, "Apenas administradores podem verificar no Sponte.");

    for (const [tipo, motivo] of Object.entries(data.dispensas)) {
      if (!motivo.trim()) {
        throw new Error(
          `Informe o motivo para dispensar ${CATEGORIA_CONFERENCIA[tipo as TipoConferencia]}.`,
        );
      }
    }

    const { data: row, error: erroSub } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("id, submission_id, unidade, sponte_aluno_id, created_at, conferido_em")
      .eq("id", data.id)
      .maybeSingle();
    if (erroSub) throw new Error(erroSub.message);
    const sub = row as unknown as SubmissaoConferenciaRow | null;
    if (!sub) throw new Error("Submissão não encontrada.");
    if (sub.conferido_em) throw new Error("Esta submissão já foi conferida.");
    if (!sub.sponte_aluno_id) throw new Error("Submissão sem AlunoID no Sponte.");
    if (!sub.submission_id) throw new Error("Submissão sem protocolo do formulário.");
    const creds = sub.unidade ? resolverCredenciais(sub.unidade) : null;
    if (!sub.unidade || !creds) {
      throw new Error(`A unidade "${sub.unidade ?? "—"}" não tem integração com o Sponte.`);
    }

    const [rotinaRes, lancRes] = await Promise.all([
      supabaseAdmin
        .from("student_routine" as never)
        .select("serie, ano_letivo, sem_refeicoes, refeicoes, horario_estendido")
        .eq("submission_id", sub.submission_id)
        .maybeSingle(),
      supabaseAdmin
        .from("matricula_faturamento_lancamentos" as never)
        .select(
          "tipo, parcelas, valor_parcela, valor_primeira_parcela, total, primeiro_vencimento, status",
        )
        .eq("submission_id", sub.submission_id),
    ]);
    if (rotinaRes.error) throw new Error(rotinaRes.error.message);
    if (lancRes.error) throw new Error(lancRes.error.message);
    const rotina = rotinaRes.data as unknown as RotinaConferenciaRow | null;
    if (!rotina?.serie || !rotina.ano_letivo) {
      throw new Error("A submissão não tem série e ano letivo gravados na rotina do envio.");
    }
    const serie = rotina.serie;
    const anoLetivo = rotina.ano_letivo;
    const alunoId = sub.sponte_aluno_id;

    const [cursos, turmasDoAno, matriculas, titulos] = await Promise.all([
      buscarCursos(creds),
      buscarTurmasDoAno(creds, anoLetivo),
      matriculasDoAluno(creds, alunoId),
      coletarTitulosAluno(sub.unidade, String(alunoId)),
    ]);
    if (titulos.indisponivel || titulos.error) {
      throw new Error(
        `Não foi possível ler as parcelas no Sponte: ${titulos.error ?? "indisponível"}.`,
      );
    }

    const esperados = montarEsperadoConferencia({
      anoLetivo,
      dataPreenchimento: dataSaoPaulo(sub.created_at),
      rotina: {
        semRefeicoes: rotina.sem_refeicoes,
        refeicoes: rotina.refeicoes ?? {},
        horarioEstendido: rotina.horario_estendido,
      },
      lancamentos: (lancRes.data ?? []) as unknown as LancamentoEnvio[],
    });
    const parcelas: ParcelaSponte[] = titulos.titulos
      .filter((t) => t.vencimento)
      .map((t) => ({
        contaReceberId: t.contaReceberID,
        numeroParcela: t.numeroParcela,
        vencimento: t.vencimento,
        categoria: t.categoria,
        valor: t.valor,
        situacao: t.situacao,
      }));
    const agora = new Date().toISOString();
    const nome = await nomeDoUsuario(context.userId);
    const resultado = montarResultadoConferencia({
      turma: conferirTurma({ serie, anoLetivo, matriculas, turmasDoAno, cursos }),
      itens: conferirCobrancas(esperados, parcelas, data.dispensas),
      verificadoEm: agora,
      verificadoPor: nome,
    });

    const campos: Record<string, unknown> = { conferencia: resultado };
    if (resultado.turma.ok) {
      campos.turma_status = "matriculado";
      campos.turma_nome = resultado.turma.turmaNome;
      campos.turma_pendencia = null;
    }
    const cobrancasOk = resultado.itens.every(itemAceito);
    if (cobrancasOk) {
      campos.faturamento_status = "lancado";
      campos.faturamento_pendencia = null;
    }
    if (resultado.fixavel) {
      campos.conferido_em = agora;
      campos.conferido_por = context.userId;
      campos.conferido_por_nome = nome;
      campos.pendencia_resolvida_em = agora;
      campos.pendencia_resolvida_por = nome;
    }
    const { data: gravadas, error } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .update(campos as never)
      .eq("id", sub.id)
      .is("conferido_em", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!gravadas || (gravadas as unknown[]).length === 0) {
      throw new Error("Esta submissão já foi conferida.");
    }

    return {
      resultado,
      fixado: resultado.fixavel,
      mensagem: resultado.fixavel
        ? MENSAGEM_CONFERIDO
        : `Ainda falta: ${resultado.faltando.join("; ")}.`,
    };
  });

export const desfazerConferenciaMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ArquivarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertCanViewAdmissoes(context.userId);
    await assertAdmin(context.userId, "Apenas administradores podem desfazer a conferência.");
    const { error } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .update({ conferido_em: null, conferido_por: null, conferido_por_nome: null } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
