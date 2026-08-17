// Isolamento por unidade das modalidades de Esportes Extracurriculares.
//
// Cada colégio tem suas PRÓPRIAS modalidades: "Jazz" no CEC e "Jazz" no Núcleo
// Belvedere são registros independentes, com turmas, alunos, parceiros e
// parcelas do Sponte separados. A unidade da modalidade é a fonte da verdade —
// a tela nunca opera uma modalidade de fora da unidade selecionada no topo, e a
// visão consolidada ("Todas as Unidades") é somente leitura, porque não existe
// unidade a que atribuir um cadastro novo ou uma edição.

export interface ModalidadeDeUnidade {
  id: string;
  nome: string;
  unidade: string;
}

export interface UnidadeGrupo<T extends ModalidadeDeUnidade> {
  unidade: string;
  modalidades: T[];
}

// Nome da unidade selecionada no topo da tela. `null` = "Todas as Unidades"
// (visão consolidada) ou seleção que não corresponde a nenhuma unidade.
export function unidadeDaSelecao(
  selected: string,
  schools: { id: string; name: string }[],
): string | null {
  if (selected === "all") return null;
  return schools.find((s) => s.id === selected)?.name ?? null;
}

function mesmaUnidade(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

// A modalidade pertence à unidade? Comparação estrita: sem unidade ativa
// (consolidado) nada é considerado "da unidade".
export function modalidadeDaUnidade(
  modalidade: ModalidadeDeUnidade,
  unidade: string | null,
): boolean {
  if (!unidade) return false;
  return mesmaUnidade(modalidade.unidade, unidade);
}

// Modalidades operáveis na unidade ativa. No consolidado devolve lista vazia:
// nenhuma modalidade é operada dali.
export function modalidadesDaUnidade<T extends ModalidadeDeUnidade>(
  modalidades: T[],
  unidade: string | null,
): T[] {
  return modalidades.filter((m) => modalidadeDaUnidade(m, unidade));
}

// Modalidade selecionada que continua válida ao trocar de unidade; senão, a
// primeira da unidade (ou "" quando a unidade não tem modalidade nenhuma).
export function selecaoValida<T extends ModalidadeDeUnidade>(
  modalidades: T[],
  unidade: string | null,
  atual: string,
): string {
  const daUnidade = modalidadesDaUnidade(modalidades, unidade);
  if (daUnidade.some((m) => m.id === atual)) return atual;
  return daUnidade[0]?.id ?? "";
}

// Escrita (cadastrar, editar, matricular, registrar repasse) só na unidade da
// própria modalidade — nunca a partir de outra unidade nem do consolidado.
export function podeOperarModalidade(
  modalidade: ModalidadeDeUnidade | null,
  unidade: string | null,
  podeEditarModulo: boolean,
): boolean {
  if (!podeEditarModulo || !modalidade) return false;
  return modalidadeDaUnidade(modalidade, unidade);
}

// Unidade a que a modalidade nova pertence: obrigatoriamente a selecionada no
// topo. No consolidado o cadastro não existe.
export function unidadeParaCadastro(unidade: string | null): string {
  if (!unidade)
    throw new Error("Selecione uma unidade específica no topo da tela para cadastrar modalidades.");
  return unidade;
}

// Visão consolidada: cada modalidade rotulada com sua unidade, agrupada por
// unidade — sem misturar dados de unidades diferentes numa mesma modalidade.
export function agruparPorUnidade<T extends ModalidadeDeUnidade>(
  modalidades: T[],
): UnidadeGrupo<T>[] {
  const grupos = new Map<string, T[]>();
  for (const m of modalidades) {
    const chave = m.unidade.trim();
    const lista = grupos.get(chave);
    if (lista) lista.push(m);
    else grupos.set(chave, [m]);
  }
  return [...grupos.entries()]
    .map(([unidade, lista]) => ({
      unidade,
      modalidades: [...lista].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    }))
    .sort((a, b) => a.unidade.localeCompare(b.unidade, "pt-BR"));
}
