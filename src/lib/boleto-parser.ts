// Parser do PDF de retorno de cobranças (formato Sponte "Situação das Cobranças").
// Roda no client com pdfjs-dist.

import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc as string;

export type BoletoRow = {
  parc: string;
  valor: number;
  dueDate: string;     // ISO yyyy-mm-dd
  payDate: string;     // ISO yyyy-mm-dd
  paidAmount: number;
  sacado: string;
  categoria: string;
};

export type BoletoParseResult = {
  rows: BoletoRow[];
  totalBilled: number;
  totalPaid: number;
  pageCount: number;
};

const HEADER_TOKENS = ["Parc.", "Valor", "Data Venc.", "Data Pagto.", "Valor Pago", "Sacado", "Categoria", "Nº Contrato", "Nº Boleto", "Layout", "Status", "Ocorrência"];

function parseBR(n: string): number {
  return Number(n.replace(/\./g, "").replace(",", "."));
}
function isoFromBR(d: string): string {
  const [dd, mm, yyyy] = d.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
function isDate(s: string) { return /^\d{2}\/\d{2}\/\d{4}$/.test(s); }
function isAmount(s: string) { return /^\d{1,3}(\.\d{3})*,\d{2}$/.test(s) || /^\d+,\d{2}$/.test(s); }

type Item = { str: string; x: number; y: number };

export async function parseBoletoPdf(file: File): Promise<BoletoParseResult> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const rows: BoletoRow[] = [];
  let totalBilled = 0;
  let totalPaid = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = (content.items as unknown[])
      .filter((it): it is { str: string; transform: number[] } =>
        typeof it === "object" && it !== null && "str" in it && "transform" in it,
      )
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter((it) => it.str.trim() !== "");

    // Group by Y (round to nearest pixel band)
    const lines = new Map<number, Item[]>();
    for (const it of items) {
      const key = Math.round(it.y);
      // try to merge with nearby key (±2)
      let bucket = lines.get(key);
      if (!bucket) {
        const near = [...lines.keys()].find((k) => Math.abs(k - key) <= 2);
        if (near !== undefined) bucket = lines.get(near)!;
      }
      if (!bucket) { bucket = []; lines.set(key, bucket); }
      bucket.push(it);
    }

    const lineEntries = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, arr]) => arr.sort((a, b) => a.x - b.x));

    // Find column X positions from header line
    let cols: number[] | null = null;
    for (const line of lineEntries) {
      const joined = line.map((i) => i.str.trim()).join(" ");
      if (HEADER_TOKENS.every((h) => joined.includes(h))) {
        cols = HEADER_TOKENS.map((h) => {
          const found = line.find((i) => i.str.trim().startsWith(h.split(" ")[0]) && joined.indexOf(i.str.trim()) >= 0);
          return found ? found.x : 0;
        });
        break;
      }
    }
    if (!cols) continue;

    // Helper: assign item to nearest column index
    const colIndex = (x: number) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < cols!.length; i++) {
        const d = Math.abs(x - cols![i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    for (const line of lineEntries) {
      // skip header lines
      if (HEADER_TOKENS.some((h) => line.some((i) => i.str.trim() === h))) continue;

      const cells: string[] = Array.from({ length: HEADER_TOKENS.length }, () => "");
      for (const it of line) cells[colIndex(it.x)] = (cells[colIndex(it.x)] + " " + it.str).trim();

      const parc = cells[0]?.trim();
      const valorStr = cells[1]?.trim();
      const dueStr = cells[2]?.trim();
      const payStr = cells[3]?.trim();
      const paidStr = cells[4]?.trim();
      const sacado = cells[5]?.trim();
      const categoria = cells[6]?.trim();

      // Data row check: parc is integer and we have two dates and two amounts
      if (/^\d+$/.test(parc) && isAmount(valorStr) && isDate(dueStr) && isDate(payStr) && isAmount(paidStr) && sacado && categoria) {
        rows.push({
          parc,
          valor: parseBR(valorStr),
          dueDate: isoFromBR(dueStr),
          payDate: isoFromBR(payStr),
          paidAmount: parseBR(paidStr),
          sacado,
          categoria,
        });
        continue;
      }

      // Totals row: large amount in cols 1 and 4 (or only big numbers no dates)
      if (isAmount(valorStr) && isAmount(paidStr) && !isDate(dueStr) && !sacado) {
        totalBilled = parseBR(valorStr);
        totalPaid = parseBR(paidStr);
      }
    }
  }

  // Fallback: compute totals from rows if not detected
  if (totalPaid === 0 && rows.length > 0) {
    totalBilled = rows.reduce((s, r) => s + r.valor, 0);
    totalPaid = rows.reduce((s, r) => s + r.paidAmount, 0);
  }

  return { rows, totalBilled, totalPaid, pageCount: pdf.numPages };
}
