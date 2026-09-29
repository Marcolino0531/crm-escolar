// Dry-run da migration de permissões (Partes 4.4 e 5.1): compara, por usuário
// não administrador, ANTES (regras de `base`: guards das rotas, menu antigo e
// condições das abas) e DEPOIS (árvore + linhas copiadas, lidas só por folhas):
//   (a) rotas acessíveis (guard da rota) e itens do menu;
//   (b) abas visíveis em cada rota;
// e exporta, por usuário, a matriz legada e as folhas efetivas para a etapa
// (c) — RLS e server functions — feita por scripts/permissoes-arvore/dry-run-rls.py.
//
//   npx tsx scripts/permissoes-arvore/dry-run.ts <dados.json> [saida-matrizes.json]
//
// dados.json: { users:[{id,nome,admin}], antigas:[{user_id,module,can_view,can_edit}],
//               novas?:[...] } — `novas` é o resultado do SELECT da migration de cópia
// (sem INSERT), executado em produção só para leitura.
import { readFileSync, writeFileSync } from "node:fs";
import {
  CHAVES_LEGADAS,
  CHAVES_PERMISSAO_GRAVAVEIS,
  MODULOS,
  PAGINAS_RH_SEM_SALARIO,
  avaliarPermissoes,
  listarNos,
  migrarLinhasLegadas,
  moduloVisivelNoMenu,
  type ChaveLegada,
  type ChavePermissao,
  type ExpressaoLegada,
  type LinhaPermissao,
  type NoArvore,
} from "../../src/lib/permissoes-arvore";

type Linha = { user_id: string; module: string; can_view: boolean; can_edit: boolean };
type Dados = {
  users: { id: string; nome: string; admin: boolean }[];
  antigas: Linha[];
  novas?: Linha[];
};

const dados: Dados = JSON.parse(readFileSync(process.argv[2], "utf8"));
const saidaMatrizes = process.argv[3];

type Legado = { ver: (c: string) => boolean; editar: (c: string) => boolean };

function legadoDe(linhas: readonly LinhaPermissao[]): Legado {
  const ver = new Set<string>();
  const editar = new Set<string>();
  for (const r of linhas) {
    if (!(CHAVES_LEGADAS as readonly string[]).includes(r.module)) continue;
    if (r.can_view || r.can_edit) ver.add(r.module);
    if (r.can_edit) editar.add(r.module);
  }
  return { ver: (c) => ver.has(c), editar: (c) => editar.has(c) };
}

function expr(e: ExpressaoLegada, tem: (c: ChaveLegada) => boolean): boolean {
  return e.some((g) => g.every(tem));
}

// Guard de cada rota em `base` (d7cf66c, `if (!canView(...)) return <AccessDenied/>`).
const GUARD_ANTES: Record<string, (v: (c: string) => boolean) => boolean> = {
  "/": (v) => v("dashboard"),
  "/agenda": (v) => v("agenda"),
  "/admissoes": (v) => v("admissoes"),
  "/matriculas": (v) => v("admissoes"),
  "/rematricula-acompanhamento": (v) => v("rematricula"),
  "/onboarding": (v) => v("onboarding"),
  "/pedagogico": (v) => v("pedagogico"),
  "/diario": (v) => v("diario") || v("diario_financeiro"),
  "/colonia": (v) => v("colonia") || v("colonia_financeiro"),
  "/uniformes": (v) => v("uniformes"),
  "/estoque-material": (v) => v("estoque_material"),
  "/esportes": (v) => v("esportes"),
  "/biblioteca": (v) => v("biblioteca"),
  "/rh": (v) => v("rh"),
  "/tasks": (v) => v("tasks"),
  "/atendimento": (v) => v("financeiro_atendimento"),
  "/atendimento-ia": (v) => v("financeiro_atendimento_ia"),
  "/documentos": (v) => v("documentos"),
  "/cantina": (v) => v("cantina"),
  "/cobranca-automatica": (v) => v("financeiro_cobranca"),
  "/analises-ia": (v) => v("financeiro"),
  "/extrato-bancario": (v) => v("financeiro_dashboard"),
  "/upload": (v) => v("financeiro_upload"),
  "/conciliacao": (v) => v("financeiro_conciliacao"),
  "/fluxo-futuro": (v) => v("financeiro_fluxo"),
  "/fundos": (v) => v("financeiro_fundos"),
  "/cartao-credito": (v) => v("financeiro_cartao"),
  "/inadimplencia": (v) => v("financeiro_inadimplencia"),
  "/cobranca": (v) => v("financeiro") && v("financeiro_cobranca"),
  "/configuracoes": (v) => v("configuracoes"),
};

// Menu antigo (__root.tsx em `base`): Financeiro exige guarda-chuva E subpágina; RH sem rh_salario.
function menuAntes(v: (c: string) => boolean): Set<string> {
  const fin =
    v("financeiro") &&
    (v("financeiro_dashboard") ||
      v("financeiro_upload") ||
      v("financeiro_conciliacao") ||
      v("financeiro_fluxo") ||
      v("financeiro_inadimplencia") ||
      v("financeiro_cobranca") ||
      v("financeiro_cartao") ||
      v("financeiro_fundos"));
  const s = new Set<string>();
  for (const [rota, g] of Object.entries(GUARD_ANTES)) {
    if (rota === "/analises-ia") {
      if (fin) s.add(rota);
    } else if (
      rota.startsWith("/extrato") ||
      [
        "/upload",
        "/conciliacao",
        "/fluxo-futuro",
        "/fundos",
        "/cartao-credito",
        "/inadimplencia",
        "/cobranca",
      ].includes(rota)
    ) {
      if (fin && g(v)) s.add(rota);
    } else if (g(v)) s.add(rota);
  }
  return s;
}

const MODULOS_ROTA: NoArvore[] = MODULOS.filter((m) => m.rota && !m.acessoEspecial);

function guardDepois(m: NoArvore, p: ReturnType<typeof avaliarPermissoes>): boolean {
  if (m.rota === "/rh") return PAGINAS_RH_SEM_SALARIO.some((c) => p.ver(c));
  return p.ver(m.chave as ChavePermissao);
}

function rotasDepois(p: ReturnType<typeof avaliarPermissoes>): Set<string> {
  const s = new Set<string>();
  for (const m of MODULOS_ROTA) if (guardDepois(m, p)) s.add(m.rota!);
  return s;
}

function menuDepois(p: ReturnType<typeof avaliarPermissoes>): Set<string> {
  const s = new Set<string>();
  for (const m of MODULOS_ROTA) if (moduloVisivelNoMenu(m, (c) => p.ver(c))) s.add(m.rota!);
  return s;
}

const TODOS = listarNos();
const PAGINAS = TODOS.filter((n) => n.tipo === "pagina" && !n.acessoEspecial && n.legado);
function contem(no: NoArvore, chave: string): boolean {
  return no.chave === chave || !!no.filhos?.some((f) => contem(f, chave));
}
function moduloDaPagina(n: NoArvore): NoArvore {
  const m = MODULOS_ROTA.find((mod) => contem(mod, n.chave));
  if (!m) throw new Error(`página sem módulo: ${n.chave}`);
  return m;
}

function abasAntes(leg: Legado): Set<string> {
  const s = new Set<string>();
  for (const pg of PAGINAS) {
    const m = moduloDaPagina(pg);
    const guard = GUARD_ANTES[m.rota!];
    if (!guard) throw new Error(`rota sem guard antigo: ${m.rota}`);
    if (guard(leg.ver) && expr(pg.legado!.ver, (c) => leg.ver(c))) s.add(pg.chave);
  }
  return s;
}

function abasDepois(p: ReturnType<typeof avaliarPermissoes>): Set<string> {
  const s = new Set<string>();
  for (const pg of PAGINAS) {
    const m = moduloDaPagina(pg);
    if (guardDepois(m, p) && p.ver(pg.chave as ChavePermissao)) s.add(pg.chave);
  }
  return s;
}

function dif(a: Set<string>, b: Set<string>): string {
  const soA = [...a].filter((x) => !b.has(x));
  const soB = [...b].filter((x) => !a.has(x));
  if (!soA.length && !soB.length) return "";
  return `só antes=[${soA}] só depois=[${soB}]`;
}

const nosPermissao = TODOS.filter((n) => n.tipo !== "grupo" && !n.acessoEspecial);
const chavesFolha = CHAVES_PERMISSAO_GRAVAVEIS as readonly ChavePermissao[];

let tudoIdentico = true;
const rel: string[] = [];
rel.push("| Usuário | Visualizar (nós) | Editar (nós) | Rotas | Menu | Abas | Idênticos |");
rel.push("|---|---|---|---|---|---|---|");
const matrizes: Record<string, unknown> = {};

for (const u of dados.users) {
  if (u.admin) continue;
  const antigas = dados.antigas.filter((l) => l.user_id === u.id);
  const geradas = dados.novas
    ? dados.novas.filter((l) => l.user_id === u.id)
    : migrarLinhasLegadas(antigas);
  if (dados.novas) {
    const ts = migrarLinhasLegadas(antigas);
    const chave = (l: LinhaPermissao) => `${l.module}:${l.can_view ? 1 : 0}${l.can_edit ? 1 : 0}`;
    // Folha com o mesmo nome da chave antiga já existe como linha: a cópia (ON CONFLICT DO NOTHING) não a repete.
    const jaExiste = new Set(antigas.map(chave));
    const a = new Set(ts.map(chave).filter((c) => !jaExiste.has(c)));
    const b = new Set(geradas.map(chave).filter((c) => !jaExiste.has(c)));
    const d = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
    if (d.length) {
      console.error(`DIVERGÊNCIA SQL x TS em ${u.nome}:`, d);
      process.exitCode = 1;
    }
  }
  const depois = [...antigas, ...geradas];
  const leg = legadoDe(antigas);
  const p = avaliarPermissoes(depois, false);

  const rA = new Set(Object.keys(GUARD_ANTES).filter((r) => GUARD_ANTES[r](leg.ver)));
  const rD = rotasDepois(p);
  const mA = menuAntes(leg.ver);
  const mD = menuDepois(p);
  const aA = abasAntes(leg);
  const aD = abasDepois(p);
  const difs = [
    ["rotas", dif(rA, rD)],
    ["menu", dif(mA, mD)],
    ["abas", dif(aA, aD)],
  ].filter(([, d]) => d);
  if (difs.length) {
    tudoIdentico = false;
    for (const [k, d] of difs) console.error(`${k.toUpperCase()} DIFERENTES em ${u.nome}: ${d}`);
  }
  const ver = nosPermissao.filter((n) => p.ver(n.chave as ChavePermissao)).length;
  const editar = nosPermissao.filter((n) => p.editar(n.chave as ChavePermissao)).length;
  rel.push(
    `| ${u.nome} | ${ver} | ${editar} | ${rA.size}/${rD.size} | ${mA.size}/${mD.size} | ${aA.size}/${aD.size} | ${difs.length ? "NÃO" : "sim"} |`,
  );
  matrizes[u.nome] = {
    legado_ver: CHAVES_LEGADAS.filter((c) => leg.ver(c)),
    legado_editar: CHAVES_LEGADAS.filter((c) => leg.editar(c)),
    folhas_ver: chavesFolha.filter((c) => p.ver(c)),
    folhas_editar: chavesFolha.filter((c) => p.editar(c)),
  };
}

console.log(rel.join("\n"));
console.log(`\nRotas, menu e abas idênticos por usuário: ${tudoIdentico ? "SIM" : "NÃO"}`);

// Simulação de revogação (usuário fictício, nada gravado): todas as folhas menos Documentos.
const ehDocumentos = (c: string) => c === "documentos" || c.startsWith("documentos.");
const linhaFolha = (c: string): LinhaPermissao => ({ module: c, can_view: true, can_edit: true });
const completo = avaliarPermissoes(chavesFolha.map(linhaFolha), false);
const semDocs = avaliarPermissoes(
  chavesFolha.filter((c) => !ehDocumentos(c)).map(linhaFolha),
  false,
);
const rotasPerdidas = [...rotasDepois(completo)].filter((r) => !rotasDepois(semDocs).has(r));
const abasPerdidas = [...abasDepois(completo)].filter((a) => !abasDepois(semDocs).has(a));
const menuPerdido = [...menuDepois(completo)].filter((r) => !menuDepois(semDocs).has(r));
const nosDocs = nosPermissao.filter((n) => ehDocumentos(n.chave)).map((n) => n.chave);
const revogacaoOk =
  rotasPerdidas.length === 1 &&
  rotasPerdidas[0] === "/documentos" &&
  menuPerdido.length === 1 &&
  menuPerdido[0] === "/documentos" &&
  abasPerdidas.every(ehDocumentos) &&
  abasPerdidas.length === PAGINAS.filter((p) => ehDocumentos(p.chave)).length &&
  nosDocs.every((c) => !semDocs.ver(c as ChavePermissao) && !semDocs.editar(c as ChavePermissao));
console.log(
  `Simulação de revogação (Documentos): rota bloqueada=[${rotasPerdidas}] menu=[${menuPerdido}] abas bloqueadas=${abasPerdidas.length} nós Documentos sem acesso=${nosDocs.length} → ${revogacaoOk ? "OK" : "FALHOU"}`,
);
if (!revogacaoOk) process.exitCode = 1;
if (saidaMatrizes) writeFileSync(saidaMatrizes, JSON.stringify(matrizes, null, 1));
if (!tudoIdentico) process.exitCode = 1;
