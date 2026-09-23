// Server functions da aba ZapSign de Documentos (documento avulso via PDF ou
// modelo DOCX, webhook e acompanhamento). Todas exigem sessão autenticada e
// permissão de edição no módulo Documentos. O ambiente ("producao" | "sandbox")
// é sempre explícito na entrada e é repassado ao cliente da ZapSign: nunca há
// fallback de um token para o outro. Em produção os documentos têm validade
// jurídica e consomem crédito real da ZapSign.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  criarDocumentoPdf,
  criarDocumentoViaTemplate,
  criarTemplateDocx,
  criarWebhook,
  detalharDocumento,
  ZAPSIGN_AMBIENTES,
  zapsignConfigurado,
  type ZapSignAmbiente,
  type ZapSignSignatarioInput,
} from "@/lib/zapsign.server";
import { allowedSponteUnidades } from "@/lib/sponte.functions";
import { guardarArquivoAssinado, linkArquivoAssinado } from "@/lib/zapsign.arquivo";
import {
  aplicarEstadoDocumento,
  signatarioDoSigner,
  T_DOCS,
  T_EVENTOS,
  T_WEBHOOKS,
  type SignatarioPersistido,
} from "@/lib/zapsign.persist";

const LIMITE_PDF_BYTES = 10 * 1024 * 1024;

const AmbienteSchema = z.enum(["sandbox", "producao"]);

/** Documentos de sandbox continuam marcados como POC e prefixados; produção não. */
export function nomeDocumentoZapSign(nome: string, ambiente: ZapSignAmbiente): string {
  return ambiente === "sandbox" ? `[POC] ${nome}` : nome;
}

function exigirTokenDoAmbiente(ambiente: ZapSignAmbiente): void {
  if (!zapsignConfigurado(ambiente)) {
    throw new Error(`${ZAPSIGN_AMBIENTES[ambiente].envToken} não configurada no servidor.`);
  }
}

async function exigirEdicaoDocumentos(userId: string): Promise<string> {
  const { data: pode, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "documentos" } as never,
  );
  if (error) throw new Error(error.message);
  if (!pode) throw new Error("Sem permissão para editar Documentos.");
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  return nome || (data?.user?.email ?? "");
}

const SignatarioSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  telefone: z.string().trim().max(30).optional(),
  cpf: z.string().trim().max(20).optional(),
});

function normalizarSignatarios(
  lista: z.infer<typeof SignatarioSchema>[],
): ZapSignSignatarioInput[] {
  return lista.map((s, i) => ({
    nome: s.nome,
    email: s.email || undefined,
    telefone: s.telefone || undefined,
    cpf: s.cpf || undefined,
    ordem: i + 1,
  }));
}

function signatariosIniciais(lista: ZapSignSignatarioInput[]): SignatarioPersistido[] {
  return lista.map((s) => ({
    token: null,
    nome: s.nome,
    email: s.email ?? "",
    telefone: s.telefone ?? "",
    cpf: s.cpf ?? "",
    status: "new",
    sign_url: null,
    signed_at: null,
    times_viewed: 0,
  }));
}

const CriarPdfSchema = z.object({
  ambiente: AmbienteSchema,
  nome: z.string().trim().min(3).max(120),
  unidade: z.string().trim().max(40).nullable(),
  pdfBase64: z.string().min(100),
  signatarios: z.array(SignatarioSchema).min(1).max(5),
  ordemSequencial: z.boolean().default(false),
});

export type ZapSignDocumentoLista = {
  id: string;
  origem: "pdf" | "template";
  nome: string;
  unidade: string | null;
  zapsign_token: string | null;
  status: string;
  signatarios: SignatarioPersistido[];
  enviado_em: string;
  assinado_em: string | null;
  ultima_atualizacao_em: string | null;
  erro: string | null;
  created_by_nome: string;
  arquivo_assinado_path: string | null;
  arquivo_assinado_erro: string | null;
};

function validarBase64Pdf(b64: string): string {
  const limpo = b64.replace(/^data:application\/pdf;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(limpo)) throw new Error("PDF em Base64 inválido.");
  const bytes = Buffer.from(limpo, "base64");
  if (bytes.length > LIMITE_PDF_BYTES) throw new Error("PDF acima de 10 MB.");
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new Error("O arquivo não é um PDF.");
  return limpo;
}

/** Cria um documento na ZapSign do ambiente informado a partir de um PDF em Base64. */
export const criarDocumentoTestePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarPdfSchema.parse(input))
  .handler(async ({ data, context }) => {
    const autor = await exigirEdicaoDocumentos(context.userId);
    const { ambiente } = data;
    exigirTokenDoAmbiente(ambiente);
    const pdf = validarBase64Pdf(data.pdfBase64);
    const signatarios = normalizarSignatarios(data.signatarios);
    const nome = nomeDocumentoZapSign(data.nome, ambiente);

    const { data: registro, error } = await supabaseAdmin
      .from(T_DOCS)
      .insert({
        ambiente,
        poc: ambiente === "sandbox",
        origem: "pdf",
        nome,
        unidade: data.unidade,
        signatarios: signatariosIniciais(signatarios),
        created_by: context.userId,
        created_by_nome: autor,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !registro) throw new Error(`Falha ao registrar documento: ${error?.message}`);

    const r = await criarDocumentoPdf({
      ambiente,
      nome,
      pdfBase64: pdf,
      signatarios,
      externalId: registro.id,
      ordemSequencial: data.ordemSequencial,
    });
    if (!r.ok) {
      await supabaseAdmin
        .from(T_DOCS)
        .update({ status: "erro", erro: r.erro } as never)
        .eq("id", registro.id);
      throw new Error(r.erro);
    }
    const doc = r.dados;
    await supabaseAdmin
      .from(T_DOCS)
      .update({
        zapsign_token: doc.token,
        zapsign_open_id: doc.open_id ?? null,
        external_id: doc.external_id ?? registro.id,
        status: doc.status,
        signatarios: doc.signers.map((s, i) => signatarioDoSigner(s, signatarios[i]?.cpf ?? "")),
        ultima_atualizacao_em: doc.last_update_at,
        resposta_criacao: { token: doc.token, status: doc.status, created_at: doc.created_at },
      } as never)
      .eq("id", registro.id);

    return {
      id: registro.id,
      token: doc.token,
      status: doc.status,
      links: doc.signers.map((s) => ({ nome: s.name, signUrl: s.sign_url })),
    };
  });

const CriarTemplateSchema = z.object({
  ambiente: AmbienteSchema,
  nome: z.string().trim().min(3).max(120),
  docxBase64: z.string().min(100),
});

/** Sobe um modelo DOCX na ZapSign do ambiente informado e devolve o token do template + variáveis lidas. */
export const criarTemplateTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarTemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await exigirEdicaoDocumentos(context.userId);
    const limpo = data.docxBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const bytes = Buffer.from(limpo, "base64");
    if (bytes.length > LIMITE_PDF_BYTES) throw new Error("DOCX acima de 10 MB.");
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("O arquivo não é um DOCX.");
    exigirTokenDoAmbiente(data.ambiente);
    const r = await criarTemplateDocx(
      { nome: nomeDocumentoZapSign(data.nome, data.ambiente), docxBase64: limpo },
      data.ambiente,
    );
    if (!r.ok) throw new Error(r.erro);
    return {
      token: r.dados.token,
      nome: r.dados.name,
      variaveis: (r.dados.inputs ?? []).map((i) => i.variable),
    };
  });

const CriarViaTemplateSchema = z.object({
  ambiente: AmbienteSchema,
  nome: z.string().trim().min(3).max(120),
  unidade: z.string().trim().max(40).nullable(),
  templateToken: z.string().trim().min(8).max(80),
  signatario: SignatarioSchema,
  campos: z.array(z.object({ de: z.string().min(1).max(80), para: z.string().max(500) })).max(30),
});

/** Cria um documento a partir de um modelo DOCX já existente na ZapSign do ambiente informado. */
export const criarDocumentoTesteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarViaTemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const autor = await exigirEdicaoDocumentos(context.userId);
    const { ambiente } = data;
    exigirTokenDoAmbiente(ambiente);
    const [signatario] = normalizarSignatarios([data.signatario]);
    const nome = nomeDocumentoZapSign(data.nome, ambiente);

    const { data: registro, error } = await supabaseAdmin
      .from(T_DOCS)
      .insert({
        ambiente,
        poc: ambiente === "sandbox",
        origem: "template",
        nome,
        unidade: data.unidade,
        template_token: data.templateToken,
        signatarios: signatariosIniciais([signatario]),
        created_by: context.userId,
        created_by_nome: autor,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !registro) throw new Error(`Falha ao registrar documento: ${error?.message}`);

    const r = await criarDocumentoViaTemplate(
      {
        templateToken: data.templateToken,
        signatario,
        campos: data.campos,
        externalId: registro.id,
      },
      ambiente,
    );
    if (!r.ok) {
      await supabaseAdmin
        .from(T_DOCS)
        .update({ status: "erro", erro: r.erro } as never)
        .eq("id", registro.id);
      throw new Error(r.erro);
    }
    const doc = r.dados;
    await supabaseAdmin
      .from(T_DOCS)
      .update({
        zapsign_token: doc.token,
        zapsign_open_id: doc.open_id ?? null,
        external_id: doc.external_id ?? registro.id,
        status: doc.status,
        signatarios: doc.signers.map((s) => signatarioDoSigner(s, signatario.cpf ?? "")),
        ultima_atualizacao_em: doc.last_update_at,
        resposta_criacao: { token: doc.token, status: doc.status, created_at: doc.created_at },
      } as never)
      .eq("id", registro.id);

    return {
      id: registro.id,
      token: doc.token,
      status: doc.status,
      links: doc.signers.map((s) => ({ nome: s.name, signUrl: s.sign_url })),
    };
  });

/**
 * Registra na ZapSign do ambiente informado o webhook apontando para
 * /api/zapsign/webhook deste School Hub, assinado com o segredo do mesmo
 * ambiente (é por ele que o backend distingue de onde veio o callback).
 */
export const registrarWebhookTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ambiente: AmbienteSchema, baseUrl: z.string().url().max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const autor = await exigirEdicaoDocumentos(context.userId);
    const url = `${data.baseUrl.replace(/\/+$/, "")}/api/zapsign/webhook`;
    const r = await criarWebhook(url, data.ambiente);
    if (!r.ok) throw new Error(r.erro);
    await supabaseAdmin.from(T_WEBHOOKS).insert({
      ambiente: data.ambiente,
      zapsign_id: r.dados.id ?? null,
      url,
      tipo: r.dados.type ?? "",
      resposta: r.dados,
      created_by_nome: autor,
    } as never);
    return { id: r.dados.id, url };
  });

/** Consulta o detalhe na ZapSign e sincroniza o status local (fallback quando o webhook não chegou). */
export const sincronizarDocumentoTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ambiente: AmbienteSchema, id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirEdicaoDocumentos(context.userId);
    const { data: doc } = await supabaseAdmin
      .from(T_DOCS)
      .select("zapsign_token")
      .eq("id", data.id)
      .eq("ambiente", data.ambiente)
      .maybeSingle<{ zapsign_token: string | null }>();
    if (!doc?.zapsign_token) throw new Error("Documento sem token da ZapSign.");
    const r = await detalharDocumento(doc.zapsign_token, data.ambiente);
    if (!r.ok) throw new Error(r.erro);
    await aplicarEstadoDocumento(doc.zapsign_token, r.dados, data.ambiente);
    return { status: r.dados.status };
  });

export type ZapSignEventoLista = {
  id: string;
  documento_id: string | null;
  zapsign_token: string | null;
  event_type: string;
  status_documento: string | null;
  recebido_em: string;
};

export type ZapSignWebhookLista = {
  id: string;
  zapsign_id: number | null;
  url: string;
  tipo: string;
  created_at: string;
  created_by_nome: string;
};

/**
 * Lista documentos avulsos desta aba, eventos recebidos e webhooks do ambiente
 * (só leitura). Os Contratos de Matrícula ficam de fora: têm tela própria.
 */
export const listarDocumentosTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ ambiente: AmbienteSchema, unidade: z.string().trim().max(40).nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: pode, error } = await supabaseAdmin.rpc(
      "can_view_module" as never,
      { _user_id: context.userId, _module: "documentos" } as never,
    );
    if (error) throw new Error(error.message);
    if (!pode) throw new Error("Sem permissão para ver Documentos.");

    let q = supabaseAdmin
      .from(T_DOCS)
      .select(
        "id, origem, nome, unidade, zapsign_token, status, signatarios, enviado_em, assinado_em, ultima_atualizacao_em, erro, created_by_nome, arquivo_assinado_path, arquivo_assinado_erro",
      )
      .eq("ambiente", data.ambiente)
      .not("external_id", "like", "contrato-matricula:%")
      .order("enviado_em", { ascending: false })
      .limit(200);
    if (data.unidade) {
      const permitidas = await allowedSponteUnidades(context.userId);
      if (permitidas !== null && !permitidas.includes(data.unidade))
        throw new Error("Sem permissão para esta unidade.");
      q = q.eq("unidade", data.unidade);
    } else {
      // "Todas as Unidades": consolidado só das unidades permitidas ao usuário
      // (documentos sem unidade continuam visíveis).
      const permitidas = await allowedSponteUnidades(context.userId);
      if (permitidas !== null) {
        const lista = permitidas.map((u) => `"${u.replace(/"/g, "")}"`).join(",");
        q = q.or(`unidade.is.null,unidade.in.(${lista})`);
      }
    }
    const [docs, eventos, webhooks] = await Promise.all([
      q.returns<ZapSignDocumentoLista[]>(),
      supabaseAdmin
        .from(T_EVENTOS)
        .select("id", { count: "exact", head: true })
        .eq("sandbox", data.ambiente === "sandbox"),
      supabaseAdmin
        .from(T_WEBHOOKS)
        .select("id, zapsign_id, url, tipo, created_at, created_by_nome")
        .eq("ambiente", data.ambiente)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<ZapSignWebhookLista[]>(),
    ]);
    if (docs.error) throw new Error(docs.error.message);
    return {
      configurado: zapsignConfigurado(data.ambiente),
      documentos: docs.data ?? [],
      totalEventos: eventos.count ?? 0,
      webhooks: webhooks.data ?? [],
    };
  });

/** Eventos recebidos pelo webhook do ambiente; carregados só quando o card é aberto. */
export const listarEventosZapSign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ambiente: AmbienteSchema }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirVisualizacao(context.userId, ["documentos"]);
    const { data: eventos, error } = await supabaseAdmin
      .from(T_EVENTOS)
      .select("id, documento_id, zapsign_token, event_type, status_documento, recebido_em")
      .eq("sandbox", data.ambiente === "sandbox")
      .order("recebido_em", { ascending: false })
      .limit(200)
      .returns<ZapSignEventoLista[]>();
    if (error) throw new Error(error.message);
    return eventos ?? [];
  });

async function exigirVisualizacao(userId: string, modulos: string[]): Promise<void> {
  const resultados = await Promise.all(
    modulos.map((m) =>
      supabaseAdmin.rpc("can_view_module" as never, { _user_id: userId, _module: m } as never),
    ),
  );
  for (const r of resultados) if (r.error) throw new Error(r.error.message);
  if (!resultados.some((r) => Boolean(r.data))) {
    throw new Error("Sem permissão para ver este documento.");
  }
}

/**
 * Link assinado de curta duração para o PDF assinado guardado no School Hub.
 * Mesma regra de quem vê o documento na tela de origem: Documentos (aba
 * ZapSign) ou Rematrícula (aba Contratos). Se o arquivo ainda não foi
 * guardado, tenta guardar na hora.
 */
export const obterLinkArquivoAssinado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ambiente: AmbienteSchema, id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirVisualizacao(context.userId, ["documentos", "rematricula"]);
    const r = await linkArquivoAssinado(data.id, data.ambiente);
    if (r.url === null) throw new Error(r.erro);
    return { url: r.url };
  });

export type BackfillCandidato = {
  id: string;
  nome: string;
  unidade: string | null;
  assinado_em: string | null;
};

/**
 * Guarda o PDF dos documentos de PRODUÇÃO já assinados e ainda sem cópia
 * própria. `dryRun` só lista os candidatos, sem gravar nada.
 */
export const backfillArquivosAssinados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ dryRun: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirEdicaoDocumentos(context.userId);
    const { data: docs, error } = await supabaseAdmin
      .from(T_DOCS)
      .select("id, nome, unidade, assinado_em, zapsign_token")
      .eq("ambiente", "producao")
      .eq("status", "signed")
      .is("arquivo_assinado_path", null)
      .order("assinado_em", { ascending: true })
      .returns<(BackfillCandidato & { zapsign_token: string | null })[]>();
    if (error) throw new Error(error.message);
    const candidatos = docs ?? [];
    const sucessos: BackfillCandidato[] = [];
    const falhas: (BackfillCandidato & { motivo: string })[] = [];
    if (!data.dryRun) {
      for (const d of candidatos) {
        if (!d.zapsign_token) {
          falhas.push({ ...d, motivo: "Documento sem token da ZapSign." });
          continue;
        }
        const r = await guardarArquivoAssinado(d.id, d.zapsign_token, "producao");
        if (r.ok) sucessos.push(d);
        else falhas.push({ ...d, motivo: r.erro });
      }
    }
    return {
      dryRun: data.dryRun,
      candidatos: candidatos.map(({ id, nome, unidade, assinado_em }) => ({
        id,
        nome,
        unidade,
        assinado_em,
      })),
      sucessos,
      falhas,
    };
  });
