// Unidade selecionada no topo do School Hub como fonte única de verdade.
//
// Nenhuma tela interna tem seletor próprio de colégio/unidade: filtros e buscas
// derivam do seletor global, para que o que está escrito no topo seja sempre o
// que a tela está mostrando (documento, conciliação, cobrança). Telas que só
// funcionam com uma unidade específica pedem a escolha no topo em vez de
// oferecer uma segunda escolha interna.

export type EscolaGlobal = { id: string; name: string };

// Nome da unidade ativa. `null` = "Todas as Unidades" (consolidado) ou seleção
// que não corresponde a nenhuma escola visível ao usuário.
export function unidadeAtiva(selected: string, schools: readonly EscolaGlobal[]): string | null {
  if (selected === "all") return null;
  return schools.find((s) => s.id === selected)?.name ?? null;
}

// Id da escola ativa, para consultas que filtram por school_id. `null` no
// consolidado.
export function escolaAtivaId(selected: string, schools: readonly EscolaGlobal[]): string | null {
  if (selected === "all") return null;
  return schools.find((s) => s.id === selected)?.id ?? null;
}

// A tela exige uma unidade específica (gerar documento, importar extrato,
// conciliar) e o topo está no consolidado?
export function exigeUnidadeEspecifica(
  selected: string,
  schools: readonly EscolaGlobal[],
): boolean {
  return unidadeAtiva(selected, schools) === null;
}

function mesmaUnidade(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Filtro de listagem por unidade: no consolidado (`null`) devolve tudo o que a
// consulta já trouxe, que é o conjunto permitido ao usuário.
export function filtrarPorUnidade<T>(
  itens: readonly T[],
  unidade: string | null,
  unidadeDe: (item: T) => string | null | undefined,
): T[] {
  if (!unidade) return [...itens];
  return itens.filter((item) => {
    const u = unidadeDe(item);
    return typeof u === "string" && mesmaUnidade(u, unidade);
  });
}

// Rótulo do escopo atual, usado no lugar do seletor removido.
export function rotuloUnidadeAtiva(selected: string, schools: readonly EscolaGlobal[]): string {
  return unidadeAtiva(selected, schools) ?? "Todas as Unidades";
}

// Mensagem única de bloqueio das ações que exigem uma unidade específica.
export const MENSAGEM_UNIDADE_ESPECIFICA = "Selecione uma unidade específica no seletor do topo";

// Ações de escrita (editar dados do colégio, disparar cobrança de teste,
// cadastrar exceção de acordo, importar extrato, criar fundo) só rodam com uma
// unidade específica no topo — "Todas as Unidades" não é destino válido.
export function acaoDeUnidadeLiberada(selected: string, schools: readonly EscolaGlobal[]): boolean {
  return !exigeUnidadeEspecifica(selected, schools);
}
