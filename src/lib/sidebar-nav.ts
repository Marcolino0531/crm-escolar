// Lógica pura do menu lateral em categorias colapsáveis.
//
// A árvore de navegação é uma lista de nós: itens (uma rota) ou grupos
// (categorias/subcategorias, com filhos que podem ser itens ou outros grupos).
// O estado de expandido/recolhido é um mapa id→boolean, persistido por usuário.
// Ausência de um id no mapa significa o padrão (expandido).

export type ExpandedState = Record<string, boolean>;

export type NavNode =
  | { kind: "item"; to: string }
  | { kind: "group"; id: string; children: readonly NavNode[] };

// Lê o estado persistido de forma defensiva: JSON inválido, valor não-objeto ou
// entradas não-booleanas são descartados (retorna {} / ignora a chave).
export function parseExpandedState(raw: string | null | undefined): ExpandedState {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: ExpandedState = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function serializeExpandedState(state: ExpandedState): string {
  return JSON.stringify(state);
}

// Categorias nascem expandidas por padrão (defaultExpanded), até o usuário
// recolher explicitamente.
export function isExpanded(state: ExpandedState, id: string, defaultExpanded = true): boolean {
  return id in state ? state[id] : defaultExpanded;
}

export function toggleExpanded(
  state: ExpandedState,
  id: string,
  defaultExpanded = true,
): ExpandedState {
  return { ...state, [id]: !isExpanded(state, id, defaultExpanded) };
}

// Força um conjunto de grupos a expandido (usado para abrir a categoria da rota
// atual). Retorna o MESMO objeto quando nada muda, para evitar re-render à toa.
export function expandGroups(state: ExpandedState, ids: readonly string[]): ExpandedState {
  let changed = false;
  const next: ExpandedState = { ...state };
  for (const id of ids) {
    if (next[id] !== true) {
      next[id] = true;
      changed = true;
    }
  }
  return changed ? next : state;
}

function itemMatchesPath(to: string, path: string): boolean {
  if (to === path) return true;
  return to !== "/" && path.startsWith(`${to}/`);
}

// Ids de todos os grupos (categoria e subcategoria) no caminho até o item cuja
// rota corresponde a `path`. Base da auto-expansão da rota atual.
export function groupIdsForPath(tree: readonly NavNode[], path: string): string[] {
  const acc: string[] = [];
  const visit = (node: NavNode): boolean => {
    if (node.kind === "item") return itemMatchesPath(node.to, path);
    let found = false;
    for (const child of node.children) {
      if (visit(child)) found = true;
    }
    if (found) acc.push(node.id);
    return found;
  };
  for (const node of tree) visit(node);
  return acc;
}

// Todas as rotas (itens) da árvore, em ordem de exibição.
export function flattenTos(tree: readonly NavNode[]): string[] {
  const out: string[] = [];
  for (const node of tree) {
    if (node.kind === "item") out.push(node.to);
    else out.push(...flattenTos(node.children));
  }
  return out;
}

// Quantidade de categorias marcadas como expandidas no estado salvo.
export function countExpanded(state: ExpandedState): number {
  return Object.values(state).filter(Boolean).length;
}
