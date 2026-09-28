// Estado de edição da árvore de permissões (Configurações > Gerenciar Acessos).
// Lógica pura, sem React: a permissão vive nas FOLHAS; grupos, módulos e páginas
// com filhos mostram um estado derivado (sim / não / parcial).

import {
  ARVORE_PERMISSOES,
  CHAVES_PERMISSAO_GRAVAVEIS,
  MODULOS,
  avaliarPermissoes,
  caminhoDoNo,
  folhasDe,
  listarNos,
  noPorChave,
  type ChavePermissao,
  type LinhaPermissao,
  type NoArvore,
} from "@/lib/permissoes-arvore";

export interface PermissaoNo {
  view: boolean;
  edit: boolean;
}

/** Permissão por folha gravável (chave → Visualizar/Editar). */
export type EstadoFolhas = Record<string, PermissaoNo>;

export type Marcacao = "sim" | "nao" | "parcial";

export function estadoVazio(valor = false): EstadoFolhas {
  const e: EstadoFolhas = {};
  for (const c of CHAVES_PERMISSAO_GRAVAVEIS) e[c] = { view: valor, edit: valor };
  return e;
}

/** Estado a partir das linhas gravadas do usuário (só as chaves da árvore contam). */
export function estadoDeLinhas(linhas: readonly LinhaPermissao[]): EstadoFolhas {
  const e = estadoVazio(false);
  for (const r of linhas) {
    if (r.module in e) e[r.module] = { view: !!r.can_view || !!r.can_edit, edit: !!r.can_edit };
  }
  return e;
}

/** Linhas a gravar em user_permissions (uma por folha, Editar implica Visualizar). */
export function linhasDoEstado(e: EstadoFolhas): LinhaPermissao[] {
  return CHAVES_PERMISSAO_GRAVAVEIS.map((c) => ({
    module: c,
    can_view: !!(e[c]?.view || e[c]?.edit),
    can_edit: !!e[c]?.edit,
  }));
}

function folhasGravaveis(no: NoArvore): NoArvore[] {
  return folhasDe(no).filter((f) => !f.acessoEspecial);
}

function marcacao(valores: boolean[]): Marcacao {
  if (valores.length === 0 || valores.every((v) => !v)) return "nao";
  return valores.every((v) => v) ? "sim" : "parcial";
}

/** Estado exibido de qualquer nó (folha: sim/não; pai: derivado das folhas). */
export function marcacaoDoNo(
  chave: string,
  e: EstadoFolhas,
): { view: Marcacao; edit: Marcacao; gravavel: boolean } {
  const no = noPorChave(chave);
  if (!no) return { view: "nao", edit: "nao", gravavel: false };
  const folhas = folhasGravaveis(no);
  return {
    view: marcacao(folhas.map((f) => !!e[f.chave]?.view)),
    edit: marcacao(folhas.map((f) => !!e[f.chave]?.edit)),
    gravavel: folhas.length > 0,
  };
}

/**
 * Marca/desmarca um nó: aplica a todas as folhas abaixo dele.
 * Editar ligado liga Visualizar; Visualizar desligado desliga Editar.
 */
export function alterarNo(
  e: EstadoFolhas,
  chave: string,
  campo: "view" | "edit",
  valor: boolean,
): EstadoFolhas {
  const no = noPorChave(chave);
  if (!no) return e;
  const prox: EstadoFolhas = { ...e };
  for (const f of folhasGravaveis(no)) {
    const atual = prox[f.chave] ?? { view: false, edit: false };
    prox[f.chave] =
      campo === "edit"
        ? { view: valor || atual.view, edit: valor }
        : { view: valor, edit: valor && atual.edit };
  }
  return prox;
}

export function marcarTodos(valor: boolean): EstadoFolhas {
  return estadoVazio(valor);
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Chaves a exibir com o filtro "Filtrar permissões": nós cujo nome (ou caminho)
 * contém o termo, mais todos os seus ancestrais e descendentes. Vazio = tudo.
 */
export function chavesFiltradas(termo: string): ReadonlySet<string> | null {
  const t = normalizar(termo);
  if (!t) return null;
  const visiveis = new Set<string>();
  for (const no of listarNos()) {
    if (!normalizar(caminhoDoNo(no.chave)).includes(t)) continue;
    for (const anc of ancestrais(no.chave)) visiveis.add(anc);
    visiveis.add(no.chave);
    percorrerDescendentes(no, (d) => visiveis.add(d.chave));
  }
  return visiveis;
}

function percorrerDescendentes(no: NoArvore, f: (n: NoArvore) => void) {
  for (const c of no.filhos ?? []) {
    f(c);
    percorrerDescendentes(c, f);
  }
}

function ancestrais(chave: string): string[] {
  const out: string[] = [];
  const busca = (nos: readonly NoArvore[], caminho: string[]): boolean => {
    for (const n of nos) {
      if (n.chave === chave) {
        out.push(...caminho);
        return true;
      }
      if (n.filhos && busca(n.filhos, [...caminho, n.chave])) return true;
    }
    return false;
  };
  busca(ARVORE_PERMISSOES as readonly NoArvore[], []);
  return out;
}

/** Chaves de todos os nós com filhos (para "Abrir todos"). */
export function chavesExpansiveis(): string[] {
  return listarNos()
    .filter((n) => n.filhos && n.filhos.length > 0)
    .map((n) => n.chave);
}

/** Resumo "Acesso: …" da lista de usuários: módulos com algum Visualizar, nomes da árvore. */
export function resumoAcesso(linhas: readonly LinhaPermissao[]): string[] {
  const p = avaliarPermissoes(linhas, false);
  return MODULOS.filter((m) => !m.acessoEspecial && p.ver(m.chave as ChavePermissao)).map(
    (m) => m.nome,
  );
}
