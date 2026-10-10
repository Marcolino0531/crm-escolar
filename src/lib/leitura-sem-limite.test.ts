// Trava estrutural do teto de 1000 linhas do PostgREST: o Supabase corta a
// resposta em 1000 linhas SEM erro. Toda leitura `.from(...).select(...)` em
// src/lib, src/routes e src/components precisa de uma destas formas:
//   - dentro de `selectAll(...)`/`fetchAllRows(...)` (src/lib/supabase-paginate.ts);
//   - `.range()`, `.single()`, `.maybeSingle()` ou contagem com `head: true`;
//   - `.limit(N)` com o comentário `// limite-intencional: <motivo>` na linha
//     do `.limit` ou logo acima da consulta.
// Regra completa: .agents/skills/leitura-sem-limite-crm-escolar/SKILL.md
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZES = ["src/lib", "src/routes", "src/components"];

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivos(p));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) out.push(p);
  }
  return out;
}

const ABRE = "([{";
const FECHA = ")]}";

// Pula string/template literal a partir de `i` (aspas de abertura); devolve o
// índice logo depois do fechamento.
function pularString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") j += 2;
    else if (src[j] === q) return j + 1;
    else if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
      j = fimDoGrupo(src, j + 1) + 1;
    } else j++;
  }
  return j;
}

// Pula comentário `//` ou `/* */` a partir de `i`; devolve `i` se não houver.
function pularComentario(src: string, i: number): number {
  if (src[i] !== "/") return i;
  if (src[i + 1] === "/") {
    const fim = src.indexOf("\n", i);
    return fim < 0 ? src.length : fim;
  }
  if (src[i + 1] === "*") {
    const fim = src.indexOf("*/", i + 2);
    return fim < 0 ? src.length : fim + 2;
  }
  return i;
}

// Índice do fechamento do grupo que abre em `i`.
function fimDoGrupo(src: string, i: number): number {
  let prof = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      j = pularString(src, j);
      continue;
    }
    const k = pularComentario(src, j);
    if (k !== j) {
      j = k;
      continue;
    }
    if (ABRE.includes(c)) prof++;
    else if (FECHA.includes(c)) {
      prof--;
      if (prof === 0) return j;
    }
    j++;
  }
  return j;
}

// Cadeia de métodos que começa em `.from(`: termina no `;`/`,` de nível zero,
// no fechamento do grupo que a contém ou numa quebra de linha que não continua
// com `.metodo`.
function cadeia(src: string, i: number): string {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      j = pularString(src, j);
      continue;
    }
    if (ABRE.includes(c)) {
      j = fimDoGrupo(src, j) + 1;
      continue;
    }
    const k = pularComentario(src, j);
    if (k !== j) {
      j = k;
      continue;
    }
    if (FECHA.includes(c) || c === ";" || c === ",") break;
    if (c === "\n" && !/^(\s*\/\/[^\n]*\n)*\s*(\?\.|\.)/.test(src.slice(j + 1, j + 400))) break;
    j++;
  }
  return src.slice(i, j);
}

// A consulta está dentro do argumento de `selectAll(...)`/`fetchAllRows(...)`?
function dentroDePaginacao(src: string, i: number): boolean {
  const re = /\b(selectAll|selectAllResult|fetchAllRows)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && m.index < i) {
    let j = m.index + m[0].length;
    if (src[j] === "<") {
      let prof = 0;
      for (; j < src.length; j++) {
        if (src[j] === "<") prof++;
        else if (src[j] === ">" && src[j - 1] !== "=" && --prof === 0) break;
      }
      j++;
    }
    while (/\s/.test(src[j])) j++;
    if (src[j] !== "(") continue;
    if (fimDoGrupo(src, j) > i) return true;
  }
  return false;
}

// Construtor guardado em variável e tratado depois (`q.range(...)`,
// `fetchAllRows(q...)`, `q.limit(...)`).
function usoDaVariavel(src: string, i: number, trecho: string): "paginada" | "limitada" | null {
  const antes = src.slice(Math.max(0, i - 200), i);
  const m = /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]+\s*$/.exec(antes);
  if (!m) return null;
  const v = m[1];
  const depois = src.slice(i + trecho.length, i + trecho.length + 4000);
  if (
    new RegExp(
      `\\b${v}\\b[\\s\\S]{0,400}?\\.(range|single|maybeSingle)\\s*[<(]|fetchAllRows\\(\\s*${v}\\b|(selectAll|selectAllResult|fetchAllRows)[\\s\\S]{0,80}\\b${v}\\b`,
    ).test(depois)
  )
    return "paginada";
  if (new RegExp(`\\b${v}\\b[\\s\\S]{0,400}?\\.limit\\(`).test(depois)) return "limitada";
  return null;
}

// Linha onde começa a instrução da consulta (`const { data } = await supabase`
// quando o `.from(` vem na linha seguinte) e o bloco de comentários logo acima.
function comentariosAcima(linhas: string[], linhaFrom: number): string {
  let i = linhaFrom - 1;
  while (i > 0 && /^\s*(\?\.|\.)/.test(linhas[i])) i--;
  const bloco = [linhas[i]];
  for (let j = i - 1; j >= 0 && /^\s*(\/\/|\/?\*)/.test(linhas[j]); j--) bloco.push(linhas[j]);
  return bloco.join("\n");
}

export type LeituraSemLimite = { arquivo: string; linha: number; trecho: string };

export function leiturasSemLimiteNaFonte(src: string, arquivo: string): LeituraSemLimite[] {
  const achados: LeituraSemLimite[] = [];
  const linhas = src.split("\n");
  const re = /\.from\(\s*["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (
      /\b(Array|Buffer|Uint8Array|Object)\s*$/.test(src.slice(Math.max(0, m.index - 20), m.index))
    )
      continue;
    const trecho = cadeia(src, m.index);
    if (!/\.select\(/.test(trecho)) continue;
    if (/\.(insert|update|upsert|delete)\(/.test(trecho)) continue;
    if (/\.(single|maybeSingle|range)\s*[<(]/.test(trecho)) continue;
    if (/head:\s*true/.test(trecho)) continue;
    if (dentroDePaginacao(src, m.index)) continue;
    const uso = usoDaVariavel(src, m.index, trecho);
    if (uso === "paginada") continue;
    const linha = src.slice(0, m.index).split("\n").length;
    const comentarios = comentariosAcima(linhas, linha) + "\n" + trecho;
    if (/leitura-restrita:\s*\S/.test(comentarios)) continue;
    const limitada = uso === "limitada" || /\.limit\(/.test(trecho);
    if (limitada && /limite-intencional:\s*\S/.test(comentarios)) continue;
    achados.push({ arquivo, linha, trecho: trecho.replace(/\s+/g, " ").slice(0, 160) });
  }
  return achados;
}

export function leiturasSemLimite(raiz = process.cwd()): LeituraSemLimite[] {
  return RAIZES.flatMap((base) =>
    arquivos(join(raiz, base)).flatMap((f) =>
      leiturasSemLimiteNaFonte(readFileSync(f, "utf8"), relative(raiz, f)),
    ),
  );
}

describe("leitura sem limite (teto de 1000 linhas do PostgREST)", () => {
  it("nenhuma leitura de lista depende do limite padrão do Supabase", () => {
    const achados = leiturasSemLimite();
    expect(
      achados.map((a) => `${a.arquivo}:${a.linha}  ${a.trecho}`),
      "Use selectAll/fetchAllRows, agregue no banco (count/head) ou justifique: // limite-intencional: <motivo> (com .limit) ou // leitura-restrita: <motivo>",
    ).toEqual([]);
  });

  const achar = (src: string) => leiturasSemLimiteNaFonte(src, "x.ts").map((a) => a.linha);

  it("aponta leitura de lista sem paginação, inclusive com .limit sem motivo", () => {
    expect(
      achar(`const { data } = await supabase
  .from("tasks")
  .select("id")
  .order("id");
const r = await supabase.from("tasks").select("id").limit(50);
let q = supabase.from("tasks").select("id");
if (x) q = q.eq("a", 1);
const { data: d2 } = await q;`),
    ).toEqual([2, 5, 6]);
  });

  it("aceita as formas permitidas", () => {
    expect(
      achar(`const a = await selectAll(() => supabase.from("tasks").select("id").order("id"));
const b = await selectAllResult<T>(() => {
  let q = supabase.from("tasks").select("id").order("id");
  if (x) q = q.eq("a", 1);
  return q;
});
const c = await fetchAllRows((f, t) => supabase.from("tasks").select("id").order("id").range(f, t));
const d = await supabase.from("tasks").select("id").eq("id", id).maybeSingle<Row>();
const e = await supabase.from("tasks").select("id", { count: "exact", head: true });
// limite-intencional: últimas 30 notificações
const f = await supabase.from("tasks").select("id").order("created_at").limit(30);
// leitura-restrita: filtrada por caso_id
const { data: g } = await supabase
  .from("cobranca_anexos")
  .select("id")
  .eq("caso_id", casoId);
await supabase.from("tasks").update({ a: 1 }).eq("id", id).select("id");
const h = Array.from("abc");`),
    ).toEqual([]);
  });

  it("o marcador só vale para a consulta logo abaixo dele", () => {
    expect(
      achar(`// leitura-restrita: filtrada por caso_id
const a = await supabase.from("cobranca_anexos").select("id").eq("caso_id", id);
const b = await supabase.from("tasks").select("id");
// leitura-restrita: sem limite aqui
const c = await supabase.from("tasks").select("id").limit(10);`),
    ).toEqual([3]);
  });
});
