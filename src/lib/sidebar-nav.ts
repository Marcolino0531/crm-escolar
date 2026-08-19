// Lógica pura do menu lateral em categorias colapsáveis.
//
// A árvore de navegação é uma lista de nós: itens (uma rota) ou grupos
// (categorias/subcategorias, com filhos que podem ser itens ou outros grupos).
// O estado de expandido/recolhido é um mapa id→boolean, apenas em memória: toda
// categoria nasce recolhida, abre no clique e só recolhe quando o usuário abre
// outra categoria irmã, navega para um item ou clica fora do menu.

export type ExpandedState = Record<string, boolean>;

export type NavNode =
  | { kind: "item"; to: string }
  | { kind: "group"; id: string; children: readonly NavNode[] };

// Ausência de um id no mapa significa recolhido.
export function isExpanded(state: ExpandedState, id: string): boolean {
  return state[id] === true;
}

// Alterna um grupo mantendo no máximo um aberto entre os irmãos: abrir uma
// categoria recolhe as outras do mesmo nível.
export function toggleExclusive(
  state: ExpandedState,
  id: string,
  siblingIds: readonly string[],
): ExpandedState {
  const abrindo = !isExpanded(state, id);
  const next: ExpandedState = { ...state, [id]: abrindo };
  if (abrindo) {
    for (const sibling of siblingIds) {
      if (sibling !== id) next[sibling] = false;
    }
  }
  return next;
}

// Recolhe tudo (clique fora do menu ou navegação). Mantém a referência quando
// já não havia nada aberto.
export function collapseAll(state: ExpandedState): ExpandedState {
  if (!Object.values(state).some(Boolean)) return state;
  return {};
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
