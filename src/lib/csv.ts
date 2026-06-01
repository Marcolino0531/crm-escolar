import * as XLSX from "xlsx";

// Format a JS Date as DD/MM/YYYY (no timezone shift since we use UTC getters)
function fmtDateBR(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

// Parse an Excel file (.xlsx/.xls) into the same string[][] shape as parseCSV.
// Uses cellDates:true so real Date cells become JS Date objects, which we then
// format explicitly as DD/MM/YYYY — avoiding US-format ("M/D/YYYY") strings.
export function parseExcel(data: ArrayBuffer): string[][] {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (!firstSheet) return [];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: true,
    defval: "",
  });
  return (aoa as unknown[][])
    .map(row =>
      row.map(c => {
        if (c == null) return "";
        if (c instanceof Date) return fmtDateBR(c);
        return String(c);
      })
    )
    .filter(r => r.some(c => c.trim() !== ""));
}

// Simple CSV parser (handles quoted fields & commas/semicolons)
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let val = "";
  let inQuotes = false;
  // Detect delimiter
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delim = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { val += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { cur.push(val); val = ""; }
      else if (c === "\n") { cur.push(val); rows.push(cur); cur = []; val = ""; }
      else if (c === "\r") { /* ignore */ }
      else { val += c; }
    }
  }
  if (val.length > 0 || cur.length > 0) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

export type ParsedTx = {
  date: string; // ISO YYYY-MM-DD
  description: string;
  amount: number; // always positive
  type: "entrada" | "saida";
};

function parseDate(s: string): string | null {
  s = (s ?? "").trim();
  if (!s) return null;
  // Brazilian DD/MM/YYYY or DD-MM-YYYY — split strictly by "/" or "-"
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
    let [a, b, c] = parts;
    // ISO YYYY-MM-DD (4-digit first) → year, month, day
    if (a.length === 4) {
      const year = Number(a), month = Number(b), day = Number(c);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      // Build safely at noon local — only the date components matter
      const d = new Date(year, month - 1, day, 12, 0, 0, 0);
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    // BR DD/MM/YYYY → day, month, year (strict, never swap)
    const day = Number(a), month = Number(b);
    let year = Number(c);
    if (c.length === 2) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(s: string): number | null {
  if (!s) return null;
  let v = s.replace(/[R$\s]/g, "");
  // Brazilian: 1.234,56 -> 1234.56
  if (v.includes(",") && v.lastIndexOf(",") > v.lastIndexOf(".")) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else {
    v = v.replace(/,/g, "");
  }
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function buildHeader(row: string[]) {
  const header = row.map(norm);
  // Find first column matching ANY of the names (no priority among names)
  const findIdx = (...names: string[]) =>
    header.findIndex(h => h && names.some(n => h.includes(n)));
  // Find column by priority: try each name in order, return first column matching it
  const findIdxPriority = (...names: string[]) => {
    for (const n of names) {
      const idx = header.findIndex(h => h && h.includes(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    header,
    // Priority: "Data de Lançamento" wins over "Data de Movimento" (Caixa) → fallback "Data"
    dateIdx: findIdxPriority("data lancamento", "data de lancamento", "data movimento", "data de movimento", "data"),
    descIdx: findIdx("historico", "descri", "memo", "description"),
    valueIdx: findIdx("valor lancamento", "valor", "amount", "value"),
    typeIdx: findIdx("tipo", "type"),
    clientIdx: findIdx("nome/razao", "razao social", "nome", "cliente", "favorecido"),
  };
}

export function extractTransactions(rows: string[][]): ParsedTx[] {
  if (rows.length === 0) return [];

  // Find the real header row: scan first few rows for one that has a Data + Valor column
  let headerRow = 0;
  let info = buildHeader(rows[0]);
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cand = buildHeader(rows[i]);
    if (cand.dateIdx >= 0 && cand.valueIdx >= 0) {
      headerRow = i;
      info = cand;
      break;
    }
  }

  const { dateIdx, descIdx, valueIdx, typeIdx, clientIdx } = info;
  const dataRows = rows.slice(headerRow + 1);

  const txs: ParsedTx[] = [];
  for (const r of dataRows) {
    const dRaw = dateIdx >= 0 ? r[dateIdx] : r[0];
    const descBase = (descIdx >= 0 ? r[descIdx] : r[1]) ?? "";
    const clientRaw = clientIdx >= 0 ? (r[clientIdx] ?? "").trim() : "";
    const vRaw = valueIdx >= 0 ? r[valueIdx] : r[2];
    const date = parseDate(dRaw ?? "");
    const amt = parseAmount(vRaw ?? "");
    if (!date || amt === null) continue;

    let type: "entrada" | "saida";
    if (typeIdx >= 0 && r[typeIdx]) {
      const t = r[typeIdx].toLowerCase();
      type = t.startsWith("e") || t.includes("cred") || t.includes("rece") ? "entrada" : "saida";
    } else {
      type = amt >= 0 ? "entrada" : "saida";
    }

    const description = clientRaw
      ? `${descBase.trim()} — ${clientRaw}`.replace(/^ — /, "")
      : descBase.trim();

    txs.push({
      date,
      description,
      amount: Math.abs(amt),
      type,
    });
  }
  return txs;
}

