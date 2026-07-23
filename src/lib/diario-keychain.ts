// Geração do "chaveiro" em PDF do Diário do Aluno.
//
// Cada arte tem 6 cm × 4 cm com uma linha de dobra pontilhada no centro (3 cm):
//   • lado esquerdo (3×4 cm): QR Code centralizado (id único do aluno);
//   • lado direito (3×4 cm): nome em destaque, turma e a logo do colégio.
// Ao dobrar ao meio vira 3×4 cm e encaixa no chaveiro de acrílico.
//
// Para um único aluno o PDF tem exatamente o tamanho da arte (60×40 mm). Para uma
// turma inteira, os cartões são dispostos numa grade A4 com marcas de corte.

import { buildDiarioQrValue } from "@/lib/diario";

export type KeychainStudent = { id: string; name: string; className: string };

const CARD_W = 60;
const CARD_H = 40;

type Logo = { dataUrl: string; w: number; h: number };

let logoCache: Logo | null | undefined;

// Rasteriza a logo (SVG same-origin) uma vez para reaproveitar em cada cartão.
async function loadLogo(): Promise<Logo | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo"));
    });
    img.src = "/school-hub-logo.svg";
    await loaded;
    const natW = img.naturalWidth || 240;
    const natH = img.naturalHeight || 120;
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = natW * scale;
    canvas.height = natH * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      logoCache = null;
      return null;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    logoCache = { dataUrl: canvas.toDataURL("image/png"), w: natW, h: natH };
  } catch {
    logoCache = null;
  }
  return logoCache;
}

type Doc = import("jspdf").jsPDF;

function drawCard(
  doc: Doc,
  x: number,
  y: number,
  student: KeychainStudent,
  qrDataUrl: string,
  logo: Logo | null,
) {
  // Borda sutil (guia de corte).
  doc.setDrawColor(210);
  doc.setLineWidth(0.1);
  doc.rect(x, y, CARD_W, CARD_H);

  // Linha de dobra pontilhada exatamente no meio (3 cm).
  doc.setDrawColor(150);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(x + CARD_W / 2, y, x + CARD_W / 2, y + CARD_H);
  doc.setLineDashPattern([], 0);

  // Lado esquerdo: QR centralizado no quadrante 30×40.
  const qrSize = 28;
  const qrX = x + (CARD_W / 2 - qrSize) / 2;
  const qrY = y + (CARD_H - qrSize) / 2;
  doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

  // Lado direito: logo (topo), nome em destaque e turma.
  const rcx = x + CARD_W * 0.75;
  const halfW = CARD_W / 2 - 5;
  let cursorY = y + 5;
  if (logo) {
    const lw = 14;
    const lh = (lw * logo.h) / logo.w;
    doc.addImage(logo.dataUrl, "PNG", rcx - lw / 2, cursorY, lw, lh);
    cursorY += lh + 3;
  }

  doc.setFont("helvetica", "bold");
  doc.setTextColor(20);
  doc.setFontSize(11);
  const nameLines = doc.splitTextToSize(student.name, halfW) as string[];
  doc.text(nameLines, rcx, cursorY, { align: "center", baseline: "top" });
  cursorY += nameLines.length * 4.6 + 1.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const classLines = doc.splitTextToSize(student.className || "Sem turma", halfW) as string[];
  doc.text(classLines, rcx, cursorY, { align: "center", baseline: "top" });
}

export async function downloadKeychainPdf(students: KeychainStudent[], fileName: string) {
  if (students.length === 0) return;

  const [{ jsPDF }, QRCodeMod] = await Promise.all([import("jspdf"), import("qrcode")]);
  const QRCode = QRCodeMod.default;
  const logo = await loadLogo();

  const single = students.length === 1;
  const doc: Doc = single
    ? new jsPDF({ unit: "mm", format: [CARD_W, CARD_H], compress: true })
    : new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });

  const marginX = single ? 0 : 10;
  const marginY = single ? 0 : 10;
  const cols = single ? 1 : Math.max(1, Math.floor((210 - 2 * marginX) / CARD_W));
  const rows = single ? 1 : Math.max(1, Math.floor((297 - 2 * marginY) / CARD_H));
  const perPage = cols * rows;

  for (let i = 0; i < students.length; i++) {
    const idxOnPage = i % perPage;
    if (i > 0 && idxOnPage === 0) doc.addPage();
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = single ? 0 : marginX + col * CARD_W;
    const y = single ? 0 : marginY + row * CARD_H;

    const qrDataUrl = await QRCode.toDataURL(buildDiarioQrValue(students[i].id), {
      margin: 0,
      width: 320,
    });
    drawCard(doc, x, y, students[i], qrDataUrl, logo);
  }

  doc.save(fileName);
}

export function sanitizeFileName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
