// Leitura dos itens de texto de uma página do pdfjs.
//
// `page.getTextContent()` NÃO pode ser usado: internamente ele faz
// `for await (const value of readableStream)`, e o Safari não implementa
// `ReadableStream.prototype[Symbol.asyncIterator]` — o for-await estoura com
// "undefined is not a function" dentro do próprio pdfjs. Consumimos o stream
// pelo reader, que é suportado em todos os navegadores.

type ChunkTexto = { items?: unknown };

type PaginaComStream = {
  streamTextContent?: () => {
    getReader?: () => { read: () => Promise<{ value?: ChunkTexto; done?: boolean }> };
  };
  getTextContent?: () => Promise<ChunkTexto>;
};

export async function lerItensDeTexto(page: PaginaComStream): Promise<unknown[]> {
  const reader = page.streamTextContent?.()?.getReader?.();

  // Versão do pdfjs sem stream: cai no caminho antigo.
  if (!reader) {
    const content = await page.getTextContent?.();
    return Array.isArray(content?.items) ? content.items : [];
  }

  const itens: unknown[] = [];
  for (;;) {
    const chunk = await reader.read();
    if (chunk?.done) break;
    const items = chunk?.value?.items;
    if (Array.isArray(items)) itens.push(...items);
    // Chunk sem itens é possível (página vazia); só o `done` encerra a leitura.
  }
  return itens;
}
