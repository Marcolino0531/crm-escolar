// Server function do Dashboard de Matrículas: reenvia ao Sponte uma submissão
// que falhou, a partir do payload original gravado na auditoria.
//
// A linha existente é ATUALIZADA (não se cria outra) para que o histórico da
// submissão continue único — o índice de idempotência por submission_id depende disso.
// Se o aluno já tinha sido criado na tentativa anterior, o reenvio vai direto
// para os responsáveis (`alunoIdExistente`), sem duplicar o cadastro.

import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { UNIDADES_SPONTE, allowedSponteUnidades } from "@/lib/sponte.functions";
import { DOCUMENTOS_BUCKET, paraColegioRecibo, type ColegioRow } from "@/lib/colegios";
import { dimensoesImagem } from "@/lib/contrato-matricula.functions";
import type { LogoRecibo, Timbre } from "@/lib/documento-pdf";
import { enderecoLinha } from "@/lib/recibos";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MatriculaSchema, problemasDoPayload } from "@/lib/matriculas.schema";
import {
  BUCKET_DOCUMENTOS_MATRICULA,
  DOCUMENTOS_MATRICULA,
  colunasSaude,
  saudeFormDaLinha,
  type ColunasSaude,
} from "@/lib/matricula-form";
import {
  montarSecoesDetalhe,
  type PayloadDetalhe,
  type SecaoDetalhe,
} from "@/lib/matricula-detalhe";
import {
  buscarAlunoPorId,
  buscarResponsaveisComFinanceiro,
  submissionIdRematricula,
} from "@/lib/rematricula.functions";
import {
  PREFIXO_DOCUMENTO_LIVRE,
  TAMANHO_MAX_NOME_DOCUMENTO,
  caminhoDaSubmissao,
  erroArquivoDocumento,
  ordemDocumento,
  pastaDocumentosSecretaria,
  type OrigemDocumento,
} from "@/lib/matricula-documentos";
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
import { exigirPermissaoPagina, temPermissaoPagina } from "@/lib/permissoes-servidor";
import { sincronizarNomeSubmissao, type NomeSubmissaoResult } from "@/lib/matriculas-nome.server";
import { MENSAGEM_CONFERIDO, montarCamposConferenciaManual } from "@/lib/matricula-conferencia";

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
        error: "Submissão conferida — desfaça a conferência antes de reprocessar.",
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
  // Turno das aulas curriculares do Horário Estendido ("" quando não há).
  horarioCurricular?: "M" | "T" | "";
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
  id?: string;
  documento: string;
  /** Nome livre ("Anexar outro documento"); null nos documentos da lista. */
  nomeDocumento?: string | null;
  nomeArquivo: string;
  tipoArquivo: string;
  tamanhoBytes: number;
  origem?: OrigemDocumento;
  anexadoPorNome?: string | null;
  anexadoEm?: string | null;
  // Assinado agora, de curta duração; null se o arquivo sumiu do bucket.
  url: string | null;
  /** Mesmo arquivo, com o nome original para download. */
  urlDownload?: string | null;
}

/** Versão anterior de um documento substituído na ficha (o arquivo continua no bucket). */
export interface DocumentoHistoricoSubmissao extends DocumentoSubmissao {
  substituidoEm: string;
  substituidoPorNome: string | null;
}

export interface DetalheMatriculaResult {
  ok: boolean;
  error?: string;
  rotina?: RotinaSubmissao | null;
  saude?: SaudeSubmissao | null;
  documentos?: DocumentoSubmissao[];
  historicoDocumentos?: DocumentoHistoricoSubmissao[];
  lancamentos?: LancamentoFicha[];
}

interface LinhaDocumento {
  id: string;
  documento: string;
  nome_documento: string | null;
  storage_path: string;
  nome_arquivo: string;
  tipo_arquivo: string;
  tamanho_bytes: number;
  origem: OrigemDocumento | null;
  anexado_por_nome: string | null;
}

async function documentoAssinado(
  doc: LinhaDocumento,
  anexadoEm: string,
): Promise<DocumentoSubmissao> {
  const bucket = supabaseAdmin.storage.from(BUCKET_DOCUMENTOS_MATRICULA);
  const [ver, baixar] = await Promise.all([
    bucket.createSignedUrl(doc.storage_path, VALIDADE_LINK_DOCUMENTO),
    bucket.createSignedUrl(doc.storage_path, VALIDADE_LINK_DOCUMENTO, {
      download: doc.nome_arquivo,
    }),
  ]);
  return {
    id: doc.id,
    documento: doc.documento,
    nomeDocumento: doc.nome_documento,
    nomeArquivo: doc.nome_arquivo,
    tipoArquivo: doc.tipo_arquivo,
    tamanhoBytes: doc.tamanho_bytes,
    origem: doc.origem ?? "familia",
    anexadoPorNome: doc.anexado_por_nome,
    anexadoEm,
    url: ver.data?.signedUrl ?? null,
    urlDownload: baixar.data?.signedUrl ?? null,
  };
}

const COLUNAS_ROTINA_FICHA =
  "serie, origem, ano_letivo, data_inicio, dias_ativos, horarios, periodo_manha, periodo_tarde, horario_estendido, horario_curricular, sem_refeicoes, refeicoes";

interface LinhaRotinaFicha {
  serie: string | null;
  origem: string;
  ano_letivo: number | null;
  data_inicio: string;
  dias_ativos: number[];
  horarios: { weekday: number; entrada: string; saida: string }[];
  periodo_manha: boolean;
  periodo_tarde: boolean;
  horario_estendido: boolean;
  horario_curricular: string | null;
  sem_refeicoes: boolean;
  refeicoes: Record<string, number[]>;
}

function rotinaDaLinha(linha: LinhaRotinaFicha): RotinaSubmissao {
  return {
    serie: linha.serie,
    origem: linha.origem,
    anoLetivo: linha.ano_letivo,
    dataInicio: linha.data_inicio,
    diasAtivos: linha.dias_ativos ?? [],
    periodoManha: linha.periodo_manha,
    periodoTarde: linha.periodo_tarde,
    horarioEstendido: linha.horario_estendido,
    horarioCurricular:
      linha.horario_curricular === "M" || linha.horario_curricular === "T"
        ? linha.horario_curricular
        : "",
    horarios: linha.horarios ?? [],
    semRefeicoes: linha.sem_refeicoes,
    refeicoes: linha.refeicoes ?? {},
  };
}

function saudeDaLinha(linha: ColunasSaude): SaudeSubmissao {
  return {
    contatoEmergencia: linha.contato_emergencia,
    alergia: linha.alergia,
    alergiaDetalhe: linha.alergia_detalhe,
    problemaSaude: linha.problema_saude,
    problemaSaudeDetalhe: linha.problema_saude_detalhe,
    medicamentoContinuo: linha.medicamento_continuo,
    medicamentoContinuoDetalhe: linha.medicamento_continuo_detalhe,
    planoSaude: linha.plano_saude,
    planoSaudeDetalhe: linha.plano_saude_detalhe,
    pessoasAutorizadas: linha.pessoas_autorizadas,
    corRaca: linha.cor_raca,
    outrasInformacoes: linha.outras_informacoes,
  };
}

const COLUNAS_DOCUMENTO_FICHA =
  "id, documento, nome_documento, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes, origem, anexado_por_nome, created_at";

const DetalheInputSchema = z.object({ submissionId: z.string().min(1).max(200) });

export const detalheMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DetalheInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<DetalheMatriculaResult> => {
    await assertCanViewAdmissoes(context.userId);

    const [rotinaRes, saudeRes, docsRes, histRes, lancRes] = await Promise.all([
      supabaseAdmin
        .from("student_routine" as never)
        .select(COLUNAS_ROTINA_FICHA)
        .eq("submission_id", data.submissionId)
        .maybeSingle(),
      supabaseAdmin
        .from("matricula_saude" as never)
        .select("*")
        .eq("submission_id", data.submissionId)
        .maybeSingle(),
      // leitura-restrita: filtrada por submission_id
      supabaseAdmin
        .from("matricula_documentos" as never)
        .select(COLUNAS_DOCUMENTO_FICHA)
        .eq("submission_id", data.submissionId)
        .order("created_at"),
      // leitura-restrita: filtrada por submission_id
      supabaseAdmin
        .from("matricula_documentos_historico" as never)
        .select(
          "id, documento, nome_documento, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes, origem, anexado_por_nome, anexado_em, substituido_em, substituido_por_nome",
        )
        .eq("submission_id", data.submissionId)
        .order("substituido_em", { ascending: false }),
      // leitura-restrita: filtrada por submission_id
      supabaseAdmin
        .from("matricula_faturamento_lancamentos" as never)
        .select(
          "tipo, parcelas, valor_parcela, valor_primeira_parcela, primeiro_vencimento, total, status, erro, sponte_conta_receber_id",
        )
        .eq("submission_id", data.submissionId)
        .order("created_at"),
    ]);

    const linhaRotina = rotinaRes.data as unknown as LinhaRotinaFicha | null;

    const linhaSaude = saudeRes.data as unknown as ColunasSaude | null;

    if (docsRes.error) throw new Error(docsRes.error.message);
    if (histRes.error) throw new Error(histRes.error.message);
    const linhasDoc = (docsRes.data ?? []) as unknown as (LinhaDocumento & {
      created_at: string;
    })[];
    const linhasHist = (histRes.data ?? []) as unknown as (LinhaDocumento & {
      anexado_em: string;
      substituido_em: string;
      substituido_por_nome: string | null;
    })[];

    const documentos = await Promise.all(
      [...linhasDoc]
        .sort((a, b) => ordemDocumento(a.documento) - ordemDocumento(b.documento))
        .map((doc) => documentoAssinado(doc, doc.created_at)),
    );
    const historicoDocumentos: DocumentoHistoricoSubmissao[] = await Promise.all(
      linhasHist.map(async (doc) => ({
        ...(await documentoAssinado(doc, doc.anexado_em)),
        substituidoEm: doc.substituido_em,
        substituidoPorNome: doc.substituido_por_nome,
      })),
    );

    return {
      ok: true,
      rotina: linhaRotina ? rotinaDaLinha(linhaRotina) : null,
      saude: linhaSaude ? saudeDaLinha(linhaSaude) : null,
      documentos,
      historicoDocumentos,
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
  // leitura-restrita: filtrada por user_id (um usuário)
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
    // limite-intencional: fila de pendências limitada a 200
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
  // leitura-restrita: filtrada por user_id (um usuário)
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
    // leitura-restrita: filtrada por submission_id
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
  "matricula_documentos_historico",
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
      const [{ data: docs }, { data: hist }] = await Promise.all([
        // leitura-restrita: filtrada por submission_id
        supabaseAdmin
          .from("matricula_documentos" as never)
          .select("storage_path")
          .eq("submission_id", row.submission_id),
        // leitura-restrita: filtrada por submission_id
        supabaseAdmin
          .from("matricula_documentos_historico" as never)
          .select("storage_path")
          .eq("submission_id", row.submission_id),
      ]);
      caminhos = [
        ...new Set(
          [...((docs ?? []) as unknown[]), ...((hist ?? []) as unknown[])].map(
            (d) => (d as { storage_path: string }).storage_path,
          ),
        ),
      ];

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

// ─── Conferência manual (só admin) ──────────────────────────────────────────
//
// O admin marca "Turma conferida" e/ou "Cobrança lançada". Com as duas
// marcadas a conferência é fixada (conferido_em/por/por_nome); o gatilho da
// migration 20261122090000 impede rotinas automáticas de alterar a turma, a
// cobrança, as pendências e os lançamentos a partir daí. Nada é lido nem
// gravado no Sponte.

const ConferenciaManualSchema = z.object({
  id: z.string().uuid(),
  turmaConferida: z.boolean(),
  cobrancaLancada: z.boolean(),
});

export interface SalvarConferenciaManualResult {
  fixado: boolean;
  mensagem: string;
}

export const salvarConferenciaManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConferenciaManualSchema.parse(input))
  .handler(async ({ data, context }): Promise<SalvarConferenciaManualResult> => {
    await assertCanViewAdmissoes(context.userId);
    await assertAdmin(context.userId, "Apenas administradores podem conferir a matrícula.");
    if (!data.turmaConferida && !data.cobrancaLancada) {
      throw new Error('Marque "Turma conferida" e/ou "Cobrança lançada" para salvar.');
    }
    const nome = await nomeDoUsuario(context.userId);
    const { campos, fixado } = montarCamposConferenciaManual({
      turmaConferida: data.turmaConferida,
      cobrancaLancada: data.cobrancaLancada,
      em: new Date().toISOString(),
      porId: context.userId,
      porNome: nome,
    });
    const { data: gravadas, error } = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .update(campos as never)
      .eq("id", data.id)
      .is("conferido_em", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!gravadas || (gravadas as unknown[]).length === 0) {
      throw new Error("Submissão não encontrada ou já conferida.");
    }
    return {
      fixado,
      mensagem: fixado
        ? MENSAGEM_CONFERIDO
        : data.turmaConferida
          ? 'Turma conferida. Falta marcar "Cobrança lançada" para fixar a conferência.'
          : 'Cobrança lançada. Falta marcar "Turma conferida" para fixar a conferência.',
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

// ─── Documentos anexados pela secretaria na ficha ───────────────────────────
//
// Para arquivos que a família mandou depois do envio (ex.: WhatsApp). Mesmo
// bucket privado e mesmo mecanismo do formulário (link de upload assinado),
// e, como exceção à regra de que gravar exige Editar, basta Visualizar no
// e-Formulário para ANEXAR (documento pendente da lista ou de nome livre): a
// recepção recebe documentos pelo WhatsApp. Substituir um documento que já tem
// arquivo continua exigindo Editar. A linha vai para
// matricula_documentos com a submission_id, a unidade e o sponte_aluno_id da
// submissão (é assim que a Cobrança já encontra os documentos do aluno). O
// payload, a turma, as cobranças, a conferência e o arquivamento não mudam.
// Substituir guarda a versão anterior em matricula_documentos_historico; o
// arquivo antigo continua no bucket. Excluir: só admin e só anexos da
// secretaria.

const CHAVES_DOCUMENTO = DOCUMENTOS_MATRICULA.map((d) => d.chave) as [string, ...string[]];

async function assertCanAnexarDocumento(userId: string) {
  await exigirPermissaoPagina(
    userId,
    ["eformulario"],
    "ver",
    "Você não tem permissão para anexar documentos à matrícula.",
  );
}

// ─── Timbre da ficha da matrícula ────────────────────────────────────────────
// Quem tem só o e-Formulário não lê documentos_colegios nem o bucket
// "documentos" pelo navegador (policies de documentos.*): o timbre vem daqui.
// Sem cadastro, timbre nulo; sem logo ou logo fora de PNG/JPEG, logo nula.

export interface TimbreFichaMatricula {
  timbre: Timbre | null;
  logo: LogoRecibo | null;
}

const TimbreFichaSchema = z.object({ unidade: z.string().min(1).max(100) });

async function logoOpcionalServidor(logoPath: string | null): Promise<LogoRecibo | null> {
  if (!logoPath) return null;
  const { data, error } = await supabaseAdmin.storage.from(DOCUMENTOS_BUCKET).download(logoPath);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const dim = dimensoesImagem(bytes);
  if (!dim) return null;
  const mime = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
  return {
    dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    ...dim,
  };
}

export const timbreFichaMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TimbreFichaSchema.parse(input))
  .handler(async ({ data, context }): Promise<TimbreFichaMatricula> => {
    await assertCanViewAdmissoes(context.userId);
    const permitidas = await allowedSponteUnidades(context.userId);
    if (permitidas !== null && !permitidas.includes(data.unidade))
      throw new Error("Você não tem acesso a esta unidade.");

    const { data: row, error } = await supabaseAdmin
      .from("documentos_colegios" as never)
      .select("*")
      .eq("unidade", data.unidade)
      .maybeSingle<ColegioRow>();
    if (error) throw new Error(error.message);
    if (!row) return { timbre: null, logo: null };

    const colegio = paraColegioRecibo(row);
    return {
      timbre: {
        colegio,
        enderecoColegio: enderecoLinha(colegio),
        contatoColegio: [row.telefone, row.email, row.site].filter(Boolean).join(" · "),
      },
      logo: await logoOpcionalServidor(row.logo_path),
    };
  });

// ─── Ficha do aluno (rematrícula ou cadastro manual no Sponte) ──────────────
//
// Somente leitura: aluno e responsáveis lidos do Sponte na hora; rotina, saúde
// e escolhas da rematrícula daquele ano; documentos que existirem do aluno. Se
// o aluno tem ficha do formulário de matrícula no ano, a tela abre essa.

const FichaAlunoSchema = z.object({
  unidade: z.string().min(1).max(100),
  alunoId: z.string().regex(/^\d{1,12}$/),
  anoLetivo: z.number().int().min(2000).max(2100),
});

export interface FichaAlunoResult {
  ok: boolean;
  erro?: string;
  /** id em enrollment_submissions quando há ficha do formulário naquele ano. */
  submissaoId?: string;
  alunoNome?: string;
  origem?: string;
  secoes?: SecaoDetalhe[];
}

export const fichaAlunoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FichaAlunoSchema.parse(input))
  .handler(async ({ data, context }): Promise<FichaAlunoResult> => {
    await assertCanViewAdmissoes(context.userId);
    const permitidas = await allowedSponteUnidades(context.userId);
    if (permitidas !== null && !permitidas.includes(data.unidade))
      throw new Error("Você não tem acesso a esta unidade.");

    const { unidade, alunoId, anoLetivo } = data;
    const sponteAlunoId = Number(alunoId);

    const formulario = await supabaseAdmin
      .from("enrollment_submissions" as never)
      .select("id")
      .eq("unidade", unidade)
      .eq("sponte_aluno_id", sponteAlunoId)
      .eq("ano_letivo", anoLetivo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (formulario.error) throw new Error(formulario.error.message);
    if (formulario.data) return { ok: true, submissaoId: formulario.data.id };

    const idRematricula = submissionIdRematricula(unidade, alunoId, anoLetivo);
    const [aluno, responsaveis, rotina, saude, docs, matricula, material, extras, envio] =
      await Promise.all([
        buscarAlunoPorId(unidade, alunoId),
        buscarResponsaveisComFinanceiro(unidade, alunoId, anoLetivo),
        supabaseAdmin
          .from("student_routine" as never)
          .select(COLUNAS_ROTINA_FICHA)
          .eq("submission_id", idRematricula)
          .maybeSingle<LinhaRotinaFicha>(),
        supabaseAdmin
          .from("matricula_saude" as never)
          .select("*")
          .eq("submission_id", idRematricula)
          .maybeSingle<ColunasSaude>(),
        // leitura-restrita: filtrada por um aluno
        supabaseAdmin
          .from("matricula_documentos" as never)
          .select(COLUNAS_DOCUMENTO_FICHA)
          .eq("unidade", unidade)
          .eq("sponte_aluno_id", sponteAlunoId)
          .order("created_at"),
        supabaseAdmin
          .from("rematricula_matricula_escolhas" as never)
          .select("valor, parcelas, primeiro_vencimento")
          .eq("unidade", unidade)
          .eq("aluno_id", alunoId)
          .eq("ano_letivo", anoLetivo)
          .maybeSingle<{ valor: number; parcelas: number; primeiro_vencimento: string | null }>(),
        supabaseAdmin
          .from("rematricula_escolhas" as never)
          .select("valor_anual, parcelas")
          .eq("unidade", unidade)
          .eq("aluno_id", alunoId)
          .eq("ano_letivo", anoLetivo)
          .maybeSingle<{ valor_anual: number; parcelas: number }>(),
        supabaseAdmin
          .from("rematricula_extras_escolhas" as never)
          .select("selecionadas, finalizada_em")
          .eq("unidade", unidade)
          .eq("aluno_id", alunoId)
          .eq("ano_letivo", anoLetivo)
          .maybeSingle<{ selecionadas: string[] | null; finalizada_em: string | null }>(),
        supabaseAdmin
          .from("rematricula_envios" as never)
          .select("enviada_em")
          .eq("unidade", unidade)
          .eq("aluno_id", alunoId)
          .eq("ano_letivo", anoLetivo)
          .maybeSingle<{
            enviada_em: string;
          }>(),
      ]);
    for (const r of [rotina, saude, docs, matricula, material, extras, envio])
      if (r.error) throw new Error(r.error.message);
    if (!aluno) return { ok: false, erro: "Não foi possível ler o aluno no Sponte." };

    const extrasEscolhidos =
      extras.data && (extras.data.finalizada_em || (extras.data.selecionadas ?? []).length > 0)
        ? (extras.data.selecionadas ?? [])
        : null;
    const fezRematricula =
      [rotina.data, saude.data, matricula.data, material.data, envio.data].some(Boolean) ||
      extrasEscolhidos !== null;
    const origem = fezRematricula ? `Rematrícula ${anoLetivo}` : "Cadastro manual no Sponte";

    const linhasDoc = (docs.data ?? []) as unknown as (LinhaDocumento & { created_at: string })[];
    const documentos = await Promise.all(
      [...linhasDoc]
        .sort((a, b) => ordemDocumento(a.documento) - ordemDocumento(b.documento))
        .map((doc) => documentoAssinado(doc, doc.created_at)),
    );

    const payload: PayloadDetalhe = {
      unidade,
      aluno: {
        nome: aluno.nome,
        dataNascimento: aluno.dataNascimento,
        cpf: aluno.cpf,
        email: aluno.email,
        telefone: aluno.telefone,
      },
      endereco: {
        cep: aluno.cep,
        logradouro: aluno.endereco,
        numero: aluno.numero,
        complemento: aluno.complemento,
        bairro: aluno.bairro,
        cidade: aluno.cidade,
      },
      responsaveis: responsaveis.map((r) => ({
        nome: r.nome,
        parentesco: r.parentesco,
        dataNascimento: r.dataNascimento,
        cpf: r.cpf,
        email: r.email,
        telefone: r.telefone,
        responsavelFinanceiro: r.financeiro,
        responsavelDidatico:
          !!aluno.responsavelDidaticoId && r.responsavelId === aluno.responsavelDidaticoId,
        endereco: {
          cep: r.cep,
          logradouro: r.endereco,
          numero: r.numero,
          complemento: r.complemento,
          bairro: r.bairro,
          cidade: r.cidade,
        },
      })),
    };

    const m = matricula.data;
    const mat = material.data;
    const secoes = montarSecoesDetalhe({
      submissao: {
        submissionId: null,
        unidade,
        alunoNome: aluno.nome,
        alunoCpf: aluno.cpf || null,
        status: origem,
        criadoEm: "",
        sponteAlunoId,
        erro: null,
        payload,
      },
      rotina: rotina.data ? rotinaDaLinha(rotina.data) : null,
      saude: saude.data ? saudeDaLinha(colunasSaude(saudeFormDaLinha(saude.data))) : null,
      documentos,
      fichaAluno: {
        origem,
        anoLetivo,
        snapshot: {
          matricula_valor: m ? Number(m.valor) : null,
          matricula_parcelas: m?.parcelas ?? null,
          matricula_primeiro_vencimento: m?.primeiro_vencimento ?? null,
          material_valor_anual: mat ? Number(mat.valor_anual) : null,
          material_parcelas: mat?.parcelas ?? null,
        },
        extras: extrasEscolhidos,
      },
    });

    return { ok: true, alunoNome: aluno.nome, origem, secoes };
  });

const MENSAGEM_SUBSTITUIR_SEM_EDITAR =
  "Este documento já foi enviado. Só quem tem permissão de edição pode substituir.";

interface SubmissaoDocumentos {
  id: string;
  submission_id: string;
  unidade: string;
  sponte_aluno_id: number | null;
}

async function carregarSubmissaoDocumentos(id: string): Promise<SubmissaoDocumentos> {
  const { data, error } = await supabaseAdmin
    .from("enrollment_submissions" as never)
    .select("id, submission_id, unidade, sponte_aluno_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as unknown as {
    id: string;
    submission_id: string | null;
    unidade: string | null;
    sponte_aluno_id: number | null;
  } | null;
  if (!row) throw new Error("Submissão não encontrada.");
  if (!row.submission_id || !row.unidade)
    throw new Error("Esta submissão não tem ficha local para receber documentos.");
  return {
    id: row.id,
    submission_id: row.submission_id,
    unidade: row.unidade,
    sponte_aluno_id: row.sponte_aluno_id,
  };
}

const UrlUploadSecretariaSchema = z.object({
  id: z.string().uuid(),
  tipo: z.string().max(100),
  tamanho: z.number().int().nonnegative(),
});

export type UrlUploadSecretaria =
  | { ok: true; path: string; token: string }
  | { ok: false; erro: string };

export const urlUploadDocumentoSecretaria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UrlUploadSecretariaSchema.parse(input))
  .handler(async ({ data, context }): Promise<UrlUploadSecretaria> => {
    await assertCanAnexarDocumento(context.userId);
    const erro = erroArquivoDocumento(data.tipo, data.tamanho);
    if (erro) return { ok: false, erro };
    const sub = await carregarSubmissaoDocumentos(data.id);

    const path = `${pastaDocumentosSecretaria(sub.id)}/${randomUUID()}`;
    const { data: assinado, error } = await supabaseAdmin.storage
      .from(BUCKET_DOCUMENTOS_MATRICULA)
      .createSignedUploadUrl(path);
    if (error || !assinado)
      return { ok: false, erro: "Não foi possível enviar o arquivo agora. Tente novamente." };
    return { ok: true, path: assinado.path, token: assinado.token };
  });

const RegistrarDocumentoSchema = z
  .object({
    id: z.string().uuid(),
    path: z.string().min(1).max(300),
    nomeArquivo: z.string().min(1).max(300),
    documento: z.enum(CHAVES_DOCUMENTO).optional(),
    nomeDocumento: z.string().max(TAMANHO_MAX_NOME_DOCUMENTO).optional(),
  })
  .refine((d) => (d.documento !== undefined) !== (d.nomeDocumento !== undefined), {
    message: "Informe o documento da lista ou o nome do documento.",
  });

async function metadadosDoArquivo(path: string): Promise<{ tipo: string; tamanho: number } | null> {
  const barra = path.lastIndexOf("/");
  const { data } = await supabaseAdmin.storage
    .from(BUCKET_DOCUMENTOS_MATRICULA)
    .list(path.slice(0, barra), { search: path.slice(barra + 1), limit: 10 });
  const obj = (data ?? []).find((o) => o.name === path.slice(barra + 1));
  if (!obj) return null;
  const meta = (obj.metadata ?? {}) as { mimetype?: unknown; size?: unknown };
  return {
    tipo: typeof meta.mimetype === "string" ? meta.mimetype : "",
    tamanho: typeof meta.size === "number" ? meta.size : 0,
  };
}

async function removerArquivo(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET_DOCUMENTOS_MATRICULA).remove([path]);
  if (error) console.error("[matrículas] falha ao remover arquivo do bucket:", error.message, path);
}

export const registrarDocumentoSecretaria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RegistrarDocumentoSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; substituido: boolean }> => {
    await assertCanAnexarDocumento(context.userId);
    const sub = await carregarSubmissaoDocumentos(data.id);
    if (!caminhoDaSubmissao(data.path, sub.id)) throw new Error("Arquivo inválido.");

    const nomeDocumento = data.nomeDocumento?.trim() ?? null;
    if (data.documento === undefined && !nomeDocumento)
      throw new Error("Informe o nome do documento.");

    const meta = await metadadosDoArquivo(data.path);
    if (!meta) throw new Error("O arquivo não chegou ao armazenamento. Envie de novo.");
    const erro = erroArquivoDocumento(meta.tipo, meta.tamanho);
    if (erro) {
      await removerArquivo(data.path);
      throw new Error(erro);
    }

    const agora = new Date().toISOString();
    const nomeUsuario = await nomeDoUsuario(context.userId);
    const novo = {
      storage_path: data.path,
      nome_arquivo: data.nomeArquivo.slice(0, 200),
      tipo_arquivo: meta.tipo,
      tamanho_bytes: meta.tamanho,
      origem: "secretaria",
      anexado_por: context.userId,
      anexado_por_nome: nomeUsuario,
      created_at: agora,
    };

    if (data.documento === undefined) {
      const { error } = await supabaseAdmin.from("matricula_documentos" as never).insert({
        submission_id: sub.submission_id,
        unidade: sub.unidade,
        sponte_aluno_id: sub.sponte_aluno_id,
        documento: `${PREFIXO_DOCUMENTO_LIVRE}${randomUUID()}`,
        nome_documento: nomeDocumento,
        ...novo,
      } as never);
      if (error) {
        await removerArquivo(data.path);
        throw new Error(`Falha ao registrar o documento: ${error.message}`);
      }
      return { ok: true, substituido: false };
    }

    const { data: atualRaw, error: atualErr } = await supabaseAdmin
      .from("matricula_documentos" as never)
      .select(
        "id, submission_id, unidade, sponte_aluno_id, documento, nome_documento, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes, origem, anexado_por, anexado_por_nome, created_at",
      )
      .eq("submission_id", sub.submission_id)
      .eq("documento", data.documento)
      .maybeSingle();
    if (atualErr) {
      await removerArquivo(data.path);
      throw new Error(atualErr.message);
    }
    const atual = atualRaw as unknown as
      | (LinhaDocumento & {
          submission_id: string;
          unidade: string;
          sponte_aluno_id: number | null;
          anexado_por: string | null;
          created_at: string;
        })
      | null;

    if (atual) {
      const podeSubstituir = await temPermissaoPagina(
        context.userId,
        ["eformulario"],
        "editar",
      ).catch(async (e: unknown) => {
        await removerArquivo(data.path);
        throw e;
      });
      if (!podeSubstituir) {
        await removerArquivo(data.path);
        throw new Error(MENSAGEM_SUBSTITUIR_SEM_EDITAR);
      }
    }

    if (!atual) {
      const { error } = await supabaseAdmin.from("matricula_documentos" as never).insert({
        submission_id: sub.submission_id,
        unidade: sub.unidade,
        sponte_aluno_id: sub.sponte_aluno_id,
        documento: data.documento,
        ...novo,
      } as never);
      if (error) {
        await removerArquivo(data.path);
        throw new Error(`Falha ao registrar o documento: ${error.message}`);
      }
      return { ok: true, substituido: false };
    }

    const { data: histRow, error: histErr } = await supabaseAdmin
      .from("matricula_documentos_historico" as never)
      .insert({
        documento_id: atual.id,
        submission_id: atual.submission_id,
        unidade: atual.unidade,
        sponte_aluno_id: atual.sponte_aluno_id,
        documento: atual.documento,
        nome_documento: atual.nome_documento,
        storage_path: atual.storage_path,
        nome_arquivo: atual.nome_arquivo,
        tipo_arquivo: atual.tipo_arquivo,
        tamanho_bytes: atual.tamanho_bytes,
        origem: atual.origem ?? "familia",
        anexado_por: atual.anexado_por,
        anexado_por_nome: atual.anexado_por_nome,
        anexado_em: atual.created_at,
        substituido_em: agora,
        substituido_por: context.userId,
        substituido_por_nome: nomeUsuario,
      } as never)
      .select("id")
      .single();
    if (histErr) {
      await removerArquivo(data.path);
      throw new Error(`Falha ao guardar a versão anterior: ${histErr.message}`);
    }

    const { error: updErr } = await supabaseAdmin
      .from("matricula_documentos" as never)
      .update({ ...novo, sponte_aluno_id: atual.sponte_aluno_id ?? sub.sponte_aluno_id } as never)
      .eq("id", atual.id);
    if (updErr) {
      await supabaseAdmin
        .from("matricula_documentos_historico" as never)
        .delete()
        .eq("id", (histRow as unknown as { id: string }).id);
      await removerArquivo(data.path);
      throw new Error(`Falha ao substituir o documento: ${updErr.message}`);
    }
    return { ok: true, substituido: true };
  });

const ExcluirDocumentoSchema = z.object({ documentoId: z.string().uuid() });

export const excluirDocumentoSecretaria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExcluirDocumentoSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context.userId, "Apenas administradores podem excluir um documento anexado.");
    const { data: raw, error } = await supabaseAdmin
      .from("matricula_documentos" as never)
      .select("id, storage_path, origem")
      .eq("id", data.documentoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const doc = raw as unknown as {
      id: string;
      storage_path: string;
      origem: string | null;
    } | null;
    if (!doc) throw new Error("Documento não encontrado.");
    if (doc.origem !== "secretaria")
      throw new Error("Documentos enviados pela família no formulário não podem ser excluídos.");

    const { error: delErr } = await supabaseAdmin
      .from("matricula_documentos" as never)
      .delete()
      .eq("id", doc.id);
    if (delErr) throw new Error(`Falha ao excluir o documento: ${delErr.message}`);
    await removerArquivo(doc.storage_path);
    return { ok: true };
  });
