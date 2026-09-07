// Contrato de Matrícula/Rematrícula — geração MANUAL pela secretaria.
//
// A tela lista as matrículas finalizadas no portal (rematricula_envios) que
// ainda não têm contrato enviado. "Gerar e enviar contrato" executa, nesta
// ordem e abortando no primeiro erro:
//   1. autorização (permissão de edição em Rematrícula + unidade permitida);
//   2. dados persistidos da matrícula (parcelamento) e do material escolhido;
//   3. dados ATUAIS do aluno, do responsável financeiro, da mensalidade vigente
//      e dos extras (contas a receber) no Sponte da unidade do aluno;
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
  montarContratoMatricula,
  numeroContrato,
  signatariosContrato,
  validarContrato,
  type CamposContrato,
  type ExtrasContrato,
  type MontarContratoInput,
  type SignatarioContrato,
  type TestemunhaContrato,
} from "@/lib/contrato-matricula";
import { gerarPdfContratoMatricula } from "@/lib/contrato-matricula-pdf";
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
} from "@/lib/rematricula.functions";
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
    erro: string;
    enviadoEm: string;
    enviadoPor: string;
    canceladoEm: string;
    canceladoPor: string;
    cancelamentoMotivo: string;
    zapsign: {
      status: string;
      /** Link do CONTRATANTE (responsável financeiro). */
      signUrl: string;
      assinadoEm: string;
      signatarios: SignatarioContratoStatus[];
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

const GerarSchema = z.object({
  unidade: z.string().min(1),
  alunoId: z.string().trim().regex(/^\d+$/, "AlunoID inválido."),
  anoLetivo: z.number().int().min(2000).max(2100),
});

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
        .select("id, status, assinado_em, signatarios")
        .eq("ambiente", AMBIENTE)
        .in("id", docIds);
      for (const d of (rows ?? []) as unknown as DocRow[]) docs.set(d.id, d);
    }

    // Tudo casado por aluno E ano: o envio de 2028 não herda a matrícula de 2027.
    const matPor = new Map(matriculas.map((m) => [`${m.aluno_id}|${m.ano_letivo}`, m]));
    const escPor = new Map(escolhas.map((e) => [`${e.aluno_id}|${e.ano_letivo}`, e]));
    const contratoPor = new Map(contratos.map((c) => [`${c.aluno_id}|${c.ano_letivo}`, c]));

    const itens: ContratoPendente[] = envios.map((e) => {
      const anoLetivo = e.ano_letivo;
      const m = matPor.get(`${e.aluno_id}|${anoLetivo}`);
      const esc = escPor.get(`${e.aluno_id}|${anoLetivo}`);
      const c = contratoPor.get(`${e.aluno_id}|${anoLetivo}`) ?? null;
      const doc = c?.zapsign_documento_id ? docs.get(c.zapsign_documento_id) : undefined;
      return {
        unidade,
        alunoId: e.aluno_id,
        alunoNome: m?.aluno_nome ?? "",
        anoLetivo,
        serie: m?.serie ?? "",
        enviadaEm: e.enviada_em,
        matricula: m
          ? {
              valor: Number(m.valor),
              parcelas: m.parcelas,
              primeiroVencimento: m.primeiro_vencimento,
            }
          : null,
        material: esc ? { valorAnual: Number(esc.valor_anual), parcelas: esc.parcelas } : null,
        divergenciasExtras: divergencias.filter(
          (d) => d.alunoId === e.aluno_id && d.anoLetivo === anoLetivo,
        ),
        contrato: c
          ? {
              id: c.id,
              numero: c.numero_contrato,
              status: c.status,
              responsavelNome: c.responsavel_nome,
              responsavelEmail: c.responsavel_email,
              mensalidadeComDesconto: c.campos?.ValorMensalidadeComDesconto ?? "",
              erro: c.erro,
              enviadoEm: c.enviado_em ?? "",
              enviadoPor: c.enviado_por_nome,
              canceladoEm: c.cancelado_em ?? "",
              canceladoPor: c.cancelado_por_nome ?? "",
              cancelamentoMotivo: c.cancelamento_motivo ?? "",
              zapsign: doc
                ? {
                    status: doc.status,
                    signUrl: linkContratante(doc.signatarios),
                    assinadoEm: doc.assinado_em ?? "",
                    signatarios: signatariosDoDocumento(doc.signatarios),
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

async function extrasDoAluno(
  unidade: string,
  alunoId: string,
  anoLetivo: number,
): Promise<ExtrasContrato> {
  const r = await coletarTitulosAluno(unidade, alunoId);
  if (r.error) throw new Error(`Falha ao ler o contas a receber no Sponte: ${r.error}`);
  if (r.indisponivel) throw new Error("Integração Sponte indisponível para esta unidade.");
  return extrasDoContrato(
    r.titulos.map((t) => ({
      categoria: t.categoria,
      vencimento: t.vencimento,
      valor: t.valor,
      situacao: t.situacao,
      quitada: t.quitada,
    })),
    anoLetivo,
  );
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

/** As testemunhas ATIVAS do cadastro global, na ordem em que assinam. */
async function testemunhasAtivas(): Promise<TestemunhaContrato[]> {
  const { data, error } = await supabaseAdmin
    .from("contrato_testemunhas" as never)
    .select("nome, cpf, email, celular")
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
}

/**
 * Lê Sponte + escolhas do portal, valida e renderiza o PDF do contrato.
 * Não grava nada nem fala com a ZapSign — serve tanto para a prévia quanto
 * para o envio real.
 */
async function montarPdfContrato(
  unidade: string,
  alunoId: string,
  anoLetivo: number,
  numero: string,
): Promise<PdfContratoMontado> {
  const hoje = hojeBRT();
  const [matricula, escolha, aluno, colegio, testemunhas] = await Promise.all([
    supabaseAdmin
      .from("rematricula_matricula_escolhas" as never)
      .select("aluno_nome, serie, valor, parcelas, primeiro_vencimento")
      .eq("unidade", unidade)
      .eq("aluno_id", alunoId)
      .eq("ano_letivo", anoLetivo)
      .maybeSingle<Omit<MatriculaRow, "aluno_id" | "ano_letivo">>(),
    supabaseAdmin
      .from("rematricula_escolhas" as never)
      .select("valor_anual, parcelas")
      .eq("unidade", unidade)
      .eq("aluno_id", alunoId)
      .eq("ano_letivo", anoLetivo)
      .maybeSingle<Omit<EscolhaRow, "aluno_id" | "ano_letivo">>(),
    buscarAlunoPorId(unidade, alunoId),
    colegioDaUnidade(unidade),
    testemunhasAtivas(),
  ]);
  if (!matricula.data) throw new Error("Matrícula não encontrada para este aluno.");
  if (!aluno) throw new Error("Não foi possível ler o aluno no Sponte.");

  // Respeita a troca de responsável financeiro feita no portal de rematrícula.
  const [responsaveis, mensalidade, extras, logo] = await Promise.all([
    buscarResponsaveisComFinanceiro(unidade, alunoId, anoLetivo),
    buscarMensalidadeVigente(unidade, alunoId, anoLetivo),
    extrasDoAluno(unidade, alunoId, anoLetivo),
    carregarLogoServidor(colegio.logo_path),
  ]);
  const fin = responsaveis.find((r) => r.financeiro);
  if (!fin) throw new Error("Responsável financeiro não encontrado no Sponte.");
  if (!emailValido(fin.email)) {
    throw new Error("O responsável financeiro não tem email válido no Sponte.");
  }
  if (!mensalidade) {
    throw new Error(`Nenhuma mensalidade de ${anoLetivo} encontrada no Sponte para este aluno.`);
  }

  const serie = matricula.data.serie;
  const itensMaterial = escolha.data ? await itensMaterialDaSerie(unidade, serie, anoLetivo) : [];
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
    alunoNome: aluno.nome || matricula.data.aluno_nome,
    serie,
    matricula: {
      valor: Number(matricula.data.valor),
      parcelas: matricula.data.parcelas,
      primeiroVencimento: matricula.data.primeiro_vencimento,
    },
    mensalidade: {
      valor: mensalidade.valor,
      descontoPercentual: mensalidade.descontoPercentual,
      vencimento: mensalidade.vencimento,
    },
    material: escolha.data
      ? {
          itens: itensMaterial,
          valorTotal: Number(escolha.data.valor_anual),
          parcelas: escolha.data.parcelas,
        }
      : null,
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
  return { pdfBase64, contrato, input, fin, signatarios };
}

export interface PreviaContratoResult {
  ok: boolean;
  erro?: string;
  numero?: string;
  nomeArquivo?: string;
  pdfBase64?: string;
}

export const previaContratoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GerarSchema.parse(input))
  .handler(async ({ data, context }): Promise<PreviaContratoResult> => {
    await exigirPermissaoRematricula(context.userId, false);
    const { unidade, alunoId, anoLetivo } = data;
    if (!(await unidadePermitida(context.userId, unidade))) {
      return { ok: false, erro: "Sem permissão para esta unidade." };
    }
    const numero = numeroContrato(unidade, alunoId, anoLetivo);
    try {
      const { pdfBase64, input } = await montarPdfContrato(unidade, alunoId, anoLetivo, numero);
      return {
        ok: true,
        numero,
        nomeArquivo: `PREVIA Contrato de Matrícula ${anoLetivo} - ${input.alunoNome} (${unidade}).pdf`,
        pdfBase64,
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
}

export const gerarEnviarContratoMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GerarSchema.parse(input))
  .handler(async ({ data, context }): Promise<GerarContratoResult> => {
    const nomeUsuario = await exigirPermissaoRematricula(context.userId, true);
    const { unidade, alunoId, anoLetivo } = data;
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
      const { pdfBase64, contrato, input, fin, signatarios } = await montarPdfContrato(
        unidade,
        alunoId,
        anoLetivo,
        numero,
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
