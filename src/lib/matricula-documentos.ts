// Documentos da ficha da matrícula: os do formulário (família) e os anexados
// depois pela secretaria (ex.: recebidos pelo WhatsApp). Regras puras usadas
// pela tela, pelo PDF da ficha e pelo servidor.

import {
  DOCUMENTOS_MATRICULA,
  TAMANHO_MAX_DOCUMENTO,
  TIPOS_DOCUMENTO_ACEITOS,
  type DocumentoMatricula,
} from "@/lib/matricula-form";

export type OrigemDocumento = "familia" | "secretaria";

/** Chave dos documentos fora da lista do formulário ("Anexar outro documento"). */
export const PREFIXO_DOCUMENTO_LIVRE = "outro_";

export const TAMANHO_MAX_NOME_DOCUMENTO = 120;

export const ORIGEM_FAMILIA_TEXTO = "Enviado pela família no formulário";

export interface DocumentoFichaBase {
  documento: string;
  nomeDocumento?: string | null;
  origem?: OrigemDocumento;
  anexadoPorNome?: string | null;
  anexadoEm?: string | null;
}

export function ehDocumentoLivre(chave: string): boolean {
  return chave.startsWith(PREFIXO_DOCUMENTO_LIVRE);
}

export function rotuloDocumento(doc: { documento: string; nomeDocumento?: string | null }): string {
  const nome = doc.nomeDocumento?.trim();
  if (nome) return nome;
  return DOCUMENTOS_MATRICULA.find((d) => d.chave === doc.documento)?.rotulo ?? doc.documento;
}

export function dataCurtaBrasil(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function origemDocumentoTexto(doc: DocumentoFichaBase): string {
  if (doc.origem !== "secretaria") return ORIGEM_FAMILIA_TEXTO;
  const nome = doc.anexadoPorNome?.trim() || "usuário não identificado";
  const data = doc.anexadoEm ? dataCurtaBrasil(doc.anexadoEm) : "data não informada";
  return `Anexado pela secretaria: ${nome}, ${data}`;
}

export interface ItemDocumentoFicha<D> {
  chave: string;
  rotulo: string;
  dica?: string;
  /** null = pendente. */
  doc: D | null;
}

/**
 * Todos os documentos do formulário na ordem de DOCUMENTOS_MATRICULA (presentes
 * ou pendentes) e, depois, os documentos de nome livre na ordem em que foram
 * anexados.
 */
export function montarListaDocumentosFicha<D extends { documento: string }>(
  documentos: readonly D[],
): { padronizados: ItemDocumentoFicha<D>[]; livres: D[] } {
  const padronizados = DOCUMENTOS_MATRICULA.map(
    (d: DocumentoMatricula): ItemDocumentoFicha<D> => ({
      chave: d.chave,
      rotulo: d.rotulo,
      dica: d.dica,
      doc: documentos.find((doc) => doc.documento === d.chave) ?? null,
    }),
  );
  const livres = documentos.filter((doc) => ehDocumentoLivre(doc.documento));
  return { padronizados, livres };
}

/** Posição do documento na ficha: lista do formulário primeiro, livres depois. */
export function ordemDocumento(chave: string): number {
  const i = DOCUMENTOS_MATRICULA.findIndex((d) => d.chave === chave);
  return i === -1 ? DOCUMENTOS_MATRICULA.length : i;
}

/** Mesmas regras do formulário público: foto ou PDF, até 10 MB. */
export function erroArquivoDocumento(tipo: string, tamanhoBytes: number): string | null {
  if (!TIPOS_DOCUMENTO_ACEITOS.includes(tipo)) return "Envie uma imagem (JPG/PNG) ou um PDF.";
  if (tamanhoBytes <= 0) return "O arquivo está vazio.";
  if (tamanhoBytes > TAMANHO_MAX_DOCUMENTO) return "O arquivo passa de 10 MB.";
  return null;
}

/** Pasta no bucket dos anexos da secretaria de uma submissão (id da linha). */
export function pastaDocumentosSecretaria(submissaoId: string): string {
  return `secretaria/${submissaoId}`;
}

export function caminhoDaSubmissao(path: string, submissaoId: string): boolean {
  const pasta = `${pastaDocumentosSecretaria(submissaoId)}/`;
  return (
    path.startsWith(pasta) && !path.slice(pasta.length).includes("/") && path.length > pasta.length
  );
}
