import type { PostgrestError } from "@supabase/supabase-js";

// O PostgREST corta silenciosamente qualquer resposta em 1000 linhas (db-max-rows):
// não há erro, a lista só volta incompleta. Toda leitura que pode passar disso
// (listas que crescem, somas, agregações, "quem já foi cobrado hoje") DEVE usar
// um destes helpers. Ver docs/PAGINACAO-SUPABASE.md.
//
// Regra prática: a consulta precisa de um `.order(...)` determinístico (ex.: por
// `id`) para que as páginas não se sobreponham nem pulem linhas.

export const PAGE_SIZE = 1000;

export type PagedRows<T> = { data: T[] | null; error: PostgrestError | null };

export type Rangeable<T> = { range(from: number, to: number): PromiseLike<PagedRows<T>> };

// Forma básica: o chamador aplica `.range(from, to)` na própria consulta.
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PagedRows<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

// Forma curta: recebe uma fábrica da consulta já montada (select/filtros/order)
// e aplica o `.range` a cada página. A fábrica é chamada uma vez por página.
//
//   const alunos = await selectAll<Aluno>(() =>
//     supabase.from("diario_students").select("id, name").order("id"),
//   );
export function selectAll<T>(query: () => unknown): Promise<T[]> {
  return fetchAllRows<T>((from, to) => (query() as Rangeable<T>).range(from, to));
}
