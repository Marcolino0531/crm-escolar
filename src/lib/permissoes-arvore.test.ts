// Trava estrutural da árvore única de permissões (src/lib/permissoes-arvore.ts).
// Falha quando: (a) há rota administrativa em src/routes sem módulo na árvore;
// (b) há aba (TabsTrigger) renderizada fora de AbasArvore; (c) alguma chave usada
// em canView/canEdit, nas checagens do servidor ou em RLS/RPC não existe na
// árvore; (d) há chave duplicada. Ver .agents/skills/permissoes-arvore-crm-escolar.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ARVORE_PERMISSOES,
  CHAVES_LEGADAS,
  FINANCEIRO_DADOS,
  FOLHAS_PERMISSAO,
  MODULOS,
  ehChavePermissao,
  listarNos,
  noPorChave,
} from "./permissoes-arvore";
import {
  alterarNo,
  estadoVazio,
  marcarTodos,
  paginasDoFinanceiro,
} from "./permissoes-arvore-edicao";

const RAIZ = join(__dirname, "..", "..");

/** Rotas públicas (G.6): fora da árvore de permissões. */
const ROTAS_PUBLICAS = [/^\/matricula$/, /^\/portal/, /^\/rematricula/, /verificar/];

/**
 * Abas internas de diálogos que não são páginas do sistema (seções de um
 * formulário modal). Qualquer outro TabsTrigger fora de AbasArvore falha.
 */
const ABAS_INTERNAS_DE_DIALOGO = [
  "src/components/diario/PlanEditor.tsx", // Refeições / Horários do plano do aluno
  "src/components/diario/DiarioManager.tsx", // Alunos / Turmas do modal Gerenciar
];

function arquivos(dir: string, filtro: (f: string) => boolean, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, filtro, acc);
    else if (filtro(caminho)) acc.push(caminho);
  }
  return acc;
}

const FONTES = arquivos(
  join(RAIZ, "src"),
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
);
const ROTAS = arquivos(join(RAIZ, "src", "routes"), (f) => f.endsWith(".tsx"));
const MIGRATIONS_PERMISSAO = arquivos(
  join(RAIZ, "supabase", "migrations"),
  (f) => /permissoes_arvore/.test(f) && f.endsWith(".sql"),
);

function relativo(f: string): string {
  return f.slice(RAIZ.length + 1);
}

describe("árvore de permissões — integridade", () => {
  it("(d) não tem chave duplicada e toda chave é estável (minúsculas, ponto)", () => {
    const vistas = new Set<string>();
    for (const no of listarNos()) {
      expect(vistas.has(no.chave), `chave duplicada: ${no.chave}`).toBe(false);
      vistas.add(no.chave);
      expect(no.chave).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
    }
  });

  it("chave de página é prefixada pela chave do pai", () => {
    for (const no of listarNos()) {
      if (no.tipo === "grupo") continue;
      for (const filho of no.filhos ?? []) {
        expect(
          filho.chave.startsWith(`${no.chave}.`),
          `${filho.chave} deve começar com ${no.chave}.`,
        ).toBe(true);
      }
    }
  });

  it("grupos estão na ordem do menu e todo módulo tem rota", () => {
    expect(ARVORE_PERMISSOES.map((g) => g.nome)).toEqual([
      "Dashboard",
      "Comercial",
      "Pedagógico",
      "Operacional",
      "Financeiro",
      "Configurações",
    ]);
    for (const m of MODULOS) {
      if (m.semRota) expect(m.rota, `módulo semRota com rota: ${m.chave}`).toBeUndefined();
      else expect(m.rota, `módulo sem rota: ${m.chave}`).toMatch(/^\//);
    }
  });

  it("toda folha referencia só chaves legadas conhecidas", () => {
    for (const folha of FOLHAS_PERMISSAO) {
      const expressoes = folha.legado ? [...folha.legado.ver, ...folha.legado.editar] : [];
      for (const alternativa of expressoes) {
        for (const chave of alternativa) {
          expect(CHAVES_LEGADAS, `legado desconhecido em ${folha.chave}: ${chave}`).toContain(
            chave,
          );
        }
      }
    }
  });
});

describe("árvore de permissões — rotas", () => {
  it("(a) toda rota administrativa de src/routes tem módulo na árvore", () => {
    const rotasDeclaradas = ROTAS.flatMap((f) => {
      const m = readFileSync(f, "utf8").match(/createFileRoute\("([^"]+)"\)/);
      return m ? [m[1]] : [];
    });
    const rotasDosModulos = new Set(MODULOS.map((m) => m.rota));
    const semModulo = rotasDeclaradas.filter(
      (r) => !ROTAS_PUBLICAS.some((re) => re.test(r)) && !rotasDosModulos.has(r),
    );
    expect(semModulo, `rotas sem módulo na árvore: ${semModulo.join(", ")}`).toEqual([]);
  });

  it("toda rota de módulo existe em src/routes", () => {
    const rotasDeclaradas = new Set(
      ROTAS.flatMap((f) => {
        const m = readFileSync(f, "utf8").match(/createFileRoute\("([^"]+)"\)/);
        return m ? [m[1]] : [];
      }),
    );
    for (const m of MODULOS.filter((x) => !x.semRota))
      expect(rotasDeclaradas.has(m.rota!), `rota inexistente: ${m.rota}`).toBe(true);
  });
});

describe("árvore de permissões — abas", () => {
  it("(b) nenhuma aba é renderizada fora de AbasArvore", () => {
    const fora = FONTES.filter((f) => {
      const rel = relativo(f);
      if (rel === "src/components/AbasArvore.tsx") return false;
      if (ABAS_INTERNAS_DE_DIALOGO.includes(rel)) return false;
      return /<TabsTrigger[\s>]/.test(readFileSync(f, "utf8"));
    }).map(relativo);
    expect(fora, `TabsTrigger fora da árvore: ${fora.join(", ")}`).toEqual([]);
  });

  it("todo chavePai de AbasArvore/useAbasArvore/useAbaAtiva existe e tem filhos", () => {
    for (const f of FONTES) {
      const src = readFileSync(f, "utf8");
      const usos = [
        ...src.matchAll(/chavePai="([^"]+)"/g),
        ...src.matchAll(/use(?:AbasArvore|AbaAtiva)\("([^"]+)"\)/g),
      ].map((m) => m[1]);
      for (const chave of usos) {
        const no = noPorChave(chave);
        expect(no, `${relativo(f)}: chavePai desconhecida ${chave}`).toBeDefined();
        expect((no?.filhos ?? []).length, `${relativo(f)}: ${chave} não tem abas`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("todo TabsContent sob AbasArvore corresponde a uma aba da árvore", () => {
    for (const f of FONTES) {
      const src = readFileSync(f, "utf8");
      const pais = [...src.matchAll(/chavePai="([^"]+)"/g)].map((m) => m[1]);
      if (pais.length === 0) continue;
      const idsValidos = new Set(
        pais.flatMap((p) => (noPorChave(p)?.filhos ?? []).map((c) => c.chave.split(".").pop()!)),
      );
      for (const m of src.matchAll(/<TabsContent[^>]*\bvalue="([^"]+)"/g)) {
        expect(
          idsValidos.has(m[1]),
          `${relativo(f)}: TabsContent value="${m[1]}" não é aba da árvore`,
        ).toBe(true);
      }
    }
  });
});

describe("árvore de permissões — chaves usadas no código e no banco", () => {
  it("(c) canView/canEdit só usam chaves da árvore", () => {
    for (const f of FONTES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bcan(?:View|Edit)\(\s*"([^"]+)"/g)) {
        expect(
          ehChavePermissao(m[1]),
          `${relativo(f)}: chave fora da árvore em canView/canEdit: ${m[1]}`,
        ).toBe(true);
      }
    }
  });

  it("(c) checagens do servidor só usam chaves da árvore", () => {
    for (const f of FONTES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(
        /(?:temPermissaoPagina|exigirPermissaoPagina)\(\s*[^,]+,\s*\[([^\]]*)\]/g,
      )) {
        for (const chave of m[1].matchAll(/"([^"]+)"/g)) {
          expect(
            ehChavePermissao(chave[1]),
            `${relativo(f)}: chave fora da árvore no servidor: ${chave[1]}`,
          ).toBe(true);
        }
      }
    }
  });

  it("(c) RLS/RPC das migrations de permissão só usam chaves da árvore", () => {
    expect(MIGRATIONS_PERMISSAO.length).toBeGreaterThan(0);
    const padrao =
      /(?:can_view_pagina|can_edit_pagina|pedagogico_pode_editar)\((?:[^()']|\([^()]*\))*?'([^']+)'\s*\)/g;
    for (const f of MIGRATIONS_PERMISSAO) {
      const sql = readFileSync(f, "utf8");
      for (const m of sql.matchAll(padrao)) {
        expect(
          ehChavePermissao(m[1]),
          `${relativo(f)}: chave fora da árvore em RLS/RPC: ${m[1]}`,
        ).toBe(true);
      }
      for (const m of sql.matchAll(/ADD VALUE IF NOT EXISTS '([^']+)'/g)) {
        expect(
          ehChavePermissao(m[1]),
          `${relativo(f)}: valor de enum fora da árvore: ${m[1]}`,
        ).toBe(true);
      }
    }
  });

  it("toda folha gravável tem valor no enum app_module (migration) ou é chave legada", () => {
    const enumSql = MIGRATIONS_PERMISSAO.map((f) => readFileSync(f, "utf8")).join("\n");
    const noEnum = new Set(
      [...enumSql.matchAll(/ADD VALUE IF NOT EXISTS '([^']+)'/g)].map((m) => m[1]),
    );
    for (const folha of FOLHAS_PERMISSAO) {
      const ok =
        noEnum.has(folha.chave) || (CHAVES_LEGADAS as readonly string[]).includes(folha.chave);
      expect(ok, `folha sem valor no enum: ${folha.chave}`).toBe(true);
    }
  });
});

describe("tela de permissões — dependências entre folhas", () => {
  const vazio = () => estadoVazio(false);

  it("Visualizar/Editar em página do Financeiro marca só Visualizar em 'Financeiro: acesso aos dados'", () => {
    const v = alterarNo(vazio(), "extrato", "view", true);
    expect(v[FINANCEIRO_DADOS]).toEqual({ view: true, edit: false });
    const e = alterarNo(vazio(), "inadimplencia", "edit", true);
    expect(e[FINANCEIRO_DADOS]).toEqual({ view: true, edit: false });
    expect(e.inadimplencia).toEqual({ view: true, edit: true });
    const grupo = alterarNo(vazio(), "grupo_financeiro", "edit", true);
    expect(grupo[FINANCEIRO_DADOS]).toEqual({ view: true, edit: true });
    const explicito = alterarNo(e, FINANCEIRO_DADOS, "edit", true);
    expect(explicito[FINANCEIRO_DADOS]).toEqual({ view: true, edit: true });
    expect(paginasDoFinanceiro()).toContain("analises_ia");
    expect(paginasDoFinanceiro()).not.toContain(FINANCEIRO_DADOS);
  });

  it("desmarcar 'Financeiro: acesso aos dados' desmarca todas as páginas do Financeiro", () => {
    const tudo = marcarTodos(true);
    const sem = alterarNo(tudo, FINANCEIRO_DADOS, "view", false);
    for (const c of [FINANCEIRO_DADOS, ...paginasDoFinanceiro()])
      expect(sem[c], c).toEqual({ view: false, edit: false });
    expect(sem["documentos.zapsign"]).toEqual({ view: true, edit: true });
    const soEdit = alterarNo(tudo, FINANCEIRO_DADOS, "edit", false);
    expect(soEdit[FINANCEIRO_DADOS]).toEqual({ view: true, edit: false });
    for (const c of paginasDoFinanceiro()) expect(soEdit[c], c).toEqual({ view: true, edit: true });
  });

  it("Diário: Auditoria ou Faturamento (Visualizar) marca Registro (Visualizar)", () => {
    const a = alterarNo(vazio(), "diario.auditoria", "view", true);
    expect(a["diario.registro"]).toEqual({ view: true, edit: false });
    const f = alterarNo(vazio(), "diario.faturamento", "edit", true);
    expect(f["diario.registro"]).toEqual({ view: true, edit: false });
    const x = alterarNo(vazio(), "diario.extras", "view", true);
    expect(x["diario.registro"]).toEqual({ view: false, edit: false });
  });
});

describe("regras de servidor preservadas (ETAPA 2)", () => {
  const fonte = (f: string) => readFileSync(join(process.cwd(), "src/lib", f), "utf8");

  it("boleto-ai: gravar exige Editar Faturamento OU Editar Financeiro: acesso aos dados", () => {
    const src = fonte("boleto-ai.functions.ts");
    const m = src.match(/exigirPermissaoPagina\(\s*[\s\S]*?\[([^\]]+)\],\s*"editar"/);
    expect(m, "chamada de exigirPermissaoPagina com 'editar'").toBeTruthy();
    const chaves = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    expect(chaves).toEqual(["faturamento", FINANCEIRO_DADOS].sort());
  });

  it("colonia-valores: salvar e excluir exigem Editar Valor Colônia (colonia_financeiro), sem Configurações a mais", () => {
    const src = fonte("colonia-valores.functions.ts");
    expect(src).toMatch(/edicao\s*\?\s*\["configuracoes\.cadastros\.valor_colonia"\]/);
    expect(src).not.toMatch(/"configuracoes\.cadastros"|"configuracoes"\]/);
    expect(src).not.toMatch(/"colonia\.fechamento"[^\n]*"editar"/);
    expect(src.match(/exigirPermissao\(context\.userId, true\)/g)?.length).toBe(2);
    const copia = readFileSync(
      join(process.cwd(), "supabase/migrations/20261119090100_permissoes_arvore_copia.sql"),
      "utf8",
    );
    expect(copia).toMatch(/valor_colonia[\s\S]{0,400}colonia_financeiro/);
  });
});
