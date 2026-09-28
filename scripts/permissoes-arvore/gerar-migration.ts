// Gera o SQL da migration de correspondência legado → árvore a partir de
// src/lib/permissoes-arvore.ts (mesma regra de `migrarLinhasLegadas`).
//
//   npx tsx scripts/permissoes-arvore/gerar-migration.ts enum   > (ADD VALUE por folha)
//   npx tsx scripts/permissoes-arvore/gerar-migration.ts copia  > (INSERT por folha)
import { CHAVES_LEGADAS, FOLHAS_PERMISSAO, type ExpressaoLegada } from "../../src/lib/permissoes-arvore";

const modo = process.argv[2];

function sqlView(expr: ExpressaoLegada): string {
  return expr
    .map((grupo) => grupo.map((c) => `(l.ver_${c})`).join(" AND "))
    .map((g) => `(${g})`)
    .join(" OR ");
}

function sqlEdit(expr: ExpressaoLegada): string {
  return expr
    .map((grupo) => grupo.map((c) => `(l.edit_${c})`).join(" AND "))
    .map((g) => `(${g})`)
    .join(" OR ");
}

if (modo === "enum") {
  for (const f of FOLHAS_PERMISSAO) {
    if ((CHAVES_LEGADAS as readonly string[]).includes(f.chave)) continue;
    console.log(`ALTER TYPE public.app_module ADD VALUE IF NOT EXISTS '${f.chave}';`);
  }
} else if (modo === "copia") {
  // Uma linha por usuário com uma coluna booleana por chave legada (ver_x / edit_x).
  const cols = CHAVES_LEGADAS.flatMap((c) => [
    `    bool_or(module = '${c}' AND (can_view OR can_edit)) AS ver_${c}`,
    `    bool_or(module = '${c}' AND can_edit) AS edit_${c}`,
  ]);
  console.log("WITH legado AS (");
  console.log("  SELECT user_id,");
  console.log(cols.join(",\n"));
  console.log("  FROM public.user_permissions");
  console.log("  GROUP BY user_id");
  console.log("), novas AS (");
  const selects: string[] = [];
  for (const f of FOLHAS_PERMISSAO) {
    if (!f.legado) continue;
    if ((CHAVES_LEGADAS as readonly string[]).includes(f.chave)) continue;
    const ver = `COALESCE(${sqlView(f.legado.ver)}, false)`;
    const edit = `COALESCE(${sqlEdit(f.legado.editar)}, false)`;
    selects.push(
      `  SELECT l.user_id, '${f.chave}'::public.app_module AS module,\n` +
        `         ${ver} AS can_view,\n` +
        `         (${ver}) AND (${edit}) AS can_edit\n` +
        `  FROM legado l`,
    );
  }
  console.log(selects.join("\n  UNION ALL\n"));
  console.log(")");
  console.log("INSERT INTO public.user_permissions (user_id, module, can_view, can_edit)");
  console.log("SELECT user_id, module, can_view OR can_edit, can_edit FROM novas");
  console.log("WHERE can_view OR can_edit");
  console.log("ON CONFLICT (user_id, module) DO NOTHING;");
} else {
  console.error("uso: gerar-migration.ts enum|copia");
  process.exit(1);
}
