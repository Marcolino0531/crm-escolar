#!/usr/bin/env node
/*
 * Migração dos planos alimentares contratados do Diário do Aluno (sistema antigo).
 *
 * Lê um CSV com o NOME do aluno, a refeição (meal) e o dia da semana (weekday),
 * cruza com os alunos já importados do Sponte (tabela diario_students) usando o
 * nome como chave, e cria os vínculos em diario_meal_plans.
 *
 * Uso:
 *   node scripts/migrate-diario-planos.cjs <caminho-do-csv> [--dry-run]
 *
 * Requer: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * As refeições válidas são o enum diario_meal_key: breakfast | lunch | snack |
 * dinner (aceita também rótulos em PT: café/almoço/lanche/jantar). O weekday é
 * 0..6 (0=domingo). Nomes ambíguos (mesmo nome normalizado para 2+ alunos) são
 * relatados e pulados. Idempotente: (student_id, meal, weekday) tem UNIQUE, e o
 * upsert usa ignoreDuplicates.
 */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const MEAL_MAP = {
  breakfast: "breakfast",
  lunch: "lunch",
  snack: "snack",
  dinner: "dinner",
  cafe: "breakfast",
  "cafe da manha": "breakfast",
  almoco: "lunch",
  lanche: "snack",
  jantar: "dinner",
};

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
  const mealIdx = pickColumn(header, ["meal", "refeicao", "refeição", "plano"]);
  const wdIdx = pickColumn(header, ["weekday", "dia", "dia_semana", "dia da semana"]);
  if (nameIdx < 0) fail(`não achei a coluna de nome: ${header.join(" | ")}`);
  if (mealIdx < 0) fail(`não achei a coluna de refeição: ${header.join(" | ")}`);
  if (wdIdx < 0) fail(`não achei a coluna de dia da semana: ${header.join(" | ")}`);
  console.log(
    `Colunas → nome: "${header[nameIdx]}" | refeição: "${header[mealIdx]}" | dia: "${header[wdIdx]}"`,
  );

  const entries = [];
  const mealDesconhecida = new Set();
  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][nameIdx] || "").trim();
    const meal = MEAL_MAP[norm(rows[i][mealIdx])];
    const weekday = parseInt((rows[i][wdIdx] || "").trim(), 10);
    if (!name) continue;
    if (!meal) {
      mealDesconhecida.add(rows[i][mealIdx]);
      continue;
    }
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    entries.push({ name, meal, weekday });
  }
  console.log(`Linhas de plano válidas no CSV: ${entries.length}`);

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

  // ── 3. Resolve os student_id e monta as linhas de plano. ──
  const planRows = [];
  const semMatch = new Set();
  const ambiguos = new Set();
  const alunosComPlano = new Set();
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
    planRows.push({ student_id: matches[0].id, meal: e.meal, weekday: e.weekday });
    alunosComPlano.add(matches[0].id);
  }

  let inserted = 0;
  if (!dryRun && planRows.length > 0) {
    // Upsert em lotes; UNIQUE(student_id, meal, weekday) garante idempotência.
    for (let i = 0; i < planRows.length; i += 500) {
      const batch = planRows.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from("diario_meal_plans")
        .upsert(batch, { onConflict: "student_id,meal,weekday", ignoreDuplicates: true });
      if (upErr) fail(`falha ao inserir planos: ${upErr.message}`);
      inserted += batch.length;
    }
  }

  console.log("\n──────── RESUMO ────────");
  console.log(`${dryRun ? "[DRY-RUN] " : ""}Vínculos de plano processados: ${planRows.length}`);
  console.log(`Alunos com plano associado: ${alunosComPlano.size}`);
  console.log(`Sem correspondência no banco: ${semMatch.size}`);
  console.log(`Nomes ambíguos (pulados): ${ambiguos.size}`);
  if (mealDesconhecida.size)
    console.log(`Refeições não reconhecidas: ${[...mealDesconhecida].join(", ")}`);
  if (semMatch.size) console.log(`\nSem match:\n  - ${[...semMatch].join("\n  - ")}`);
  if (ambiguos.size) console.log(`\nAmbíguos:\n  - ${[...ambiguos].join("\n  - ")}`);
}

main().catch((e) => fail(e.message));
