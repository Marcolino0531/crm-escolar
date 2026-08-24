import { describe, it, expect } from "vitest";
import { fetchAllRows, type PagedRows } from "./supabase-paginate";

const PAGE_SIZE = 1000;

// Simula o PostgREST: aplica o range e corta a resposta no teto de linhas.
function fakeTable<T>(rows: T[]) {
  const chamadas: Array<[number, number]> = [];
  const page = (from: number, to: number): PromiseLike<PagedRows<T>> => {
    chamadas.push([from, to]);
    const fim = Math.min(to + 1, from + PAGE_SIZE);
    return Promise.resolve({ data: rows.slice(from, fim), error: null });
  };
  return { page, chamadas };
}

function linhas(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `tx-${String(i).padStart(5, "0")}` }));
}

describe("fetchAllRows", () => {
  it("traz todas as linhas quando o volume passa do teto de 1000 do PostgREST", async () => {
    const rows = linhas(2628); // volume real de transações do School Hub
    const { page, chamadas } = fakeTable(rows);

    const result = await fetchAllRows(page);

    expect(result).toHaveLength(rows.length);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(chamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("faz uma página extra quando o total é múltiplo exato do tamanho da página", async () => {
    const { page, chamadas } = fakeTable(linhas(PAGE_SIZE));
    const result = await fetchAllRows(page);
    expect(result).toHaveLength(PAGE_SIZE);
    expect(chamadas).toHaveLength(2);
  });

  it("uma única página basta quando o volume está abaixo do teto", async () => {
    const { page, chamadas } = fakeTable(linhas(37));
    expect(await fetchAllRows(page)).toHaveLength(37);
    expect(chamadas).toHaveLength(1);
  });

  it("propaga erro do PostgREST em vez de devolver lista parcial", async () => {
    await expect(
      fetchAllRows(() =>
        Promise.resolve({ data: null, error: { message: "boom" } as never }),
      ),
    ).rejects.toMatchObject({ message: "boom" });
  });
});
