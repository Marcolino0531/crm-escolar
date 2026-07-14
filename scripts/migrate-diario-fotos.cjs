#!/usr/bin/env node
/*
 * Migração das fotos dos alunos do Diário do Aluno (resgate do Lovable).
 *
 * Lê um CSV exportado do Lovable com o NOME do aluno e a URL da foto, cruza com
 * os alunos já importados do Sponte (tabela diario_students) usando o nome como
 * chave, baixa a imagem da URL e sobe para o bucket público `diario-fotos` do
 * Supabase, gravando a URL pública em diario_students.photo.
 *
 * Uso:
 *   node scripts/migrate-diario-fotos.cjs <caminho-do-csv> [--dry-run]
 *
 * Requer as variáveis de ambiente:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * O matching por nome é tolerante (sem acento, caixa baixa, espaços colapsados).
 * Nomes ambíguos (mesmo nome normalizado para 2+ alunos) são relatados e
 * pulados por segurança, para não vincular a foto ao aluno errado.
 */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const BUCKET = "diario-fotos";

function fail(msg) {
  console.error(`ERRO: ${msg}`);
  process.exit(1);
}

// Normaliza um nome para comparação (sem acento, minúsculo, espaços colapsados).
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Parser CSV mínimo com suporte a campos entre aspas e vírgula/;.
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
  // Detecta delimitador pela primeira linha (vírgula vs ponto-e-vírgula).
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
  // Busca por inclusão (ex.: "url da foto").
  for (let i = 0; i < h.length; i++) {
    if (candidates.some((cand) => h[i].includes(norm(cand)))) return i;
  }
  return -1;
}

function extFromContentType(ct, url) {
  if (ct) {
    if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
    if (ct.includes("png")) return "png";
    if (ct.includes("webp")) return "webp";
    if (ct.includes("gif")) return "gif";
    if (ct.includes("svg")) return "svg";
  }
  const m = String(url)
    .split("?")[0]
    .match(/\.(jpe?g|png|webp|gif|svg)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath)
    fail("informe o caminho do CSV. Ex.: node scripts/migrate-diario-fotos.cjs fotos.csv");
  if (!fs.existsSync(csvPath)) fail(`arquivo não encontrado: ${csvPath}`);

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) fail("defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Lê o CSV e identifica as colunas de nome e URL da foto. ──
  const rows = parseCSV(fs.readFileSync(csvPath, "utf8"));
  if (rows.length < 2) fail("CSV vazio ou sem linhas de dados.");
  const header = rows[0];
  const nameIdx = pickColumn(header, [
    "nome",
    "name",
    "aluno",
    "nome do aluno",
    "student",
    "nome_aluno",
  ]);
  const photoIdx = pickColumn(header, [
    "foto",
    "photo",
    "photo_url",
    "url",
    "url da foto",
    "foto_url",
    "imagem",
    "image",
  ]);
  if (nameIdx < 0) fail(`não achei a coluna de nome no cabeçalho: ${header.join(" | ")}`);
  if (photoIdx < 0) fail(`não achei a coluna de foto/URL no cabeçalho: ${header.join(" | ")}`);
  console.log(`Colunas detectadas → nome: "${header[nameIdx]}" | foto: "${header[photoIdx]}"`);

  const csvEntries = [];
  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][nameIdx] || "").trim();
    const url = (rows[i][photoIdx] || "").trim();
    if (!name || !url) continue;
    csvEntries.push({ name, url });
  }
  console.log(`Linhas com nome + URL no CSV: ${csvEntries.length}`);

  // ── 2. Carrega os alunos do banco e monta o índice por nome normalizado. ──
  const { data: students, error } = await supabase
    .from("diario_students")
    .select("id, name, photo");
  if (error) fail(`falha ao ler diario_students: ${error.message}`);
  const byName = new Map();
  for (const s of students) {
    const key = norm(s.name);
    const arr = byName.get(key) || [];
    arr.push(s);
    byName.set(key, arr);
  }
  console.log(`Alunos no banco: ${students.length}`);

  // ── 3. Cruza, baixa e sobe. ──
  let ok = 0;
  const semMatch = [];
  const ambiguos = [];
  const falhas = [];

  for (const entry of csvEntries) {
    const matches = byName.get(norm(entry.name)) || [];
    if (matches.length === 0) {
      semMatch.push(entry.name);
      continue;
    }
    if (matches.length > 1) {
      ambiguos.push(entry.name);
      continue;
    }
    const student = matches[0];

    if (dryRun) {
      ok++;
      continue;
    }

    try {
      const resp = await fetch(entry.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ct = resp.headers.get("content-type") || "";
      const buf = Buffer.from(await resp.arrayBuffer());
      const ext = extFromContentType(ct, entry.url);
      const path = `${student.id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, { upsert: true, contentType: ct || `image/${ext}` });
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updErr } = await supabase
        .from("diario_students")
        .update({ photo: publicUrl })
        .eq("id", student.id);
      if (updErr) throw new Error(`update: ${updErr.message}`);

      ok++;
      console.log(`✓ ${student.name} → ${publicUrl}`);
    } catch (e) {
      falhas.push(`${entry.name}: ${e.message}`);
    }
  }

  console.log("\n──────── RESUMO ────────");
  console.log(`${dryRun ? "[DRY-RUN] " : ""}Fotos vinculadas: ${ok}`);
  console.log(`Sem correspondência no banco: ${semMatch.length}`);
  console.log(`Nomes ambíguos (pulados): ${ambiguos.length}`);
  console.log(`Falhas de download/upload: ${falhas.length}`);
  if (semMatch.length) console.log(`\nSem match:\n  - ${semMatch.join("\n  - ")}`);
  if (ambiguos.length) console.log(`\nAmbíguos:\n  - ${ambiguos.join("\n  - ")}`);
  if (falhas.length) console.log(`\nFalhas:\n  - ${falhas.join("\n  - ")}`);
}

main().catch((e) => fail(e.message));
