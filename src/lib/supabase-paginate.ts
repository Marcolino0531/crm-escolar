import type { PostgrestError } from "@supabase/supabase-js";

// O PostgREST corta silenciosamente qualquer resposta em 1000 linhas (db-max-rows).
// Consultas amplas (ex.: registros da Colônia numa janela de duas semanas) passam
// desse teto e voltam incompletas, o que faz validadores acusarem falta de dados
// que existem no banco. Este helper pagina por `range` até esgotar o resultado.

const PAGE_SIZE = 1000;

export type PagedRows<T> = { data: T[] | null; error: PostgrestError | null };

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
