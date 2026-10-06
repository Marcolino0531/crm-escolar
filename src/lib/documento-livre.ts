// Documento livre (Documentos > Gerar Documento, só admin): título e texto
// digitados na hora, sem modelo. Lógica pura: validação e montagem do
// documento a partir do snapshot gravado em documentos_recibos — o PDF só
// desenha o que sai daqui, para que a reimpressão do Histórico saia igual.

import {
  dataPorExtenso,
  enderecoLinha,
  formatarDataBR,
  formatarNumeroRecibo,
  type AlunoRecibo,
  type ColegioRecibo,
} from "@/lib/recibos";

export const TITULO_MIN = 3;
export const TITULO_MAX = 120;
export const TEXTO_MAX = 10_000;

/** O que fica gravado em documentos_recibos.snapshot. */
export interface DocumentoLivreSnapshot {
  colegio: ColegioRecibo;
  /** Só vincula o documento ao aluno no Histórico; não entra no texto. */
  aluno: AlunoRecibo | null;
  titulo: string;
  texto: string;
  assinanteNome: string;
  assinanteCargo: string;
}

export interface DocumentoLivreDocumento {
  numero: string; // "00012/2026"
  dataDocumento: string; // YYYY-MM-DD escolhida pelo usuário
  dataEmissao: string; // dd/mm/aaaa (rodapé)
  dataExtenso: string; // "Cidade, 14 de agosto de 2026"
  titulo: string; // em maiúsculas, como sai no PDF
  /** Parágrafos (linha em branco separa); quebras simples mantidas como "\n". */
  paragrafos: string[];
  assinanteNome: string;
  assinanteCargo: string;
  colegio: ColegioRecibo;
  enderecoColegio: string;
  contatoColegio: string;
  aluno: AlunoRecibo | null;
}

export interface ValidarDocumentoLivreInput {
  colegio: ColegioRecibo | null;
  titulo: string;
  texto: string;
  dataDocumento: string;
}

export function validarDocumentoLivre(input: ValidarDocumentoLivreInput): string[] {
  const erros: string[] = [];
  if (!input.colegio || !input.colegio.razaoSocial.trim()) {
    erros.push("Cadastre a razão social do colégio em Dados dos Colégios.");
  }
  const titulo = input.titulo.trim();
  if (!titulo) erros.push("Informe o título.");
  else if (titulo.length < TITULO_MIN || titulo.length > TITULO_MAX) {
    erros.push(`O título deve ter de ${TITULO_MIN} a ${TITULO_MAX} caracteres.`);
  }
  if (!input.texto.trim()) erros.push("Informe o texto do documento.");
  else if (input.texto.length > TEXTO_MAX) {
    erros.push(`O texto pode ter no máximo ${TEXTO_MAX.toLocaleString("pt-BR")} caracteres.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dataDocumento)) erros.push("Informe a data do documento.");
  return erros;
}

/** Linha em branco separa parágrafos; quebra simples continua dentro do parágrafo. */
export function paragrafosDoTexto(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trimEnd())
        .join("\n")
        .replace(/^\n+|\n+$/g, ""),
    )
    .filter((p) => p.trim() !== "");
}

export interface MontarDocumentoLivreInput {
  numero: number;
  dataDocumento: string;
  snapshot: DocumentoLivreSnapshot;
}

export function montarDocumentoLivre(input: MontarDocumentoLivreInput): DocumentoLivreDocumento {
  const { snapshot } = input;
  const colegio = snapshot.colegio;
  const dataExtenso = [colegio.cidade.trim(), dataPorExtenso(input.dataDocumento)]
    .filter(Boolean)
    .join(", ");
  return {
    numero: formatarNumeroRecibo(input.numero, input.dataDocumento),
    dataDocumento: input.dataDocumento,
    dataEmissao: formatarDataBR(input.dataDocumento),
    dataExtenso,
    titulo: snapshot.titulo.trim().toLocaleUpperCase("pt-BR"),
    paragrafos: paragrafosDoTexto(snapshot.texto),
    assinanteNome: snapshot.assinanteNome.trim(),
    assinanteCargo: snapshot.assinanteCargo.trim(),
    colegio,
    enderecoColegio: enderecoLinha(colegio),
    contatoColegio: [colegio.telefone, colegio.email, colegio.site]
      .map((p) => p.trim())
      .filter(Boolean)
      .join(" · "),
    aluno: snapshot.aluno,
  };
}

/** "documento-00012-2026-declaracao-escolar.pdf" */
export function nomeArquivoDocumentoLivre(doc: DocumentoLivreDocumento): string {
  const titulo = doc.titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const numero = doc.numero.replace(/\//g, "-");
  return `documento-${numero}${titulo ? `-${titulo}` : ""}.pdf`;
}
