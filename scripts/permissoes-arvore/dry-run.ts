// Dry-run da migration de permissões (Parte 4.4): compara, por usuário não
// administrador, o conjunto de rotas acessíveis ANTES (regras legadas do menu
// em `base`) e DEPOIS (árvore + linhas copiadas), e conta nós com Visualizar/Editar.
//
//   npx tsx scripts/permissoes-arvore/dry-run.ts <dados.json>
//
// dados.json: { users:[{id,nome,admin}], antigas:[{user_id,module,can_view,can_edit}],
//               novas:[...] } — `novas` é o resultado do SELECT da migration de cópia
// (sem INSERT), executado em produção só para leitura.
import { readFileSync } from "node:fs";
import {
  MODULOS,
  avaliarPermissoes,
  listarNos,
  migrarLinhasLegadas,
  type LinhaPermissao,
} from "../../src/lib/permissoes-arvore";

type Linha = { user_id: string; module: string; can_view: boolean; can_edit: boolean };
type Dados = {
  users: { id: string; nome: string; admin: boolean }[];
  antigas: Linha[];
  novas?: Linha[];
};

const dados: Dados = JSON.parse(readFileSync(process.argv[2], "utf8"));

function rotasAntes(linhas: LinhaPermissao[]): Set<string> {
  const ver = new Set<string>();
  for (const r of linhas) if (r.can_view || r.can_edit) ver.add(r.module);
  const v = (m: string) => ver.has(m);
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
  const rotas: [string, boolean][] = [
    ["/", v("dashboard")],
    ["/agenda", v("agenda")],
    ["/admissoes", v("admissoes")],
    ["/matriculas", v("admissoes")],
    ["/rematricula-acompanhamento", v("rematricula")],
    ["/onboarding", v("onboarding")],
    ["/pedagogico", v("pedagogico")],
    ["/diario", v("diario") || v("diario_financeiro")],
    ["/colonia", v("colonia") || v("colonia_financeiro")],
    ["/uniformes", v("uniformes")],
    ["/estoque-material", v("estoque_material")],
    ["/esportes", v("esportes")],
    ["/biblioteca", v("biblioteca")],
    ["/rh", v("rh")],
    ["/tasks", v("tasks")],
    ["/atendimento", v("financeiro_atendimento")],
    ["/atendimento-ia", v("financeiro_atendimento_ia")],
    ["/documentos", v("documentos")],
    ["/cantina", v("cantina")],
    ["/cobranca-automatica", v("financeiro_cobranca")],
    ["/analises-ia", fin],
    ["/extrato-bancario", fin && v("financeiro_dashboard")],
    ["/upload", fin && v("financeiro_upload")],
    ["/conciliacao", fin && v("financeiro_conciliacao")],
    ["/fluxo-futuro", fin && v("financeiro_fluxo")],
    ["/fundos", fin && v("financeiro_fundos")],
    ["/cartao-credito", fin && v("financeiro_cartao")],
    ["/inadimplencia", fin && v("financeiro_inadimplencia")],
    ["/cobranca", fin && v("financeiro_cobranca")],
    ["/configuracoes", v("configuracoes")],
  ];
  return new Set(rotas.filter(([, ok]) => ok).map(([r]) => r));
}

function rotasDepois(linhas: LinhaPermissao[]): Set<string> {
  const p = avaliarPermissoes(linhas, false);
  const s = new Set<string>();
  for (const m of MODULOS) {
    if (m.acessoEspecial === "professor") continue;
    if (m.rota && p.ver(m.chave)) s.add(m.rota);
  }
  return s;
}

const nosPermissao = listarNos().filter((n) => n.tipo !== "grupo" && !n.acessoEspecial);

let todasIdenticas = true;
const linhasRelatorio: string[] = [];
linhasRelatorio.push("| Usuário | Visualizar (nós) | Editar (nós) | Rotas antes | Rotas depois | Idênticas |");
linhasRelatorio.push("|---|---|---|---|---|---|");

for (const u of dados.users) {
  if (u.admin) continue;
  const antigas = dados.antigas.filter((l) => l.user_id === u.id);
  const geradas = dados.novas
    ? dados.novas.filter((l) => l.user_id === u.id)
    : migrarLinhasLegadas(antigas);
  // Confere que o SQL gerado bate com a regra TypeScript.
  if (dados.novas) {
    const ts = migrarLinhasLegadas(antigas);
    const chave = (l: LinhaPermissao) => `${l.module}:${l.can_view ? 1 : 0}${l.can_edit ? 1 : 0}`;
    const a = new Set(ts.map(chave));
    const b = new Set(geradas.map(chave));
    const dif = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
    if (dif.length) {
      console.error(`DIVERGÊNCIA SQL x TS em ${u.nome}:`, dif);
      process.exitCode = 1;
    }
  }
  const depois = [...antigas, ...geradas];
  const p = avaliarPermissoes(depois, false);
  const ver = nosPermissao.filter((n) => p.ver(n.chave)).length;
  const editar = nosPermissao.filter((n) => p.editar(n.chave)).length;
  const rA = rotasAntes(antigas);
  const rD = rotasDepois(depois);
  const identicas = rA.size === rD.size && [...rA].every((r) => rD.has(r));
  if (!identicas) {
    todasIdenticas = false;
    console.error(
      `ROTAS DIFERENTES em ${u.nome}: só antes=${[...rA].filter((r) => !rD.has(r))} só depois=${[...rD].filter((r) => !rA.has(r))}`,
    );
  }
  linhasRelatorio.push(
    `| ${u.nome} | ${ver} | ${editar} | ${rA.size} | ${rD.size} | ${identicas ? "sim" : "NÃO"} |`,
  );
}

console.log(linhasRelatorio.join("\n"));
console.log(`\nRotas idênticas por usuário: ${todasIdenticas ? "SIM" : "NÃO"}`);
if (!todasIdenticas) process.exitCode = 1;
