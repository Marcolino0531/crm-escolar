// Cópia própria do PDF assinado da ZapSign no bucket privado `zapsign-assinados`.
//
// O `signed_file` da ZapSign é uma URL pré-assinada do S3 que expira em ~1 h,
// por isso o School Hub baixa o PDF no servidor assim que o documento fica
// "signed" e passa a servir a própria cópia por link assinado de curta duração.
// Nada deste módulo pode ser importado pelo navegador.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detalharDocumento, type ZapSignAmbiente } from "@/lib/zapsign.server";

const T_DOCS = "zapsign_documentos" as never;

export const BUCKET_ZAPSIGN_ASSINADOS = "zapsign-assinados";
const LIMITE_PDF_BYTES = 20 * 1024 * 1024;
const VALIDADE_LINK_SEGUNDOS = 120;

export function caminhoArquivoAssinado(ambiente: ZapSignAmbiente, documentoId: string): string {
  return `${ambiente}/${documentoId}.pdf`;
}

export type ResultadoGuardar =
  | { ok: true; path: string; jaExistia: boolean }
  | { ok: false; erro: string };

type ArquivoRow = {
  id: string;
  status: string;
  arquivo_assinado_path: string | null;
};

function mensagemErro(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

async function baixarPdf(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": "School Hub" } });
  if (!res.ok) throw new Error(`Download do PDF assinado falhou: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("PDF assinado vazio.");
  if (bytes.length > LIMITE_PDF_BYTES) throw new Error("PDF assinado acima de 20 MB.");
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("Conteúdo devolvido pela ZapSign não é um PDF.");
  }
  return bytes;
}

/**
 * Guarda o PDF assinado do documento no bucket próprio. Idempotente: se já há
 * `arquivo_assinado_path`, não faz nada. Usa `signedFileUrl` (do payload do
 * webhook) quando informado e ainda válido; senão consulta a ZapSign. Nunca
 * lança: falhas ficam em `arquivo_assinado_erro` e são devolvidas no resultado.
 */
export async function guardarArquivoAssinado(
  documentoId: string,
  zapsignToken: string,
  ambiente: ZapSignAmbiente,
  signedFileUrl?: string | null,
): Promise<ResultadoGuardar> {
  try {
    const { data: doc } = await supabaseAdmin
      .from(T_DOCS)
      .select("id, status, arquivo_assinado_path")
      .eq("id", documentoId)
      .eq("ambiente", ambiente)
      .maybeSingle<ArquivoRow>();
    if (!doc) return { ok: false, erro: "Documento não encontrado." };
    if (doc.arquivo_assinado_path)
      return { ok: true, path: doc.arquivo_assinado_path, jaExistia: true };
    if (doc.status !== "signed") return { ok: false, erro: "Documento ainda não está assinado." };

    let bytes: Buffer | null = null;
    if (signedFileUrl) {
      try {
        bytes = await baixarPdf(signedFileUrl);
      } catch {
        bytes = null; // link do payload pode ter expirado: cai para a consulta
      }
    }
    if (!bytes) {
      const r = await detalharDocumento(zapsignToken, ambiente);
      if (!r.ok) throw new Error(r.erro);
      if (!r.dados.signed_file) throw new Error("ZapSign não devolveu o signed_file.");
      bytes = await baixarPdf(r.dados.signed_file);
    }

    const path = caminhoArquivoAssinado(ambiente, documentoId);
    const up = await supabaseAdmin.storage
      .from(BUCKET_ZAPSIGN_ASSINADOS)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(`Falha ao gravar no storage: ${up.error.message}`);

    await supabaseAdmin
      .from(T_DOCS)
      .update({
        arquivo_assinado_path: path,
        arquivo_assinado_em: new Date().toISOString(),
        arquivo_assinado_erro: null,
      } as never)
      .eq("id", documentoId);
    return { ok: true, path, jaExistia: false };
  } catch (e) {
    const erro = mensagemErro(e);
    await supabaseAdmin
      .from(T_DOCS)
      .update({ arquivo_assinado_erro: erro } as never)
      .eq("id", documentoId);
    return { ok: false, erro };
  }
}

/**
 * Link assinado de curta duração para o PDF guardado. Se ainda não houver
 * cópia, tenta guardar na hora. A permissão é responsabilidade de quem chama.
 */
export async function linkArquivoAssinado(
  documentoId: string,
  ambiente: ZapSignAmbiente,
): Promise<{ url: string } | { url: null; erro: string }> {
  const { data: doc } = await supabaseAdmin
    .from(T_DOCS)
    .select("id, status, zapsign_token, arquivo_assinado_path")
    .eq("id", documentoId)
    .eq("ambiente", ambiente)
    .maybeSingle<ArquivoRow & { zapsign_token: string | null }>();
  if (!doc) return { url: null, erro: "Documento não encontrado." };

  let path = doc.arquivo_assinado_path;
  if (!path) {
    if (!doc.zapsign_token) return { url: null, erro: "Documento sem token da ZapSign." };
    const r = await guardarArquivoAssinado(documentoId, doc.zapsign_token, ambiente);
    if (!r.ok) return { url: null, erro: r.erro };
    path = r.path;
  }
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_ZAPSIGN_ASSINADOS)
    .createSignedUrl(path, VALIDADE_LINK_SEGUNDOS);
  if (error || !data?.signedUrl) {
    return { url: null, erro: error?.message ?? "Falha ao gerar o link do PDF." };
  }
  return { url: data.signedUrl };
}
