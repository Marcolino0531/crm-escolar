// Lógica pura do menu lateral em categorias colapsáveis.
//
// A árvore de navegação é uma lista de nós: itens (uma rota) ou grupos
// (categorias/subcategorias, com filhos que podem ser itens ou outros grupos).
// O estado de expandido/recolhido é um mapa id→boolean, apenas em memória: toda
// categoria nasce recolhida e abre/fecha conforme o ponteiro entra e sai dela.

export type ExpandedState = Record<string, boolean>;

export type NavNode =
  | { kind: "item"; to: string }
  | { kind: "group"; id: string; children: readonly NavNode[] };

// Ausência de um id no mapa significa recolhido.
export function isExpanded(state: ExpandedState, id: string): boolean {
  return state[id] === true;
}

export function toggleExpanded(state: ExpandedState, id: string): ExpandedState {
  return setExpanded(state, id, !isExpanded(state, id));
}

// Abre ou fecha um grupo. Retorna o MESMO objeto quando nada muda, para evitar
// re-render à toa (mouseenter repetido nos filhos da categoria já aberta).
export function setExpanded(state: ExpandedState, id: string, expanded: boolean): ExpandedState {
  if (isExpanded(state, id) === expanded) return state;
  return { ...state, [id]: expanded };
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
