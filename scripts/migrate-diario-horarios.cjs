#!/usr/bin/env node
/*
 * Migração dos horários (escala de entrada/saída) do Diário do Aluno.
 *
 * Complementa a migração de planos: usa o MESMO CSV (nome do aluno, meal,
 * weekday) para preencher a tabela diario_schedules — 1 linha por (aluno, dia
 * da semana) com horário de entrada e saída.
 *
 * Como o CSV não traz a hora exata, derivamos horários padrão por refeição
 * (breakfast=08:00, lunch=12:00, snack=15:00, dinner=18:00). Para cada aluno em
 * cada dia da semana, a ENTRADA é o horário da primeira refeição contratada e a
 * SAÍDA é o da última.
 *
 * Uso:
 *   node scripts/migrate-diario-horarios.cjs <caminho-do-csv> [--dry-run]
 *
 * Requer: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotente: diario_schedules tem UNIQUE(student_id, weekday); o upsert
 * atualiza entrada/saída. Nomes ambíguos são pulados e relatados.
 */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

// Horário padrão por refeição (o CSV não tem hora exata).
const MEAL_TIME = {
  breakfast: "08:00",
  lunch: "12:00",
  snack: "15:00",
  dinner: "18:00",
};

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

  // ── 2. Agrupa por (nome, weekday) coletando os horários das refeições. ──
  // chave: `${nomeNormalizado}|${weekday}` → { name, weekday, times: Set }
  const byNameWeekday = new Map();
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
    const time = MEAL_TIME[meal];
    if (!time) continue;
    const key = `${norm(name)}|${weekday}`;
    const cur = byNameWeekday.get(key) || { name, weekday, times: new Set() };
    cur.times.add(time);
    byNameWeekday.set(key, cur);
  }
  console.log(`Combinações aluno×dia no CSV: ${byNameWeekday.size}`);

  // ── 3. Índice de alunos por nome normalizado. ──
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

  // ── 4. Monta as linhas de escala (entrada = 1ª refeição, saída = última). ──
  const scheduleRows = [];
  const semMatch = new Set();
  const ambiguos = new Set();
  const alunosComEscala = new Set();
  for (const { name, weekday, times } of byNameWeekday.values()) {
    const matches = byName.get(norm(name)) || [];
    if (matches.length === 0) {
      semMatch.add(name);
      continue;
    }
    if (matches.length > 1) {
      ambiguos.add(name);
      continue;
    }
    const sorted = [...times].sort();
    scheduleRows.push({
      student_id: matches[0].id,
      weekday,
      entry: sorted[0],
      exit: sorted[sorted.length - 1],
    });
    alunosComEscala.add(matches[0].id);
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
  console.log(`${dryRun ? "[DRY-RUN] " : ""}Agendamentos (aluno×dia) criados: ${scheduleRows.length}`);
  console.log(`Alunos com escala definida: ${alunosComEscala.size}`);
  console.log(`Sem correspondência no banco: ${semMatch.size}`);
  console.log(`Nomes ambíguos (pulados): ${ambiguos.size}`);
  if (mealDesconhecida.size)
    console.log(`Refeições não reconhecidas: ${[...mealDesconhecida].join(", ")}`);
  if (semMatch.size) console.log(`\nSem match:\n  - ${[...semMatch].join("\n  - ")}`);
  if (ambiguos.size) console.log(`\nAmbíguos:\n  - ${[...ambiguos].join("\n  - ")}`);
}

main().catch((e) => fail(e.message));
