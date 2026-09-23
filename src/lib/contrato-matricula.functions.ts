// Contrato de Matrícula/Rematrícula — geração MANUAL pela secretaria.
//
// A tela lista as matrículas finalizadas no portal (rematricula_envios) que
// ainda não têm contrato enviado. "Gerar e enviar contrato" executa, nesta
// ordem e abortando no primeiro erro:
//   1. autorização (edição em Rematrícula OU Documentos + unidade permitida);
//   2. dados persistidos da matrícula (parcelamento) —
//      ou, pela aba Documentos (matrícula nova), a Matrícula informada pela
//      secretaria (tabela do ano ou valor manual, parcelas, 1º vencimento) com
//      a série lida do Sponte;
//   3. dados ATUAIS do aluno, do responsável financeiro, da mensalidade vigente,
//      do Material Pedagógico e dos extras (contas a receber) no Sponte da
//      unidade do aluno;
//   4. Dados dos Colégios da MESMA unidade (razão social, CNPJ, representante
//      legal e CPF, logo) — nunca de outra unidade;
//   5. montagem + validação dos campos do modelo, PDF com a logo da unidade;
//   6. upload na ZapSign em PRODUÇÃO (ZAPSIGN_PROD_TOKEN) com 4 signatários:
//      responsável financeiro (CONTRATANTE), representante legal da unidade
//      (CONTRATADO, e-mail/celular pessoais de Dados dos Colégios) e as duas
//      testemunhas ativas (cadastro global em Configurações). Sem contato de
//      qualquer um deles o contrato não é gerado — não há fallback;
//   7. só então grava zapsign_documentos (ambiente 'producao', poc = false) e
//      marca o contrato como 'enviado'. Qualquer falha antes disso deixa o
//      contrato em 'erro' com a mensagem, e a matrícula continua pendente.
// O status de assinatura passa a vir do webhook (mesma rota do sandbox, com o
// segredo do ambiente de produção).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { selectAll } from "@/lib/supabase-paginate";
import { DOCUMENTOS_BUCKET, paraColegioRecibo, type ColegioRow } from "@/lib/colegios";
import { enderecoLinha } from "@/lib/recibos";
import type { LogoRecibo } from "@/lib/documento-pdf";
import { pdfParaBase64 } from "@/lib/documento-pdf";
import {
  extrasDoContrato,
  materialDoContrato,
  montarContratoMatricula,
  numeroContrato,
  periodoParcelasMensalidade,
  resumoContratoGerado,
  signatariosContrato,
  unirBaseContratos,
  validarContrato,
  type CamposContrato,
  type ExtrasContrato,
  type MaterialSponte,
  type TituloExtras,
  type MatriculaContrato,
  type MontarContratoInput,
  type ResumoContratoGerado,
  type SignatarioContrato,
  type TestemunhaContrato,
} from "@/lib/contrato-matricula";
import { gerarPdfContratoMatricula } from "@/lib/contrato-matricula-pdf";
import {
  detalharExtrasContrato,
  type HorarioRegistrado,
  type PlanoDiarioContrato,
} from "@/lib/contrato-extras-detalhe";
import type { MealKey, Weekday } from "@/lib/diario";
import { HORARIOS_PADRAO, segmentoDaSerie } from "@/lib/matricula-form";
import { turnoDaTurma, type TurnoTurma } from "@/lib/matricula-turma";
import {
  divergenciasExtrasDaUnidade,
  type DivergenciaExtraAluno,
} from "@/lib/rematricula-extras.functions";
import {
  BASE_URL_PORTAL,
  buscarAlunoPorId,
  buscarMensalidadeVigente,
  buscarResponsaveisComFinanceiro,
  exigirPermissaoRematricula,
  hojeBRT,
  itensMaterialDaSerie,
  valoresMatriculaDoAno,
} from "@/lib/rematricula.functions";
import { valorMatricula } from "@/lib/rematricula-matricula";
import { parcelasMensalidadeDoAnoLetivo, type ParcelasMensalidade } from "@/lib/rematricula";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { allowedSponteUnidades, coletarTitulosAluno } from "@/lib/sponte.functions";
import {
  criarDocumentoPdf,
  criarWebhook,
  recusarDocumento,
  zapsignConfigurado,
} from "@/lib/zapsign.server";
import {
  aplicarEstadoDocumento,
  signatarioDoSigner,
  T_DOCS,
  T_EVENTOS,
  T_WEBHOOKS,
  type SignatarioPersistido,
} from "@/lib/zapsign.persist";
import {
  contratoCancelavel,
  EVENTO_DOC_RECUSADO,
  validarMotivoCancelamento,
} from "@/lib/contrato-cancelamento";
import { emailValido } from "@/lib/imposto-renda-lote";

const T_CONTRATOS = "contratos_matricula" as never;
const AMBIENTE = "producao" as const;
const LOG_TAG = "[contrato-matricula]";

export type StatusContratoMatricula = "pendente" | "gerando" | "enviado" | "erro" | "cancelado";

/** Situação individual de cada signatário, na ordem enviada à ZapSign. */
export interface SignatarioContratoStatus {
  papel: string;
  nome: string;
  email: string;
  status: string;
  signUrl: string;
  assinadoEm: string;
}

export interface ContratoPendente {
  unidade: string;
  alunoId: string;
  alunoNome: string;
  anoLetivo: number;
  serie: string;
  /** Data do Finalizar no portal; "" quando o contrato saiu direto pela aba Documentos. */
  enviadaEm: string;
  /** Matrícula parcelada gravada pelo portal. */
  matricula: { valor: number; parcelas: number; primeiroVencimento: string } | null;
  /** Material pedagógico escolhido no portal (null = série sem material). */
  material: { valorAnual: number; parcelas: number } | null;
  /** Divergências de Extras gravadas no Finalizar (ação manual pendente no Sponte/Diário). */
  divergenciasExtras: DivergenciaExtraAluno[];
  /** Retrato do último contrato gerado (se houver). */
  contrato: {
    id: string;
    numero: string;
    status: StatusContratoMatricula;
    responsavelNome: string;
    responsavelEmail: string;
    mensalidadeComDesconto: string;
    /** Matrícula/Material como gravados em `campos` no último contrato gerado. */
    resumo: ResumoContratoGerado;
    erro: string;
    enviadoEm: string;
    enviadoPor: string;
    canceladoEm: string;
    canceladoPor: string;
    cancelamentoMotivo: string;
    zapsign: {
      /** `zapsign_documentos.id` (para baixar o PDF assinado guardado). */
      documentoId: string;
      status: string;
      /** Link do CONTRATANTE (responsável financeiro). */
      signUrl: string;
      assinadoEm: string;
      signatarios: SignatarioContratoStatus[];
      /** Preenchido quando a captura do PDF assinado falhou e ainda não há cópia. */
      arquivoErro: string | null;
    } | null;
  } | null;
}

export interface ContratosPendentesResult {
  unidade: string;
  itens: ContratoPendente[];
  producaoConfigurada: boolean;
  webhookProducaoRegistrado: boolean;
  error?: string;
}

interface EnvioRow {
  unidade: string;
  aluno_id: string;
  ano_letivo: number;
  enviada_em: string;
}

interface MatriculaRow {
  aluno_id: string;
  aluno_nome: string;
  serie: string;
  valor: number;
  parcelas: number;
  primeiro_vencimento: string;
  ano_letivo: number;
}

interface EscolhaRow {
  aluno_id: string;
  valor_anual: number;
  parcelas: number;
  ano_letivo: number;
}

interface ContratoRow {
  id: string;
  unidade: string;
  aluno_id: string;
  ano_letivo: number;
  numero_contrato: string;
  status: StatusContratoMatricula;
  responsavel_nome: string;
  responsavel_email: string;
  campos: Partial<CamposContrato> | null;
  erro: string;
  enviado_em: string | null;
  enviado_por_nome: string;
  zapsign_documento_id: string | null;
  cancelado_em: string | null;
  cancelado_por_nome: string;
  cancelamento_motivo: string;
}

interface DocRow {
  id: string;
  status: string;
  assinado_em: string | null;
  signatarios: SignatarioPersistido[] | null;
  arquivo_assinado_path: string | null;
  arquivo_assinado_erro: string | null;
}

export function signatariosDoDocumento(
  signatarios: SignatarioPersistido[] | null | undefined,
): SignatarioContratoStatus[] {
  return (signatarios ?? []).map((s, i) => ({
    papel: s.papel ?? (i === 0 ? "CONTRATANTE" : `Signatário ${i + 1}`),
    nome: s.nome,
    email: s.email,
    status: s.status,
    signUrl: s.sign_url ?? "",
    assinadoEm: s.signed_at ?? "",
  }));
}

function linkContratante(signatarios: SignatarioPersistido[] | null | undefined): string {
  const lista = signatarios ?? [];
  return (lista.find((s) => s.papel === "CONTRATANTE") ?? lista[0])?.sign_url ?? "";
}

const UnidadeSchema = z.object({ unidade: z.string().min(1) });

const MatriculaInformadaSchema = z.object({
  valor: z.number().positive(),
  parcelas: z.number().int().min(1).max(12),
  primeiroVencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
});

const GerarSchema = z.object({
  unidade: z.string().min(1),
  alunoId: z.string().trim().regex(/^\d+$/, "AlunoID inválido."),
  anoLetivo: z.number().int().min(2000).max(2100),
  // Matrícula informada pela secretaria (aba Documentos). Ausente = usar a
  // escolha gravada pelo portal de rematrícula.
  matricula: MatriculaInformadaSchema.optional(),
});

// O contrato é gerado tanto pela Rematrícula quanto pela aba Documentos: basta
// a permissão de um dos dois módulos (mesmo público, entrada por tela diferente).
async function exigirPermissaoContrato(userId: string, edicao: boolean): Promise<string> {
  const fn = (edicao ? "can_edit_module" : "can_view_module") as never;
  const [rem, doc] = await Promise.all(
    ["rematricula", "documentos"].map((modulo) =>
      supabaseAdmin.rpc(fn, { _user_id: userId, _module: modulo } as never),
    ),
  );
  if (rem.error) throw new Error(rem.error.message);
  if (doc.error) throw new Error(doc.error.message);
  if (!rem.data && !doc.data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para gerar contratos de matrícula."
        : "Você não tem permissão para ver contratos de matrícula.",
    );
  }
  return nomeDoUsuario(userId);
}

async function unidadePermitida(userId: string, unidade: string): Promise<boolean> {
  const permitidas = await allowedSponteUnidades(userId);
  return permitidas === null || permitidas.includes(unidade);
}

async function webhookProducaoRegistrado(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from(T_WEBHOOKS)
    .select("id")
    .eq("ambiente", AMBIENTE)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return Boolean(data);
}

export const listarContratosMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContratosPendentesResult> => {
    await exigirPermissaoRematricula(context.userId, false);
    const { unidade } = data;
    const base = {
      unidade,
      producaoConfigurada: zapsignConfigurado(AMBIENTE),
      webhookProducaoRegistrado: await webhookProducaoRegistrado(),
    };
    if (!(await unidadePermitida(context.userId, unidade))) {
      return { ...base, itens: [], error: "Sem permissão para esta unidade." };
    }

    const [envios, matriculas, escolhas, contratos, divergencias] = await Promise.all([
      selectAll<EnvioRow>(() =>
        supabaseAdmin
          .from("rematricula_envios" as never)
          .select("unidade, aluno_id, ano_letivo, enviada_em")
          .eq("unidade", unidade)
          .order("enviada_em", { ascending: false })
          .order("aluno_id", { ascending: true }),
      ),
      selectAll<MatriculaRow>(() =>
        supabaseAdmin
          .from("rematricula_matricula_escolhas" as never)
          .select("aluno_id, aluno_nome, serie, valor, parcelas, primeiro_vencimento, ano_letivo")
          .eq("unidade", unidade)
          .order("aluno_id", { ascending: true }),
      ),
      selectAll<EscolhaRow>(() =>
        supabaseAdmin
          .from("rematricula_escolhas" as never)
          .select("aluno_id, valor_anual, parcelas, ano_letivo")
          .eq("unidade", unidade)
          .order("aluno_id", { ascending: true }),
      ),
      selectAll<ContratoRow>(() =>
        supabaseAdmin
          .from(T_CONTRATOS)
          .select(
            "id, unidade, aluno_id, ano_letivo, numero_contrato, status, responsavel_nome, responsavel_email, campos, erro, enviado_em, enviado_por_nome, zapsign_documento_id, cancelado_em, cancelado_por_nome, cancelamento_motivo",
          )
          .eq("unidade", unidade)
          .order("aluno_id", { ascending: true }),
      ),
      divergenciasExtrasDaUnidade(unidade),
    ]);

    const docIds = contratos.map((c) => c.zapsign_documento_id).filter((d): d is string => !!d);
    const docs = new Map<string, DocRow>();
    if (docIds.length) {
      const { data: rows } = await supabaseAdmin
        .from(T_DOCS)
        .select(
          "id, status, assinado_em, signatarios, arquivo_assinado_path, arquivo_assinado_erro",
        )
        .eq("ambiente", AMBIENTE)
        .in("id", docIds);
      for (const d of (rows ?? []) as unknown as DocRow[]) docs.set(d.id, d);
    }

    // Tudo casado por aluno E ano: o envio de 2028 não herda a matrícula de 2027.
    const matPor = new Map(matriculas.map((m) => [`${m.aluno_id}|${m.ano_letivo}`, m]));
    const escPor = new Map(escolhas.map((e) => [`${e.aluno_id}|${e.ano_letivo}`, e]));
    const contratoPor = new Map(contratos.map((c) => [`${c.aluno_id}|${c.ano_letivo}`, c]));

    const base_ = unirBaseContratos(
      envios.map((e) => ({
        alunoId: e.aluno_id,
        anoLetivo: e.ano_letivo,
        enviadaEm: e.enviada_em,
      })),
      contratos.map((c) => ({ alunoId: c.aluno_id, anoLetivo: c.ano_letivo })),
    );

    const itens: ContratoPendente[] = base_.map((e) => {
      const anoLetivo = e.anoLetivo;
      const m = matPor.get(`${e.alunoId}|${anoLetivo}`);
      const esc = escPor.get(`${e.alunoId}|${anoLetivo}`);
      const c = contratoPor.get(`${e.alunoId}|${anoLetivo}`) ?? null;
      const doc = c?.zapsign_documento_id ? docs.get(c.zapsign_documento_id) : undefined;
      return {
        unidade,
        alunoId: e.alunoId,
        alunoNome: m?.aluno_nome ?? c?.campos?.NomeAluno ?? "",
        anoLetivo,
        serie: m?.serie ?? c?.campos?.CursoAtual ?? "",
        enviadaEm: e.enviadaEm ?? "",
        matricula: m
          ? {
              valor: Number(m.valor),
              parcelas: m.parcelas,
              primeiroVencimento: m.primeiro_vencimento,
            }
          : null,
        material: esc ? { valorAnual: Number(esc.valor_anual), parcelas: esc.parcelas } : null,
        divergenciasExtras: divergencias.filter(
          (d) => d.alunoId === e.alunoId && d.anoLetivo === anoLetivo,
        ),
        contrato: c
          ? {
              id: c.id,
              numero: c.numero_contrato,
              status: c.status,
              responsavelNome: c.responsavel_nome,
              responsavelEmail: c.responsavel_email,
              mensalidadeComDesconto: c.campos?.ValorMensalidadeComDesconto ?? "",
              resumo: resumoContratoGerado(c.campos),
              erro: c.erro,
              enviadoEm: c.enviado_em ?? "",
              enviadoPor: c.enviado_por_nome,
              canceladoEm: c.cancelado_em ?? "",
              canceladoPor: c.cancelado_por_nome ?? "",
              cancelamentoMotivo: c.cancelamento_motivo ?? "",
              zapsign: doc
                ? {
                    documentoId: doc.id,
                    status: doc.status,
                    signUrl: linkContratante(doc.signatarios),
                    assinadoEm: doc.assinado_em ?? "",
                    signatarios: signatariosDoDocumento(doc.signatarios),
                    arquivoErro: doc.arquivo_assinado_path ? null : doc.arquivo_assinado_erro,
                  }
                : null,
            }
          : null,
      };
    });

    return { ...base, itens };
  });

// ─── Logo da unidade (server-side) ───────────────────────────────────────────
// O jsPDF precisa das dimensões para manter a proporção; sem DOM no servidor,
// elas são lidas do cabeçalho PNG/JPEG. Outro formato é erro explícito (o
// contrato não pode sair sem a logo da unidade nem com uma logo fixa).

export function dimensoesImagem(bytes: Uint8Array): { largura: number; altura: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: assinatura de 8 bytes + IHDR (largura/altura em big-endian nos offsets 16/20).
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { largura: dv.getUint32(16), altura: dv.getUint32(20) };
  }
  // JPEG: percorre os marcadores até um SOFn (C0–CF, exceto C4/C8/CC).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marcador = bytes[i + 1];
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
        i += 2;
        continue;
      }
      const tamanho = dv.getUint16(i + 2);
      if (
        marcador >= 0xc0 &&
        marcador <= 0xcf &&
        marcador !== 0xc4 &&
        marcador !== 0xc8 &&
        marcador !== 0xcc
      ) {
        return { altura: dv.getUint16(i + 5), largura: dv.getUint16(i + 7) };
      }
      i += 2 + tamanho;
    }
  }
  return null;
}

async function carregarLogoServidor(logoPath: string | null): Promise<LogoRecibo> {
  if (!logoPath) throw new Error("A unidade não tem logo cadastrada em Dados dos Colégios.");
  const { data, error } = await supabaseAdmin.storage.from(DOCUMENTOS_BUCKET).download(logoPath);
  if (error || !data) throw new Error(`Não foi possível ler a logo da unidade: ${error?.message}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const dim = dimensoesImagem(bytes);
  if (!dim) throw new Error("A logo da unidade precisa ser PNG ou JPEG para entrar no contrato.");
  const mime = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
  return {
    dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    ...dim,
  };
}

// ─── Extras (contas a receber do Sponte) ─────────────────────────────────────
// RETRATO do momento da geração: o que o aluno tem contratado hoje no Sponte
// (Hora Extra, lanches, almoço, jantar). Um contrato já assinado NÃO é
// alterado se o responsável contratar ou cancelar um extra depois.

async function titulosDoAluno(unidade: string, alunoId: string): Promise<TituloExtras[]> {
  const r = await coletarTitulosAluno(unidade, alunoId);
  if (r.error) throw new Error(`Falha ao ler o contas a receber no Sponte: ${r.error}`);
  if (r.indisponivel) throw new Error("Integração Sponte indisponível para esta unidade.");
  return r.titulos.map((t) => ({
    contaReceberID: t.contaReceberID,
    categoria: t.categoria,
    vencimento: t.vencimento,
    valor: t.valor,
    situacao: t.situacao,
    quitada: t.quitada,
  }));
}

/** Extras, Material Pedagógico e parcelas de Mensalidade do ano letivo, numa só leitura do Sponte. */
async function extrasEMaterialDoAluno(
  unidade: string,
  alunoId: string,
  anoLetivo: number,
): Promise<{
  extras: ExtrasContrato;
  material: MaterialSponte | null;
  parcelasMensalidade: ParcelasMensalidade | null;
}> {
  const titulos = await titulosDoAluno(unidade, alunoId);
  return {
    extras: extrasDoContrato(titulos, anoLetivo),
    material: materialDoContrato(titulos, anoLetivo),
    parcelasMensalidade: parcelasMensalidadeDoAnoLetivo(titulos, anoLetivo),
  };
}

// ─── Plano do Diário (dias das refeições e horários) ─────────────────────────
// O Sponte dá o VALOR de cada extra; o Diário dá os dias da semana e o horário
// registrado, e student_routine (ano do contrato) o turno regular coberto pela
// Mensalidade. Nada aqui derruba o contrato: sem dado → plano null + motivo.

interface PlanoDiarioLido {
  plano: PlanoDiarioContrato | null;
  motivo?: string;
  avisos: string[];
}

async function planoDiarioDoAluno(
  unidade: string,
  alunoId: string,
  anoLetivo: number,
  serie: string,
  turmaSponte: string,
): Promise<PlanoDiarioLido> {
  const avisos: string[] = [];
  const { data: school } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("name", unidade)
    .maybeSingle<{ id: string }>();
  if (!school)
    return { plano: null, motivo: `Unidade "${unidade}" sem cadastro no Diário.`, avisos };

  const { data: alunos } = await supabaseAdmin
    .from("diario_students" as never)
    .select("id, name")
    .eq("school_id", school.id)
    .eq("sponte_aluno_id", alunoId)
    .returns<{ id: string; name: string }[]>();
  if (!alunos?.length) {
    return {
      plano: null,
      motivo: `Aluno ${alunoId} sem vínculo (sponte_aluno_id) no Diário de ${unidade}; EXTRAS sem dias e horários.`,
      avisos,
    };
  }
  if (alunos.length > 1) {
    return {
      plano: null,
      motivo: `Mais de um aluno do Diário vinculado ao AlunoID ${alunoId} em ${unidade}; EXTRAS sem dias e horários.`,
      avisos,
    };
  }
  const studentId = alunos[0].id;

  const [refeicoesRows, horariosRows, rotinaRows] = await Promise.all([
    selectAll<{ meal: MealKey; weekday: Weekday }>(() =>
      supabaseAdmin
        .from("diario_meal_plans" as never)
        .select("meal, weekday")
        .eq("student_id", studentId)
        .eq("ano_letivo", anoLetivo)
        .order("meal")
        .order("weekday"),
    ),
    selectAll<{ weekday: Weekday; entry: string | null; exit: string | null }>(() =>
      supabaseAdmin
        .from("diario_schedules" as never)
        .select("weekday, entry, exit")
        .eq("student_id", studentId)
        .eq("ano_letivo", anoLetivo)
        .order("weekday"),
    ),
    supabaseAdmin
      .from("student_routine" as never)
      .select("horario_curricular, origem")
      .eq("unidade", unidade)
      .eq("sponte_aluno_id", Number(alunoId))
      .eq("ano_letivo", anoLetivo)
      .order("updated_at", { ascending: false })
      .returns<{ horario_curricular: string | null; origem: string }[]>()
      .then((r) => r.data ?? []),
  ]);

  const refeicoes: Record<MealKey, Weekday[]> = { breakfast: [], lunch: [], snack: [], dinner: [] };
  for (const r of refeicoesRows) {
    if (r.meal in refeicoes && !refeicoes[r.meal].includes(r.weekday))
      refeicoes[r.meal].push(r.weekday);
  }
  const horarios: Partial<Record<Weekday, HorarioRegistrado>> = {};
  for (const h of horariosRows) {
    if (h.entry && h.exit) horarios[h.weekday] = { entry: h.entry, exit: h.exit };
  }
  if (refeicoesRows.length === 0 && horariosRows.length === 0) {
    return {
      plano: null,
      motivo: `Aluno sem plano no Diário para ${anoLetivo} (refeições e horários vazios); EXTRAS sem dias e horários.`,
      avisos,
    };
  }

  let turno: TurnoTurma | null = null;
  const curricular = rotinaRows.find(
    (r) => r.horario_curricular === "M" || r.horario_curricular === "T",
  );
  if (curricular) turno = curricular.horario_curricular as TurnoTurma;
  else {
    // Sem rotina do ano (ou sem turno nela): o marcador da turma atual do
    // Sponte ("07 - 1º Ano T") é a segunda melhor pista — e fica registrado.
    turno = turnoDaTurma({ nome: turmaSponte, horario: "" });
    if (turno) {
      avisos.push(
        rotinaRows.length === 0
          ? `Sem rotina (student_routine) do aluno para ${anoLetivo}; turno regular "${turno}" deduzido pela turma do Sponte (${turmaSponte}).`
          : `Rotina de ${anoLetivo} sem horário curricular; turno regular "${turno}" deduzido pela turma do Sponte (${turmaSponte}).`,
      );
    }
  }
  const padrao = HORARIOS_PADRAO[segmentoDaSerie(serie)];
  const turnoRegular = turno === "M" ? padrao.manha : turno === "T" ? padrao.tarde : null;

  return { plano: { refeicoes, horarios, turnoRegular }, avisos };
}

async function colegioDaUnidade(unidade: string): Promise<ColegioRow> {
  const { data } = await supabaseAdmin
    .from("documentos_colegios" as never)
    .select("*")
    .eq("unidade", unidade)
    .maybeSingle<ColegioRow>();
  if (!data) throw new Error(`Dados dos Colégios não cadastrados para ${unidade}.`);
  return data;
}

interface TestemunhaRow {
  nome: string;
  cpf: string;
  email: string;
  celular: string;
}

/** As testemunhas ATIVAS da unidade do contrato, na ordem em que assinam. */
async function testemunhasAtivas(unidade: string): Promise<TestemunhaContrato[]> {
  const { data, error } = await supabaseAdmin
    .from("contrato_testemunhas" as never)
    .select("nome, cpf, email, celular")
    .eq("unidade", unidade)
    .eq("ativa", true)
    .order("ordem", { ascending: true });
  if (error) throw new Error(`Falha ao ler as testemunhas do contrato: ${error.message}`);
  return ((data ?? []) as unknown as TestemunhaRow[]).map((t) => ({
    nome: t.nome ?? "",
    cpf: t.cpf ?? "",
    email: t.email ?? "",
    celular: t.celular ?? "",
  }));
}

async function gravarContrato(
  chave: { unidade: string; alunoId: string; anoLetivo: number },
  valores: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from(T_CONTRATOS)
    .upsert(
      {
        unidade: chave.unidade,
        aluno_id: chave.alunoId,
        ano_letivo: chave.anoLetivo,
        updated_at: new Date().toISOString(),
        ...valores,
      } as never,
      { onConflict: "unidade,aluno_id,ano_letivo" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Falha ao gravar o contrato: ${error.message}`);
  return data.id;
}

interface PdfContratoMontado {
  pdfBase64: string;
  contrato: ReturnType<typeof montarContratoMatricula>;
  input: MontarContratoInput;
  fin: Awaited<ReturnType<typeof buscarResponsaveisComFinanceiro>>[number];
  signatarios: SignatarioContrato[];
  /** Divergências Sponte × Diário nos EXTRAS — informativas, não bloqueiam. */
  avisos: string[];
}

/**
 * Lê Sponte + escolhas do portal, valida e renderiza o PDF do contrato.
 * Não grava nada nem fala com a ZapSign — serve tanto para a prévia quanto
 * para o envio real.
 */
export async function montarPdfContrato(
  unidade: string,
  alunoId: string,
  anoLetivo: number,
  numero: string,
  matriculaInformada?: MatriculaContrato,
): Promise<PdfContratoMontado> {
  const hoje = hojeBRT();
  const [matricula, aluno, colegio, testemunhas] = await Promise.all([
    supabaseAdmin
      .from("rematricula_matricula_escolhas" as never)
      .select("aluno_nome, serie, valor, parcelas, primeiro_vencimento")
      .eq("unidade", unidade)
      .eq("aluno_id", alunoId)
      .eq("ano_letivo", anoLetivo)
      .maybeSingle<Omit<MatriculaRow, "aluno_id" | "ano_letivo">>(),
    buscarAlunoPorId(unidade, alunoId),
    colegioDaUnidade(unidade),
    testemunhasAtivas(unidade),
  ]);
  if (!matricula.data && !matriculaInformada) {
    throw new Error("Matrícula não encontrada para este aluno.");
  }
  if (!aluno) throw new Error("Não foi possível ler o aluno no Sponte.");

  // Respeita a troca de responsável financeiro feita no portal de rematrícula.
  // Com a matrícula informada (aba Documentos) a série vem do Sponte; pelo
  // portal continua a série escolhida na rematrícula.
  const serie = matriculaInformada
    ? aluno.serie || (matricula.data?.serie ?? "")
    : matricula.data!.serie;
  const [responsaveis, mensalidade, sponte, logo, planoDiario] = await Promise.all([
    buscarResponsaveisComFinanceiro(unidade, alunoId, anoLetivo),
    buscarMensalidadeVigente(unidade, alunoId, anoLetivo),
    extrasEMaterialDoAluno(unidade, alunoId, anoLetivo),
    carregarLogoServidor(colegio.logo_path),
    planoDiarioDoAluno(unidade, alunoId, anoLetivo, serie, aluno.turma).catch(
      (e: unknown): PlanoDiarioLido => ({
        plano: null,
        motivo: `Falha ao ler o plano do Diário: ${e instanceof Error ? e.message : String(e)}`,
        avisos: [],
      }),
    ),
  ]);
  const extrasSponte = sponte.extras;
  const materialSponte = sponte.material;
  const parcelasMensalidade = sponte.parcelasMensalidade;
  const avisosMensalidade =
    parcelasMensalidade && parcelasMensalidade.lacunas.length
      ? [
          `Mensalidades de ${anoLetivo} no Sponte com lacuna em ${parcelasMensalidade.lacunas.join(", ")}: o contrato saiu com ${parcelasMensalidade.totalParcelas} parcelas, ${periodoParcelasMensalidade(parcelasMensalidade.primeiroMesExtenso, parcelasMensalidade.ultimoMesExtenso)}. Confira o carnê antes de enviar.`,
        ]
      : [];
  const extras = detalharExtrasContrato(
    {
      ...extrasSponte,
      avisos: [...extrasSponte.avisos, ...planoDiario.avisos, ...avisosMensalidade],
    },
    planoDiario.plano,
    planoDiario.motivo,
  );
  const fin = responsaveis.find((r) => r.financeiro);
  if (!fin) throw new Error("Responsável financeiro não encontrado no Sponte.");
  if (!emailValido(fin.email)) {
    throw new Error("O responsável financeiro não tem email válido no Sponte.");
  }
  if (!mensalidade || !parcelasMensalidade) {
    throw new Error(`Nenhuma mensalidade de ${anoLetivo} encontrada no Sponte para este aluno.`);
  }

  const dadosMatricula: MatriculaContrato = matriculaInformada ?? {
    valor: Number(matricula.data!.valor),
    parcelas: matricula.data!.parcelas,
    primeiroVencimento: matricula.data!.primeiro_vencimento,
  };
  const itensMaterial = materialSponte ? await itensMaterialDaSerie(unidade, serie, anoLetivo) : [];
  const input: MontarContratoInput = {
    numeroContrato: numero,
    anoLetivo,
    colegio: {
      unidade,
      razaoSocial: colegio.razao_social,
      nomeFantasia: colegio.nome_fantasia,
      cnpj: colegio.cnpj,
      endereco: colegio.endereco,
      numero: colegio.numero,
      complemento: colegio.complemento,
      bairro: colegio.bairro,
      cidade: colegio.cidade,
      uf: colegio.uf,
      cep: colegio.cep,
      email: colegio.email,
      representanteNome: colegio.representante_nome ?? "",
      representanteCpf: colegio.representante_cpf ?? "",
      representanteEmail: colegio.representante_email ?? "",
      representanteCelular: colegio.representante_celular ?? "",
    },
    responsavel: {
      nome: fin.nome,
      cpf: fin.cpf,
      email: fin.email,
      telefone: fin.telefone,
      endereco: fin.endereco,
      numero: fin.numero,
      complemento: fin.complemento,
      bairro: fin.bairro,
      cidade: fin.cidade,
      uf: fin.uf,
      cep: fin.cep,
    },
    alunoNome: aluno.nome || (matricula.data?.aluno_nome ?? ""),
    serie,
    matricula: dadosMatricula,
    mensalidade: {
      valor: mensalidade.valor,
      descontoPercentual: mensalidade.descontoPercentual,
      vencimento: mensalidade.vencimento,
      totalParcelas: parcelasMensalidade.totalParcelas,
      primeiroMes: parcelasMensalidade.primeiroMesExtenso,
      ultimoMes: parcelasMensalidade.ultimoMesExtenso,
    },
    material: materialSponte ? { itens: itensMaterial, ...materialSponte } : null,
    extras,
    testemunhas,
    hojeISO: hoje,
  };

  const pendencias = validarContrato(input);
  if (pendencias.length) throw new Error(`Faltam dados para o contrato: ${pendencias.join("; ")}.`);
  const signatarios = signatariosContrato(input);
  const semEmailValido = signatarios.find((s) => !emailValido(s.email));
  if (semEmailValido) {
    throw new Error(
      `E-mail inválido para assinatura: ${semEmailValido.papel} (${semEmailValido.nome}): "${semEmailValido.email}".`,
    );
  }

  const contrato = montarContratoMatricula(input);
  const colegioRecibo = paraColegioRecibo(colegio);
  const pdf = await gerarPdfContratoMatricula(
    contrato,
    {
      colegio: colegioRecibo,
      enderecoColegio: enderecoLinha(colegioRecibo),
      contatoColegio: [colegio.telefone, colegio.email].filter(Boolean).join(" · "),
    },
    logo,
  );
  const pdfBase64 = pdfParaBase64(pdf);
  if (extras.avisos.length)
    console.warn(`${LOG_TAG} ${numero} EXTRAS: ${extras.avisos.join(" | ")}`);
  return { pdfBase64, contrato, input, fin, signatarios, avisos: extras.avisos };
}

const DadosSchema = z.object({
  unidade: z.string().min(1),
  alunoId: z.string().trim().regex(/^\d+$/, "AlunoID inválido."),
  anoLetivo: z.number().int().min(2000).max(2100),
});

export interface DadosContratoDocumentos {
  ok: boolean;
  erro?: string;
  alunoNome: string;
  serie: string;
  /** Valor integral da tabela do ano para a série; null = não cadastrado. */
  valorTabela: number | null;
  /** false quando nenhum segmento tem valor cadastrado para o ano. */
  tabelaConfigurada: boolean;
  /** Matrícula gravada pelo portal de rematrícula, se houver. */
  matriculaRematricula: MatriculaContrato | null;
  contrato: {
    numero: string;
    status: StatusContratoMatricula;
    enviadoEm: string | null;
    signatarios: SignatarioContratoStatus[];
  } | null;
}

/** Dados que a aba Documentos precisa antes de gerar o Contrato de Matrícula. */
export const dadosContratoDocumentos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DadosSchema.parse(input))
  .handler(async ({ data, context }): Promise<DadosContratoDocumentos> => {
    await exigirPermissaoContrato(context.userId, false);
    const { unidade, alunoId, anoLetivo } = data;
    const vazio: DadosContratoDocumentos = {
      ok: false,
      alunoNome: "",
      serie: "",
      valorTabela: null,
      tabelaConfigurada: false,
      matriculaRematricula: null,
      contrato: null,
    };
    if (!(await unidadePermitida(context.userId, unidade))) {
      return { ...vazio, erro: "Sem permissão para esta unidade." };
    }
    const [aluno, valores, matricula, contrato] = await Promise.all([
      buscarAlunoPorId(unidade, alunoId),
      valoresMatriculaDoAno(anoLetivo),
      supabaseAdmin
        .from("rematricula_matricula_escolhas" as never)
        .select("aluno_nome, serie, valor, parcelas, primeiro_vencimento")
        .eq("unidade", unidade)
        .eq("aluno_id", alunoId)
        .eq("ano_letivo", anoLetivo)
        .maybeSingle<Omit<MatriculaRow, "aluno_id" | "ano_letivo">>(),
      supabaseAdmin
        .from(T_CONTRATOS)
        .select("numero_contrato, status, enviado_em, zapsign_documento_id")
        .eq("unidade", unidade)
        .eq("aluno_id", alunoId)
        .eq("ano_letivo", anoLetivo)
        .maybeSingle<{
          numero_contrato: string;
          status: StatusContratoMatricula;
          enviado_em: string | null;
          zapsign_documento_id: string | null;
        }>(),
    ]);
    if (!aluno) return { ...vazio, erro: "Não foi possível ler o aluno no Sponte." };

    let signatarios: SignatarioContratoStatus[] = [];
    if (contrato.data?.zapsign_documento_id) {
      const { data: doc } = await supabaseAdmin
        .from(T_DOCS)
        .select("signatarios")
        .eq("id", contrato.data.zapsign_documento_id)
        .maybeSingle<{ signatarios: SignatarioPersistido[] | null }>();
      signatarios = signatariosDoDocumento(doc?.signatarios);
    }
    const m = matricula.data;
    return {
      ok: true,
      alunoNome: aluno.nome,
      serie: aluno.serie,
      valorTabela: aluno.serie ? valorMatricula(valores, aluno.serie) : null,
      tabelaConfigurada: Object.keys(valores).length > 0,
      matriculaRematricula: m
        ? {
            valor: Number(m.valor),
            parcelas: m.parcelas,
            primeiroVencimento: m.primeiro_vencimento,
          }
        : null,
      contrato: contrato.data
        ? {
            numero: contrato.data.numero_contrato,
            status: contrato.data.status,
            enviadoEm: contrato.data.enviado_em,
            signatarios,
          }
        : null,
    };
  });

export interface PreviaContratoResult {
  ok: boolean;
  erro?: string;
  numero?: string;
  nomeArquivo?: string;
  pdfBase64?: string;
  /** Divergências Sponte × Diário nos EXTRAS (o PDF saiu mesmo assim). */
  avisos?: string[];
}

export const previaContratoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GerarSchema.parse(input))
  .handler(async ({ data, context }): Promise<PreviaContratoResult> => {
    await exigirPermissaoContrato(context.userId, false);
    const { unidade, alunoId, anoLetivo, matricula } = data;
    if (!(await unidadePermitida(context.userId, unidade))) {
      return { ok: false, erro: "Sem permissão para esta unidade." };
    }
    const numero = numeroContrato(unidade, alunoId, anoLetivo);
    try {
      const { pdfBase64, input, avisos } = await montarPdfContrato(
        unidade,
        alunoId,
        anoLetivo,
        numero,
        matricula,
      );
      return {
        ok: true,
        numero,
        nomeArquivo: `PREVIA Contrato de Matrícula ${anoLetivo} - ${input.alunoNome} (${unidade}).pdf`,
        pdfBase64,
        avisos,
      };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "Falha desconhecida.", numero };
    }
  });

export interface GerarContratoResult {
  ok: boolean;
  erro?: string;
  numero?: string;
  /** Link do CONTRATANTE (responsável financeiro). */
  signUrl?: string;
  signatarios?: SignatarioContratoStatus[];
  /** Divergências Sponte × Diário nos EXTRAS (o contrato foi enviado mesmo assim). */
  avisos?: string[];
}

export const gerarEnviarContratoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GerarSchema.parse(input))
  .handler(async ({ data, context }): Promise<GerarContratoResult> => {
    const nomeUsuario = await exigirPermissaoContrato(context.userId, true);
    const { unidade, alunoId, anoLetivo, matricula } = data;
    if (!(await unidadePermitida(context.userId, unidade))) {
      return { ok: false, erro: "Sem permissão para esta unidade." };
    }
    if (!zapsignConfigurado(AMBIENTE)) {
      return { ok: false, erro: "ZAPSIGN_PROD_TOKEN não configurada no servidor." };
    }

    const { data: existente } = await supabaseAdmin
      .from(T_CONTRATOS)
      .select("status, numero_contrato")
      .eq("unidade", unidade)
      .eq("aluno_id", alunoId)
      .eq("ano_letivo", anoLetivo)
      .maybeSingle<{ status: string; numero_contrato: string }>();
    if (existente?.status === "enviado") {
      return { ok: false, erro: `Contrato ${existente.numero_contrato} já foi enviado.` };
    }

    const chave = { unidade, alunoId, anoLetivo };
    const numero = numeroContrato(unidade, alunoId, anoLetivo);
    // Um contrato cancelado libera a geração de outro: a linha volta ao estado
    // inicial (o documento recusado permanece em zapsign_documentos).
    await gravarContrato(chave, {
      numero_contrato: numero,
      status: "gerando",
      erro: "",
      zapsign_documento_id: null,
      cancelado_em: null,
      cancelado_por: null,
      cancelado_por_nome: "",
      cancelamento_motivo: "",
    });

    try {
      const { pdfBase64, contrato, input, fin, signatarios, avisos } = await montarPdfContrato(
        unidade,
        alunoId,
        anoLetivo,
        numero,
        matricula,
      );

      const nomeDoc = `Contrato de Matrícula ${anoLetivo} - ${input.alunoNome} (${unidade})`;
      const r = await criarDocumentoPdf({
        ambiente: AMBIENTE,
        nome: nomeDoc,
        pdfBase64,
        signatarios: signatarios.map((s) => ({
          nome: s.nome,
          email: s.email,
          telefone: s.telefone,
          cpf: s.cpf,
        })),
        externalId: `contrato-matricula:${numero}`,
        ordemSequencial: false,
        enviarEmailAoSignatario: true,
      });
      if (!r.ok) throw new Error(`ZapSign (produção) recusou o documento: ${r.erro}`);

      const agora = new Date().toISOString();
      const { data: doc, error: erroDoc } = await supabaseAdmin
        .from(T_DOCS)
        .insert({
          ambiente: AMBIENTE,
          poc: false,
          origem: "pdf",
          nome: nomeDoc,
          unidade,
          zapsign_token: r.dados.token,
          zapsign_open_id: r.dados.open_id ?? null,
          external_id: `contrato-matricula:${numero}`,
          status: r.dados.status,
          // A ZapSign devolve os signers na ordem enviada; o papel/CPF vêm do
          // que montamos (a API não os devolve).
          signatarios: (r.dados.signers ?? []).map((s, i) =>
            signatarioDoSigner(s, signatarios[i]?.cpf ?? "", signatarios[i]?.papel),
          ),
          enviado_em: agora,
          resposta_criacao: r.dados,
          created_by: context.userId,
          created_by_nome: nomeUsuario,
        } as never)
        .select("id, signatarios")
        .single<{ id: string; signatarios: SignatarioPersistido[] }>();
      if (erroDoc) {
        throw new Error(
          `Documento criado na ZapSign (${r.dados.token}) mas falhou ao gravar localmente: ${erroDoc.message}`,
        );
      }

      await gravarContrato(chave, {
        numero_contrato: numero,
        aluno_nome: input.alunoNome,
        responsavel_nome: fin.nome,
        responsavel_cpf: fin.cpf,
        responsavel_email: fin.email,
        status: "enviado",
        zapsign_documento_id: doc.id,
        campos: contrato.campos,
        erro: "",
        enviado_em: agora,
        enviado_por: context.userId,
        enviado_por_nome: nomeUsuario,
      });
      return {
        ok: true,
        numero,
        signUrl: linkContratante(doc.signatarios),
        signatarios: signatariosDoDocumento(doc.signatarios),
        avisos,
      };
    } catch (e) {
      const erro = e instanceof Error ? e.message : "Falha desconhecida.";
      console.error(`${LOG_TAG} ${numero}: ${erro}`);
      await gravarContrato(chave, { numero_contrato: numero, status: "erro", erro }).catch(
        () => {},
      );
      return { ok: false, erro, numero };
    }
  });

const CancelarSchema = z.object({
  contratoId: z.string().uuid(),
  motivo: z.string(),
  notificarSignatarios: z.boolean(),
});

export interface CancelarContratoResult {
  ok: boolean;
  erro?: string;
  numero?: string;
}

/**
 * Cancela o documento na ZapSign (`POST /refuse/`, irreversível) e reflete o
 * cancelamento em zapsign_documentos e contratos_matricula. Nunca usa o
 * DELETE da API (soft delete que deixa o link de assinatura ativo).
 */
export const cancelarContratoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CancelarSchema.parse(input))
  .handler(async ({ data, context }): Promise<CancelarContratoResult> => {
    const nomeUsuario = await exigirPermissaoRematricula(context.userId, true);
    const erroMotivo = validarMotivoCancelamento(data.motivo);
    if (erroMotivo) return { ok: false, erro: erroMotivo };

    const { data: contrato } = await supabaseAdmin
      .from(T_CONTRATOS)
      .select("id, unidade, numero_contrato, status, zapsign_documento_id")
      .eq("id", data.contratoId)
      .maybeSingle<{
        id: string;
        unidade: string;
        numero_contrato: string;
        status: string;
        zapsign_documento_id: string | null;
      }>();
    if (!contrato) return { ok: false, erro: "Contrato não encontrado." };
    if (!(await unidadePermitida(context.userId, contrato.unidade))) {
      return { ok: false, erro: "Sem permissão para esta unidade." };
    }
    if (!contrato.zapsign_documento_id) {
      return { ok: false, erro: "Este contrato não tem documento na ZapSign." };
    }

    const { data: doc } = await supabaseAdmin
      .from(T_DOCS)
      .select("id, zapsign_token, status, ambiente")
      .eq("id", contrato.zapsign_documento_id)
      .eq("ambiente", AMBIENTE)
      .maybeSingle<{ id: string; zapsign_token: string; status: string; ambiente: string }>();
    if (!doc) return { ok: false, erro: "Documento da ZapSign não encontrado localmente." };
    if (!contratoCancelavel(contrato.status, doc.status)) {
      return {
        ok: false,
        erro: `Contrato ${contrato.numero_contrato} não pode ser cancelado (status ${contrato.status} / ZapSign ${doc.status}).`,
        numero: contrato.numero_contrato,
      };
    }

    const motivo = data.motivo.trim();
    const r = await recusarDocumento({
      ambiente: AMBIENTE,
      docToken: doc.zapsign_token,
      motivo,
      notificarSignatarios: data.notificarSignatarios,
    });
    if (!r.ok) {
      console.error(`${LOG_TAG} cancelar ${contrato.numero_contrato}: ${r.erro}`);
      return {
        ok: false,
        erro: `ZapSign recusou o cancelamento: ${r.erro}`,
        numero: contrato.numero_contrato,
      };
    }

    const agora = new Date().toISOString();
    await supabaseAdmin
      .from(T_CONTRATOS)
      .update({
        status: "cancelado",
        cancelado_em: agora,
        cancelado_por: context.userId,
        cancelado_por_nome: nomeUsuario,
        cancelamento_motivo: motivo,
        updated_at: agora,
      } as never)
      .eq("id", contrato.id);
    await supabaseAdmin
      .from(T_DOCS)
      .update({ recusa_motivo: motivo, recusado_por_nome: nomeUsuario } as never)
      .eq("id", doc.id);

    // A resposta do /refuse/ pode não trazer o documento completo; o status
    // local é forçado para "refused" e o webhook doc_refused confirma depois.
    const status =
      r.dados && typeof r.dados.status === "string" && r.dados.status ? r.dados.status : "refused";
    await aplicarEstadoDocumento(
      doc.zapsign_token,
      {
        ...(r.dados ?? {}),
        token: doc.zapsign_token,
        status,
        signers: Array.isArray(r.dados?.signers) ? r.dados.signers : [],
        last_update_at: agora,
      } as Parameters<typeof aplicarEstadoDocumento>[1],
      AMBIENTE,
    );

    await supabaseAdmin
      .from(T_EVENTOS)
      .insert({
        documento_id: doc.id,
        zapsign_token: doc.zapsign_token,
        event_type: `school_hub_${EVENTO_DOC_RECUSADO}`,
        status_documento: status,
        sandbox: false,
        payload: {
          origem: "school-hub",
          usuario: nomeUsuario,
          motivo,
          notificar_signatarios: data.notificarSignatarios,
          resposta: r.dados ?? null,
        },
        payload_hash: `school-hub:${doc.id}:${agora}`,
      } as never)
      .then(({ error }) => {
        if (error) console.error(`${LOG_TAG} evento de cancelamento: ${error.message}`);
      });

    return { ok: true, numero: contrato.numero_contrato };
  });

export interface RegistrarWebhookProducaoResult {
  ok: boolean;
  jaExistia?: boolean;
  erro?: string;
}

// Registra na conta ZapSign de PRODUÇÃO o callback para a mesma rota do
// sandbox; o header leva o segredo derivado do token de produção.
export const registrarWebhookContratos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RegistrarWebhookProducaoResult> => {
    const nomeUsuario = await exigirPermissaoRematricula(context.userId, true);
    if (await webhookProducaoRegistrado()) return { ok: true, jaExistia: true };
    const url = `${BASE_URL_PORTAL}/api/zapsign/webhook`;
    const r = await criarWebhook(url, AMBIENTE);
    if (!r.ok) return { ok: false, erro: r.erro };
    const { error } = await supabaseAdmin.from(T_WEBHOOKS).insert({
      ambiente: AMBIENTE,
      zapsign_id: r.dados.id,
      url,
      tipo: r.dados.type ?? "doc_signed",
      resposta: r.dados,
      created_by_nome: nomeUsuario,
    } as never);
    if (error) return { ok: false, erro: error.message };
    return { ok: true };
  });
