import { describe, expect, it } from "vitest";
import { ORDER_QUANTITY, linhasDoPedido, type VariacaoPedido } from "./uniformes.pedido";

const nomes = new Map<string, string>([
  ["belvedere:1", "BELVEDERE - COLETE"],
  ["belvedere:2", "REGATA (ALGODÃO)"],
  ["belvedere:3", "VALE DO SERENO - REGATA"],
  ["cec:10", "BERMUDA TACTEL / Azul"],
  ["cec:11", "BERMUDA TACTEL"],
]);

function variacao(
  store_key: "belvedere" | "cec",
  ns_product_id: string,
  size: string,
  stock: number,
): VariacaoPedido {
  return {
    store_key,
    ns_product_id,
    size,
    sku: `SKU-${ns_product_id}-${size}`,
    stock,
    min_stock: 5,
  };
}

function pecas(variacoes: VariacaoPedido[]): string[] {
  return linhasDoPedido(variacoes, nomes).map((l) => `${l.peca} ${l.tamanho}`);
}

describe("planilha de pedido — limite do estoque mínimo", () => {
  it("inclui a peça com menos de 5 unidades", () => {
    expect(pecas([variacao("belvedere", "1", "M", 4)])).toEqual(["BELVEDERE - COLETE M"]);
    expect(pecas([variacao("belvedere", "1", "M", 0)])).toEqual(["BELVEDERE - COLETE M"]);
  });

  it("não inclui a peça com exatamente 5 unidades nem acima", () => {
    expect(pecas([variacao("belvedere", "1", "M", 5)])).toEqual([]);
    expect(pecas([variacao("belvedere", "1", "M", 9)])).toEqual([]);
  });
});

describe("planilha de pedido — peças que não são repostas", () => {
  it("não inclui peça de algodão (sob encomenda), mesmo zerada", () => {
    expect(pecas([variacao("belvedere", "2", "G", 0)])).toEqual([]);
  });

  it("não inclui peça descontinuada do Vale do Sereno, mesmo zerada", () => {
    expect(pecas([variacao("belvedere", "3", "G", 0)])).toEqual([]);
  });

  it("não inclui o uniforme antigo do CEC (sem '/ Azul'), mesmo zerado", () => {
    expect(pecas([variacao("cec", "11", "8", 0)])).toEqual([]);
  });

  it("inclui o modelo novo do CEC ('/ Azul') abaixo do mínimo", () => {
    expect(pecas([variacao("cec", "10", "8", 2)])).toEqual(["BERMUDA TACTEL / Azul 8"]);
  });
});

describe("planilha de pedido — montagem das linhas", () => {
  it("mantém só as peças elegíveis, ordenadas por peça e tamanho", () => {
    const linhas = linhasDoPedido(
      [
        variacao("belvedere", "1", "M", 4),
        variacao("belvedere", "1", "G", 1),
        variacao("belvedere", "1", "P", 5),
        variacao("belvedere", "2", "G", 0),
        variacao("cec", "11", "8", 0),
        variacao("cec", "10", "10", 3),
      ],
      nomes,
    );
    expect(linhas.map((l) => `${l.peca} ${l.tamanho}`)).toEqual([
      "BELVEDERE - COLETE G",
      "BELVEDERE - COLETE M",
      "BERMUDA TACTEL / Azul 10",
    ]);
    expect(linhas.map((l) => l.saldo)).toEqual([1, 4, 3]);
    expect(linhas.every((l) => l.solicitar === ORDER_QUANTITY)).toBe(true);
    expect(linhas[0].loja).toBe("Belvedere / Vale do Sereno");
    expect(linhas[2].loja).toBe("CEC / CEC Baby");
  });

  it("usa travessão quando falta o nome do produto, tamanho ou SKU", () => {
    const [linha] = linhasDoPedido(
      [
        {
          store_key: "belvedere",
          ns_product_id: "99",
          size: "",
          sku: null,
          stock: 0,
          min_stock: 5,
        },
      ],
      nomes,
    );
    expect(linha).toMatchObject({ peca: "—", tamanho: "—", sku: "—" });
  });
});
