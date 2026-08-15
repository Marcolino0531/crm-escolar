// Leitura do PDF da folha de ponto no client.
//
// Mesma infraestrutura do PDF de contracheques (pdfjs build legacy + leitura do
// stream de texto pelo reader, para não quebrar no Safari), mas aqui o que
// interessa de cada página são os itens posicionados: nos dois layouts em uso as
// batidas do relógio e as colunas de totalização são ambas "HH:MM", e só a
// coordenada x distingue uma da outra.

import { ErroLeituraPdf } from "./contracheques.pdf";
import { classificarErroPdf } from "./contracheques";
import { lerItensDeTexto } from "./pdf-text";
import {
  competenciaDoPdf,
  detectarLayout,
  linhasDeItens,
  parsePaginaPonto,
  type LayoutPonto,
  type PaginaPonto,
} from "./ponto";

export const TAMANHO_MAXIMO_PONTO_MB = 50;

async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: workerSrc } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc as string;
  return pdfjsLib;
}

export type ResultadoLeituraPonto = {
  paginas: PaginaPonto[];
  layout: LayoutPonto;
  // Páginas que abriram mas cujo conteúdo não casa com nenhum layout conhecido.
  paginasIgnoradas: number[];
  // Competência impressa no próprio PDF (YYYY-MM), quando localizada.
  competenciaNoPdf: string | null;
};

export async function lerFolhaDePonto(
  arquivo: File,
  senhaPdf?: string,
): Promise<ResultadoLeituraPonto> {
  const mb = arquivo.size / (1024 * 1024);
  if (mb > TAMANHO_MAXIMO_PONTO_MB) {
    throw new ErroLeituraPdf("tamanho", {
      tamanhoMaximoMb: TAMANHO_MAXIMO_PONTO_MB,
      tamanhoMb: mb,
    });
  }

  const pdfjsLib = await carregarPdfjs();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({
      data: bytes,
      ...(senhaPdf ? { password: senhaPdf } : {}),
    }).promise;
  } catch (erro) {
    throw new ErroLeituraPdf(classificarErroPdf(erro));
  }

  const total = typeof pdf.numPages === "number" ? pdf.numPages : 0;
  if (total === 0) throw new ErroLeituraPdf("invalido");

  const paginas: PaginaPonto[] = [];
  const paginasIgnoradas: number[] = [];
  let semTexto = 0;
  let layout: LayoutPonto | null = null;
  let competenciaNoPdf: string | null = null;

  for (let p = 1; p <= total; p++) {
    const page = await pdf.getPage(p);
    const linhas = linhasDeItens(await lerItensDeTexto(page));
    if (linhas.length === 0) {
      semTexto += 1;
      paginasIgnoradas.push(p);
      continue;
    }
    // O layout é o da primeira página reconhecida: um arquivo é sempre de uma
    // unidade só, e assumir o mesmo formato evita interpretar uma página
    // atípica com o parser errado.
    layout = layout ?? detectarLayout(linhas);
    competenciaNoPdf = competenciaNoPdf ?? competenciaDoPdf(linhas);

    const pagina = layout ? parsePaginaPonto(p, linhas, layout) : null;
    if (pagina) paginas.push(pagina);
    else paginasIgnoradas.push(p);
  }

  if (semTexto === total) throw new ErroLeituraPdf("sem_texto", { paginas: total });
  if (!layout || paginas.length === 0) {
    throw new ErroLeituraPdf("formato_nao_reconhecido", { paginas: total });
  }

  return { paginas, layout, paginasIgnoradas, competenciaNoPdf };
}
