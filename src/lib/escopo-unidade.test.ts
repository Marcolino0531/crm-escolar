// Trava estrutural do escopo por colégio no servidor: supabaseAdmin ignora as
// policies, então toda createServerFn que usa supabaseAdmin precisa chamar a
// função auxiliar de src/lib/unidade-acesso.server.ts (ou allowedSponteUnidades,
// em que ela se apoia, direta ou por um helper que a chame), uma checagem de
// admin, ou ter no corpo o marcador `// escopo-unidade: <motivo>`.
// PENDENCIAS lista o que ainda falta (Envio 32, parte 3); a lista só encolhe.
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

interface Bloco {
  arquivo: string;
  nome: string | null;
  texto: string;
}

const INICIO = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\b/;
const NOME =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|class\s+)(\w+)/;

// Divide o arquivo em declarações de topo (linhas na coluna 0).
function blocos(arquivo: string, src: string): Bloco[] {
  const out: Bloco[] = [];
  let atual: string[] = [];
  const fechar = () => {
    if (atual.length === 0) return;
    const texto = atual.join("\n");
    out.push({ arquivo, nome: NOME.exec(atual[0])?.[1] ?? null, texto });
  };
  for (const linha of src.split("\n")) {
    if (INICIO.test(linha)) {
      fechar();
      atual = [linha];
    } else if (atual.length > 0) atual.push(linha);
  }
  fechar();
  return out;
}

// Helpers de escopo: os de unidade-acesso.server, allowedSponteUnidades e quem lê
// user_schools (ex.: allowedSchoolIds), direto ou por outro helper.
const CHECAGEM_BASE =
  /\b(?:exigirUnidadeDoUsuario|exigirEscolaDoUsuario|unidadesDoUsuario|unidadeLiberada|allowedSponteUnidades)\s*\(|\.from\(\s*["']user_schools["']/;
// Só funções que EXIGEM admin (recusam os demais). O atalho "admin passa" das
// checagens de página não conta.
const CHECAGEM_ADMIN =
  /\b(?:assert|exigir|require|garantir)(?:Is)?Admin\w*\s*\(|!\s*\(\s*await\s+(?:ehAdmin|isAdmin)\s*\(/;
const MARCADOR = /\/\/\s*escopo-unidade:\s*\S/;

function chama(texto: string, nomes: Set<string>): boolean {
  for (const m of texto.matchAll(/\b(\w+)\s*\(/g)) if (nomes.has(m[1])) return true;
  return false;
}

// Funções que fazem checagem (direta ou via helpers, em qualquer arquivo).
function nomesQueChecam(todos: Bloco[]): Set<string> {
  const nomes = new Set<string>();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const b of todos) {
      if (!b.nome || nomes.has(b.nome) || b.texto.includes("createServerFn(")) continue;
      if (CHECAGEM_BASE.test(b.texto) || chama(b.texto, nomes)) {
        nomes.add(b.nome);
        mudou = true;
      }
    }
  }
  return nomes;
}

// createServerFn que usam supabaseAdmin (direto ou via helper do mesmo arquivo)
// sem checagem de colégio/admin nem marcador. Formato "arquivo:função".
export function serverFnsSemEscopo(): string[] {
  const porArquivo = new Map<string, Bloco[]>();
  for (const raiz of RAIZES)
    for (const a of arquivos(raiz)) {
      const rel = relative(process.cwd(), a);
      porArquivo.set(rel, blocos(rel, readFileSync(a, "utf8")));
    }
  const todos = [...porArquivo.values()].flat();
  const checam = nomesQueChecam(todos);
  const out: string[] = [];
  for (const [arquivo, bs] of porArquivo) {
    const usamAdmin = new Set<string>();
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const b of bs) {
        if (!b.nome || usamAdmin.has(b.nome) || b.texto.includes("createServerFn(")) continue;
        if (b.texto.includes("supabaseAdmin") || chama(b.texto, usamAdmin)) {
          usamAdmin.add(b.nome);
          mudou = true;
        }
      }
    }
    for (const b of bs) {
      if (!b.texto.includes("createServerFn(")) continue;
      if (!b.texto.includes("supabaseAdmin") && !chama(b.texto, usamAdmin)) continue;
      if (CHECAGEM_BASE.test(b.texto) || CHECAGEM_ADMIN.test(b.texto)) continue;
      if (chama(b.texto, checam) || MARCADOR.test(b.texto)) continue;
      out.push(`${arquivo}:${b.nome ?? "?"}`);
    }
  }
  return out.sort();
}

// Pendências do Envio 32, parte 3 (Diário, Esportes, Atendimento e RH): a
// parte 3 corrige e remove daqui. Nada novo entra nesta lista.
const PENDENCIAS: string[] = [
  "src/lib/atendimento.functions.ts:arquivarConversas",
  "src/lib/atendimento.functions.ts:enviarMensagemChat",
  "src/lib/atendimento.functions.ts:enviarMidiaChat",
  "src/lib/atendimento-ia.functions.ts:gerarSugestaoResposta",
  "src/lib/atendimento-ia.functions.ts:registrarEnvioDaSugestao",
  "src/lib/atendimento-ia.functions.ts:salvarInstrucoesIA",
  "src/lib/atendimento-ia-exemplos.functions.ts:atualizarExemploTreinamento",
  "src/lib/atendimento-ia-exemplos.functions.ts:removerExemploTreinamento",
  "src/lib/atendimento-ia-exemplos.functions.ts:salvarExemploTreinamento",
  "src/lib/contracheques.functions.ts:enviarContracheque",
  "src/lib/diario-auditoria.functions.ts:executarAuditoriaDiario",
  "src/lib/diario-auditoria.functions.ts:listarAuditoriaDiario",
  "src/lib/diario-faturamento.functions.ts:cancelarFaturamentoDiario",
  "src/lib/diario-faturamento.functions.ts:definirMinutosHoraExtraDiario",
  "src/lib/diario-faturamento.functions.ts:faturarExtrasDiario",
  "src/lib/diario-faturamento.functions.ts:faturarTodosExtrasDiario",
  "src/lib/diario-faturamento.functions.ts:isentarEventoDiario",
  "src/lib/diario-faturamento.functions.ts:listarFaturamentosDiario",
  "src/lib/diario-faturamento.functions.ts:listarPendenciasFaturamentoDiario",
  "src/lib/diario-faturamento.functions.ts:marcarFaturamentoDiarioManual",
  "src/lib/diario-faturamento.functions.ts:relancarFaturamentoDiario",
  "src/lib/diario-faturamento.functions.ts:unidadesComExtrasPendentes",
  "src/lib/diario-precos.functions.ts:listarPrecosExtras",
  "src/lib/diario-precos.functions.ts:salvarPrecoExtra",
  "src/lib/esportes.functions.ts:fetchArrecadacaoModalidade",
  "src/lib/esportes.functions.ts:fetchParcelasModalidade",
  "src/lib/ponto.functions.ts:salvarFolhaPonto",
];

describe("trava: escopo por colégio nas server functions com supabaseAdmin", () => {
  const semEscopo = serverFnsSemEscopo();

  it("toda createServerFn com supabaseAdmin checa colégio/admin ou tem o marcador", () => {
    const novas = semEscopo.filter((f) => !PENDENCIAS.includes(f));
    expect(
      novas,
      "Chame exigirUnidadeDoUsuario/exigirEscolaDoUsuario/unidadesDoUsuario (src/lib/unidade-acesso.server.ts), exija admin ou anote `// escopo-unidade: <motivo>` no corpo",
    ).toEqual([]);
  });

  it("a lista de pendências só encolhe: item corrigido sai da lista", () => {
    expect(PENDENCIAS.filter((f) => !semEscopo.includes(f))).toEqual([]);
  });
});
