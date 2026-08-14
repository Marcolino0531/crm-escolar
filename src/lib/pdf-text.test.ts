import { describe, it, expect, vi } from "vitest";
import { lerItensDeTexto } from "./pdf-text";

// Página do pdfjs cujo stream só oferece `getReader()` — é o caso do Safari,
// onde `ReadableStream` não é async iterable e o for-await interno do
// `getTextContent()` estoura com "undefined is not a function".
function paginaComStream(chunks: Array<{ items?: unknown }>) {
  let i = 0;
  return {
    streamTextContent: () => ({
      getReader: () => ({
        read: async () => (i < chunks.length ? { value: chunks[i++] } : { done: true }),
      }),
    }),
  };
}

describe("leitura dos itens de texto da página", () => {
  it("concatena os itens de todos os chunks do stream", async () => {
    const page = paginaComStream([{ items: ["a", "b"] }, { items: ["c"] }]);
    await expect(lerItensDeTexto(page)).resolves.toEqual(["a", "b", "c"]);
  });

  it("chunk sem itens não interrompe a leitura antes do done", async () => {
    const page = paginaComStream([{}, { items: undefined }, { items: ["z"] }]);
    await expect(lerItensDeTexto(page)).resolves.toEqual(["z"]);
  });

  it("stream vazio devolve lista vazia, não exceção", async () => {
    await expect(lerItensDeTexto(paginaComStream([]))).resolves.toEqual([]);
  });

  it("não usa getTextContent quando o stream existe (é ele que quebra no Safari)", async () => {
    const getTextContent = vi.fn();
    await lerItensDeTexto({ ...paginaComStream([{ items: ["x"] }]), getTextContent });
    expect(getTextContent).not.toHaveBeenCalled();
  });

  it("sem stream, cai no getTextContent e tolera resposta fora do contrato", async () => {
    await expect(
      lerItensDeTexto({ getTextContent: async () => ({ items: ["a"] }) }),
    ).resolves.toEqual(["a"]);
    await expect(lerItensDeTexto({ getTextContent: async () => ({}) })).resolves.toEqual([]);
    await expect(lerItensDeTexto({})).resolves.toEqual([]);
  });
});
