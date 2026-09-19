// Etiquetas em PDF com o código de barras (Code 128) dos exemplares da
// Biblioteca, prontas para imprimir e colar na contracapa.
//
// Cada etiqueta tem 50 mm × 25 mm: nome da unidade em cima, barras no meio e
// o código legível + título abaixo. Uma etiqueta = PDF do tamanho exato; várias
// = grade A4 (4 colunas × 11 linhas) com marcas de corte, mesmo espírito do
// chaveiro do Diário (diario-keychain.ts).

import { code128Modules } from "@/lib/code128";
import { formatarCodigoExemplar } from "@/lib/biblioteca";

export type EtiquetaExemplar = {
  codigo: string;
  titulo: string;
  unidade: string;
};

const LABEL_W = 50;
const LABEL_H = 25;
const BAR_H = 10;

type Doc = import("jspdf").jsPDF;

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

function drawLabel(doc: Doc, x: number, y: number, e: EtiquetaExemplar) {
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(doc.splitTextToSize(e.unidade, LABEL_W - 4)[0] ?? "", x + LABEL_W / 2, y + 3.5, {
    align: "center",
  });

  drawBarcode(doc, x + 3, y + 5, LABEL_W - 6, e.codigo);

  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.text(formatarCodigoExemplar(e.codigo), x + LABEL_W / 2, y + 18.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  const linha = doc.splitTextToSize(e.titulo, LABEL_W - 4)[0] ?? "";
  doc.text(linha, x + LABEL_W / 2, y + 22.5, { align: "center" });
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
