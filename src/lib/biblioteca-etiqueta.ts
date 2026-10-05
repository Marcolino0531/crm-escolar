// Etiquetas em PDF com o código de barras (Code 128) dos exemplares da
// Biblioteca, prontas para imprimir e colar na contracapa.
//
// Cada etiqueta tem 50 mm × 25 mm: nome da unidade em cima, barras no meio e
// o código legível, "Título:" (até 2 linhas) e "Autor:" (1 linha) abaixo. Uma etiqueta = PDF do tamanho exato; várias
// = grade A4 (4 colunas × 11 linhas) com marcas de corte, mesmo espírito do
// chaveiro do Diário (diario-keychain.ts).

import { code128Modules } from "@/lib/code128";
import { formatarCodigoExemplar } from "@/lib/biblioteca";

export type EtiquetaExemplar = {
  codigo: string;
  titulo: string;
  autor: string;
  unidade: string;
};

export const LABEL_W = 50;
export const LABEL_H = 25;
const BAR_H = 8;

// Posições verticais (mm, a partir do topo da etiqueta). Linhas de texto em
// 6 pt ocupam ~2,4 mm; a última linha possível (autor depois de título em 2
// linhas) termina antes da borda inferior.
const MARGEM_TEXTO = 2;
const Y_UNIDADE = 3.2;
export const Y_BARRAS = 4.5;
const Y_CODIGO = 15.6;
export const Y_TEXTO = 18.4;
export const ENTRELINHA = 2.4;
const FONTE_TEXTO = 6;
export const RETICENCIAS = "…";

type Doc = import("jspdf").jsPDF;
type Medir = (texto: string) => number;

/** Corta o texto com "…" até caber na largura. */
export function cortarComReticencias(texto: string, largura: number, medir: Medir): string {
  if (medir(texto) <= largura) return texto;
  let corte = texto.length;
  while (corte > 0 && medir(texto.slice(0, corte).trimEnd() + RETICENCIAS) > largura) corte--;
  return texto.slice(0, corte).trimEnd() + RETICENCIAS;
}

/**
 * Quebra o texto em até `larguras.length` linhas (cada uma com sua largura),
 * por palavras; o que não couber na última linha é cortado com "…".
 */
export function quebrarLinhas(texto: string, larguras: number[], medir: Medir): string[] {
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let i = 0;
  for (let l = 0; l < larguras.length && i < palavras.length; l++) {
    const largura = larguras[l];
    if (l === larguras.length - 1) {
      linhas.push(cortarComReticencias(palavras.slice(i).join(" "), largura, medir));
      i = palavras.length;
      break;
    }
    let linha = "";
    while (i < palavras.length) {
      const tentativa = linha ? `${linha} ${palavras[i]}` : palavras[i];
      if (medir(tentativa) > largura) break;
      linha = tentativa;
      i++;
    }
    // Palavra maior que a linha inteira: corta por caracteres.
    if (!linha) {
      const palavra = palavras[i];
      let corte = palavra.length;
      while (corte > 1 && medir(palavra.slice(0, corte)) > largura) corte--;
      linha = palavra.slice(0, corte);
      palavras[i] = palavra.slice(corte);
    }
    linhas.push(linha);
  }
  return linhas;
}

// Rótulo em negrito seguido do texto normal; devolve a largura do rótulo.
function rotulo(doc: Doc, x: number, y: number, texto: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONTE_TEXTO);
  doc.text(texto, x, y);
  const largura = doc.getTextWidth(texto);
  doc.setFont("helvetica", "normal");
  return largura;
}

function drawBarcode(doc: Doc, x: number, y: number, maxW: number, codigo: string) {
  const mods = code128Modules(codigo);
  const total = mods.reduce((s, w) => s + w, 0);
  // Margem silenciosa de 10 módulos de cada lado.
  const modW = maxW / (total + 20);
  let cx = x + modW * 10;
  doc.setFillColor(0, 0, 0);
  mods.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(cx, y, w * modW, BAR_H, "F");
    cx += w * modW;
  });
}

export function drawLabel(doc: Doc, x: number, y: number, e: EtiquetaExemplar) {
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(doc.splitTextToSize(e.unidade, LABEL_W - 4)[0] ?? "", x + LABEL_W / 2, y + Y_UNIDADE, {
    align: "center",
  });

  drawBarcode(doc, x + 3, y + Y_BARRAS, LABEL_W - 6, e.codigo);

  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.text(formatarCodigoExemplar(e.codigo), x + LABEL_W / 2, y + Y_CODIGO, { align: "center" });

  const esquerda = x + MARGEM_TEXTO;
  const largura = LABEL_W - 2 * MARGEM_TEXTO;
  const medir: Medir = (t) => doc.getTextWidth(t);
  let linhaY = y + Y_TEXTO;

  const larguraTitulo = rotulo(doc, esquerda, linhaY, "Título: ");
  const linhasTitulo = quebrarLinhas(e.titulo, [largura - larguraTitulo, largura], medir);
  linhasTitulo.forEach((linha, i) => {
    doc.text(linha, i === 0 ? esquerda + larguraTitulo : esquerda, linhaY);
    if (i < linhasTitulo.length - 1) linhaY += ENTRELINHA;
  });

  const autor = (e.autor ?? "").trim();
  if (autor) {
    linhaY += ENTRELINHA;
    const larguraAutor = rotulo(doc, esquerda, linhaY, "Autor: ");
    doc.text(
      cortarComReticencias(autor, largura - larguraAutor, medir),
      esquerda + larguraAutor,
      linhaY,
    );
  }
}

export async function gerarEtiquetasPdf(etiquetas: EtiquetaExemplar[], fileName: string) {
  if (etiquetas.length === 0) return;
  const { jsPDF } = await import("jspdf");

  if (etiquetas.length === 1) {
    const doc = new jsPDF({ unit: "mm", format: [LABEL_W, LABEL_H], orientation: "landscape" });
    drawLabel(doc, 0, 0, etiquetas[0]);
    doc.save(fileName);
    return;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cols = Math.floor((pageW - 10) / LABEL_W);
  const rows = Math.floor((pageH - 10) / LABEL_H);
  const marginX = (pageW - cols * LABEL_W) / 2;
  const marginY = (pageH - rows * LABEL_H) / 2;
  const perPage = cols * rows;

  etiquetas.forEach((e, i) => {
    const idx = i % perPage;
    if (i > 0 && idx === 0) doc.addPage();
    const x = marginX + (idx % cols) * LABEL_W;
    const y = marginY + Math.floor(idx / cols) * LABEL_H;
    doc.setDrawColor(180, 180, 180);
    doc.setLineDashPattern([1, 1], 0);
    doc.rect(x, y, LABEL_W, LABEL_H);
    doc.setLineDashPattern([], 0);
    drawLabel(doc, x, y, e);
  });

  doc.save(fileName);
}
