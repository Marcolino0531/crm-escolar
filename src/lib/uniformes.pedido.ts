// Montagem das linhas da planilha de pedido de uniformes. Isolado da rota
// (`uniformes.api.ts`) por ser lógica pura, sem Supabase nem ExcelJS.

import { STORES, notificaEstoqueBaixo, type StoreKey } from "./nuvemshop.stores";

export const ORDER_QUANTITY = 10;

const STORE_LABEL: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.key, s.label]));

export type VariacaoPedido = {
  store_key: StoreKey;
  ns_product_id: string;
  size: string | null;
  sku: string | null;
  stock: number;
  min_stock: number;
};

export type LinhaPedido = {
  loja: string;
  peca: string;
  tamanho: string;
  sku: string;
  saldo: number;
  solicitar: number;
};

// Entram na planilha só as peças que o alerta de estoque baixo considera: saldo
// abaixo do mínimo (saldo igual ao mínimo não é reposto) e peça que ainda é
// reposta junto à fábrica — ficam de fora as de algodão (sob encomenda), o
// uniforme antigo do CEC/CEC Baby (sem "/ Azul") e o Vale do Sereno,
// descontinuado.
export function linhasDoPedido(
  variacoes: VariacaoPedido[],
  nomePorProduto: Map<string, string>,
): LinhaPedido[] {
  return variacoes
    .filter((v) =>
      notificaEstoqueBaixo({
        storeKey: v.store_key,
        produto: nomePorProduto.get(`${v.store_key}:${v.ns_product_id}`),
        stock: v.stock,
        minStock: v.min_stock,
      }),
    )
    .map((v) => ({
      loja: STORE_LABEL[v.store_key] ?? v.store_key,
      peca: nomePorProduto.get(`${v.store_key}:${v.ns_product_id}`) || "—",
      tamanho: v.size || "—",
      sku: v.sku || "—",
      saldo: v.stock,
      solicitar: ORDER_QUANTITY,
    }))
    .sort(
      (a, b) =>
        a.peca.localeCompare(b.peca, "pt-BR") || a.tamanho.localeCompare(b.tamanho, "pt-BR"),
    );
}
