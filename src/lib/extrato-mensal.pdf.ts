// Leitura do PDF do "Extrato Mensal" (Domínio) no navegador.
//
// O arquivo da folha nunca sai do navegador: aqui só extraímos os itens de
// texto por página (str, x, y, w, h, eol) e entregamos à leitura pura de
// extrato-mensal.ts. O servidor recebe apenas os dados estruturados.

import { lerItensDeTexto } from "./pdf-text";
import {
  importarExtratoMensal,
  type FolhaExtrato,
  type ItemTexto,
  type PaginaItens,
} from "./extrato-mensal";
import { ErroLeituraPdf, TAMANHO_MAXIMO_PDF_MB } from "./contracheques.pdf";
import { classificarErroPdf } from "./contracheques";

async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: workerSrc } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc as string;
  return pdfjsLib;
}

type ItemPdfjs = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  hasEOL?: unknown;
};

function paraItem(bruto: unknown): ItemTexto | null {
  const it = bruto as ItemPdfjs;
  if (typeof it?.str !== "string" || !Array.isArray(it.transform)) return null;
  const t = it.transform as unknown[];
  const x = Number(t[4]);
  const y = Number(t[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    str: it.str,
    x,
    y,
    w: Number(it.width) || 0,
    h: Number(it.height) || 0,
    eol: it.hasEOL === true,
  };
}

/** Itens de texto de cada página, no formato da leitura pura. */
export async function extrairItensDoPdf(arquivo: File): Promise<PaginaItens[]> {
  const mb = arquivo.size / (1024 * 1024);
  if (mb > TAMANHO_MAXIMO_PDF_MB) {
    throw new ErroLeituraPdf("tamanho", { tamanhoMaximoMb: TAMANHO_MAXIMO_PDF_MB, tamanhoMb: mb });
  }
  const pdfjsLib = await carregarPdfjs();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  } catch (erro) {
    throw new ErroLeituraPdf(classificarErroPdf(erro));
  }
  const paginas: PaginaItens[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const itens = (await lerItensDeTexto(page))
      .map(paraItem)
      .filter((i): i is ItemTexto => i !== null);
    paginas.push({ pagina: p, itens });
  }
  if (paginas.length === 0) throw new ErroLeituraPdf("invalido");
  if (paginas.every((p) => p.itens.every((i) => !i.str.trim()))) {
    throw new ErroLeituraPdf("sem_texto", { paginas: paginas.length });
  }
  return paginas;
}

/** Lê o PDF e devolve a folha já conferida (lança ErroExtratoMensal se não fechar). */
export async function lerExtratoMensalPdf(arquivo: File): Promise<FolhaExtrato> {
  return importarExtratoMensal(await extrairItensDoPdf(arquivo));
}
