// Server functions da POC ZapSign (sandbox). Todas exigem sessão autenticada
// e permissão de edição no módulo Documentos. Nenhum documento real é gerado
// aqui: apenas PDFs/modelos de teste, sem validade jurídica.

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
  zapsignConfigurado,
  type ZapSignSignatarioInput,
} from "@/lib/zapsign.server";
import {
  aplicarEstadoDocumento,
  signatarioDoSigner,
  T_DOCS,
  T_EVENTOS,
  T_WEBHOOKS,
  type SignatarioPersistido,
} from "@/lib/zapsign.persist";

const LIMITE_PDF_BYTES = 10 * 1024 * 1024;

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

/** Cria um documento de teste na ZapSign sandbox a partir de um PDF em Base64. */
export const criarDocumentoTestePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarPdfSchema.parse(input))
  .handler(async ({ data, context }) => {
    const autor = await exigirEdicaoDocumentos(context.userId);
    if (!zapsignConfigurado())
      throw new Error("ZAPSIGN_SANDBOX_TOKEN não configurada no servidor.");
    const pdf = validarBase64Pdf(data.pdfBase64);
    const signatarios = normalizarSignatarios(data.signatarios);

    const { data: registro, error } = await supabaseAdmin
      .from(T_DOCS)
      .insert({
        origem: "pdf",
        nome: `[POC] ${data.nome}`,
        unidade: data.unidade,
        signatarios: signatariosIniciais(signatarios),
        created_by: context.userId,
        created_by_nome: autor,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !registro) throw new Error(`Falha ao registrar documento: ${error?.message}`);

    const r = await criarDocumentoPdf({
      nome: `[POC] ${data.nome}`,
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
  nome: z.string().trim().min(3).max(120),
  docxBase64: z.string().min(100),
});

/** Sobe um modelo DOCX de teste na ZapSign sandbox e devolve o token do template + variáveis lidas. */
export const criarTemplateTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarTemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await exigirEdicaoDocumentos(context.userId);
    const limpo = data.docxBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    const bytes = Buffer.from(limpo, "base64");
    if (bytes.length > LIMITE_PDF_BYTES) throw new Error("DOCX acima de 10 MB.");
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("O arquivo não é um DOCX.");
    const r = await criarTemplateDocx({ nome: `[POC] ${data.nome}`, docxBase64: limpo });
    if (!r.ok) throw new Error(r.erro);
    return {
      token: r.dados.token,
      nome: r.dados.name,
      variaveis: (r.dados.inputs ?? []).map((i) => i.variable),
    };
  });

const CriarViaTemplateSchema = z.object({
  nome: z.string().trim().min(3).max(120),
  unidade: z.string().trim().max(40).nullable(),
  templateToken: z.string().trim().min(8).max(80),
  signatario: SignatarioSchema,
  campos: z.array(z.object({ de: z.string().min(1).max(80), para: z.string().max(500) })).max(30),
});

/** Cria um documento de teste a partir de um modelo DOCX já existente na ZapSign sandbox. */
export const criarDocumentoTesteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CriarViaTemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const autor = await exigirEdicaoDocumentos(context.userId);
    if (!zapsignConfigurado())
      throw new Error("ZAPSIGN_SANDBOX_TOKEN não configurada no servidor.");
    const [signatario] = normalizarSignatarios([data.signatario]);

    const { data: registro, error } = await supabaseAdmin
      .from(T_DOCS)
      .insert({
        origem: "template",
        nome: `[POC] ${data.nome}`,
        unidade: data.unidade,
        template_token: data.templateToken,
        signatarios: signatariosIniciais([signatario]),
        created_by: context.userId,
        created_by_nome: autor,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !registro) throw new Error(`Falha ao registrar documento: ${error?.message}`);

    const r = await criarDocumentoViaTemplate({
      templateToken: data.templateToken,
      signatario,
      campos: data.campos,
      externalId: registro.id,
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

/** Registra na ZapSign sandbox o webhook apontando para /api/zapsign/webhook deste School Hub. */
export const registrarWebhookTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ baseUrl: z.string().url().max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    const autor = await exigirEdicaoDocumentos(context.userId);
    const url = `${data.baseUrl.replace(/\/+$/, "")}/api/zapsign/webhook`;
    const r = await criarWebhook(url);
    if (!r.ok) throw new Error(r.erro);
    await supabaseAdmin.from(T_WEBHOOKS).insert({
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
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigirEdicaoDocumentos(context.userId);
    const { data: doc } = await supabaseAdmin
      .from(T_DOCS)
      .select("zapsign_token")
      .eq("id", data.id)
      .maybeSingle<{ zapsign_token: string | null }>();
    if (!doc?.zapsign_token) throw new Error("Documento sem token da ZapSign.");
    const r = await detalharDocumento(doc.zapsign_token);
    if (!r.ok) throw new Error(r.erro);
    await aplicarEstadoDocumento(doc.zapsign_token, r.dados);
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

/** Lista documentos de teste, eventos recebidos e webhooks registrados (só leitura). */
export const listarDocumentosTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ unidade: z.string().trim().max(40).nullable() }).parse(input),
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
        "id, origem, nome, unidade, zapsign_token, status, signatarios, enviado_em, assinado_em, ultima_atualizacao_em, erro, created_by_nome",
      )
      .eq("poc", true)
      .order("enviado_em", { ascending: false })
      .limit(200);
    if (data.unidade) q = q.eq("unidade", data.unidade);
    const [docs, eventos, webhooks] = await Promise.all([
      q.returns<ZapSignDocumentoLista[]>(),
      supabaseAdmin
        .from(T_EVENTOS)
        .select("id, documento_id, zapsign_token, event_type, status_documento, recebido_em")
        .order("recebido_em", { ascending: false })
        .limit(200)
        .returns<ZapSignEventoLista[]>(),
      supabaseAdmin
        .from(T_WEBHOOKS)
        .select("id, zapsign_id, url, tipo, created_at, created_by_nome")
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<ZapSignWebhookLista[]>(),
    ]);
    if (docs.error) throw new Error(docs.error.message);
    return {
      configurado: zapsignConfigurado(),
      documentos: docs.data ?? [],
      eventos: eventos.data ?? [],
      webhooks: webhooks.data ?? [],
    };
  });
