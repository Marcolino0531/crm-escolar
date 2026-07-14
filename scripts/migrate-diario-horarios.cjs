#!/usr/bin/env node
/*
 * Migração dos horários de ENTRADA/SAÍDA (check-in/check-out) do Diário do Aluno.
 *
 * Lê o CSV horarios_entrada_saida.csv (nome do aluno, weekday, check_in_time,
 * check_out_time) e preenche diario_schedules — 1 linha por (aluno, dia da
 * semana) com o horário real de entrada e saída contratado. São esses dados que
 * o sistema usa para calcular a cobrança de horas extras.
 *
 * IMPORTANTE: estes horários NÃO têm relação com as refeições. As refeições
 * ficam em diario_meal_plans (apenas a associação refeição × dia, sem hora).
 *
 * Uso:
 *   node scripts/migrate-diario-horarios.cjs <caminho-do-csv> [--dry-run] [--purge]
 *
 * --purge  apaga TODAS as linhas de diario_schedules antes de repopular
 *          (usado para limpar dados incorretos de importações anteriores).
 *
 * Requer: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotente: diario_schedules tem UNIQUE(student_id, weekday); o upsert
 * atualiza entrada/saída. Nomes ambíguos são pulados e relatados.
 */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function fail(msg) {
  console.error(`ERRO: ${msg}`);
  process.exit(1);
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Normaliza "8:5" → "08:05", "08:15:00" → "08:15".
function normTime(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || "").trim());
  if (!m) return null;
  const hh = String(Math.min(23, parseInt(m[1], 10))).padStart(2, "0");
  return `${hh}:${m[2]}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  const firstLine = text.split(/\r?\n/)[0] || "";
  const delim = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      pushField();
    } else if (c === "\n") {
      pushField();
      pushRow();
    } else if (c === "\r") {
      // ignora
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function pickColumn(header, candidates) {
  const h = header.map((x) => norm(x));
  for (const cand of candidates) {
    const idx = h.indexOf(norm(cand));
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < h.length; i++) {
    if (candidates.some((cand) => h[i].includes(norm(cand)))) return i;
  }
  return -1;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const purge = args.includes("--purge");
  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath) fail("informe o caminho do CSV.");
  if (!fs.existsSync(csvPath)) fail(`arquivo não encontrado: ${csvPath}`);

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) fail("defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Lê o CSV. ──
  const rows = parseCSV(fs.readFileSync(csvPath, "utf8"));
  if (rows.length < 2) fail("CSV vazio ou sem linhas de dados.");
  const header = rows[0];
  const nameIdx = pickColumn(header, ["student_name", "nome", "name", "aluno", "nome do aluno"]);
  const wdIdx = pickColumn(header, ["weekday", "dia", "dia_semana", "dia da semana"]);
  const inIdx = pickColumn(header, ["check_in_time", "check_in", "entrada", "entry", "checkin"]);
  const outIdx = pickColumn(header, ["check_out_time", "check_out", "saida", "saída", "exit", "checkout"]);
  if (nameIdx < 0) fail(`não achei a coluna de nome: ${header.join(" | ")}`);
  if (wdIdx < 0) fail(`não achei a coluna de dia da semana: ${header.join(" | ")}`);
  if (inIdx < 0) fail(`não achei a coluna de entrada: ${header.join(" | ")}`);
  if (outIdx < 0) fail(`não achei a coluna de saída: ${header.join(" | ")}`);
  console.log(
    `Colunas → nome: "${header[nameIdx]}" | dia: "${header[wdIdx]}" | entrada: "${header[inIdx]}" | saída: "${header[outIdx]}"`,
  );

  const entries = [];
  let horaInvalida = 0;
  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][nameIdx] || "").trim();
    const weekday = parseInt((rows[i][wdIdx] || "").trim(), 10);
    const entry = normTime(rows[i][inIdx]);
    const exit = normTime(rows[i][outIdx]);
    if (!name) continue;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!entry || !exit) {
      horaInvalida++;
      continue;
    }
    entries.push({ name, weekday, entry, exit });
  }
  console.log(`Linhas de horário válidas no CSV: ${entries.length}`);

  // ── 2. Índice de alunos por nome normalizado. ──
  const { data: students, error } = await supabase.from("diario_students").select("id, name");
  if (error) fail(`falha ao ler diario_students: ${error.message}`);
  const byName = new Map();
  for (const s of students) {
    const key = norm(s.name);
    const arr = byName.get(key) || [];
    arr.push(s);
    byName.set(key, arr);
  }
  console.log(`Alunos no banco: ${students.length}`);

  // ── 3. Resolve os student_id e monta as linhas de escala. ──
  const scheduleRows = [];
  const semMatch = new Set();
  const ambiguos = new Set();
  const alunosComEscala = new Set();
  for (const e of entries) {
    const matches = byName.get(norm(e.name)) || [];
    if (matches.length === 0) {
      semMatch.add(e.name);
      continue;
    }
    if (matches.length > 1) {
      ambiguos.add(e.name);
      continue;
    }
    scheduleRows.push({
      student_id: matches[0].id,
      weekday: e.weekday,
      entry: e.entry,
      exit: e.exit,
    });
    alunosComEscala.add(matches[0].id);
  }

  // ── 4. (Opcional) limpa a tabela antes de repopular. ──
  if (purge && !dryRun) {
    const { error: delErr } = await supabase
      .from("diario_schedules")
      .delete()
      .not("id", "is", null);
    if (delErr) fail(`falha ao limpar diario_schedules: ${delErr.message}`);
    console.log("diario_schedules limpo (--purge).");
  }

  let inserted = 0;
  if (!dryRun && scheduleRows.length > 0) {
    for (let i = 0; i < scheduleRows.length; i += 500) {
      const batch = scheduleRows.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from("diario_schedules")
        .upsert(batch, { onConflict: "student_id,weekday" });
      if (upErr) fail(`falha ao inserir escalas: ${upErr.message}`);
      inserted += batch.length;
    }
  }

  console.log("\n──────── RESUMO ────────");
  console.log(`${dryRun ? "[DRY-RUN] " : ""}Horários (aluno×dia) gravados: ${scheduleRows.length}`);
  console.log(`Alunos com escala definida: ${alunosComEscala.size}`);
  console.log(`Sem correspondência no banco: ${semMatch.size}`);
  console.log(`Nomes ambíguos (pulados): ${ambiguos.size}`);
  if (horaInvalida) console.log(`Linhas com hora inválida (ignoradas): ${horaInvalida}`);
  if (semMatch.size) console.log(`\nSem match:\n  - ${[...semMatch].join("\n  - ")}`);
  if (ambiguos.size) console.log(`\nAmbíguos:\n  - ${[...ambiguos].join("\n  - ")}`);
}

main().catch((e) => fail(e.message));
