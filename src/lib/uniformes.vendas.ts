// Agregação de vendas de uniformes a partir dos pedidos da Nuvemshop. Lógica
// pura (sem Supabase, sem fetch): a rota `uniformes.api.ts` busca os pedidos e
// as variações espelhadas e delega o cálculo para cá.
//
// Regra combinada com o usuário: conta a venda pela DATA DE PAGAMENTO, só de
// pedido pago, excluindo cancelado.
//
// Boa parte dos pedidos pagos por gateway (PagBank, por exemplo) volta da API
// com `paid_at` nulo; nesses casos a data do pagamento é a de conclusão
// (`completed_at`), com a criação do pedido como último recurso.

import type { StoreKey } from "./nuvemshop.stores";

const TZ = "America/Sao_Paulo";

// Campos usados de GET /orders. O restante da resposta é ignorado.
export type PedidoVenda = {
  status?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  // A API devolve `completed_at` como objeto ({ date, timezone }) ou string.
  completed_at?: string | { date?: string | null } | null;
  created_at?: string | null;
  cancelled_at?: string | null;
  products?: ItemPedido[] | null;
};

export type ItemPedido = {
  product_id?: number | string | null;
  variant_id?: number | string | null;
  name?: string | null;
  sku?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
};

export type VendaAgregada = {
  storeKey: StoreKey;
  produto: string;
  tamanho: string;
  quantidade: number;
  receita: number;
};

// Ano civil (fuso de São Paulo) de um instante ISO. Pedido pago em 31/12 às 22h
// BRT é de 2026, não de 2027 como o UTC diria.
export function anoBRT(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(normalizaData(iso));
  if (Number.isNaN(d.getTime())) return null;
  const ymd = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const ano = Number(ymd.slice(0, 4));
  return Number.isFinite(ano) ? ano : null;
}

// Data civil (fuso de São Paulo, YYYY-MM-DD) de um instante ISO.
export function dataBRT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(normalizaData(iso));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

// Pedido pago e não cancelado — a parte da regra que não depende do período.
function pedidoPago(pedido: PedidoVenda): boolean {
  if ((pedido.payment_status ?? "").toLowerCase() !== "paid") return false;
  if ((pedido.status ?? "").toLowerCase() === "cancelled") return false;
  return !pedido.cancelled_at;
}

// Pedido que representa peça efetivamente vendida no ano: pago, não cancelado e
// com o pagamento dentro do ano pedido.
export function vendaDoAno(pedido: PedidoVenda, ano: number): boolean {
  return pedidoPago(pedido) && anoBRT(dataDaVenda(pedido)) === ano;
}

// Mesma regra do ano, para um intervalo de datas (inclusivo, fuso de São Paulo).
export function vendaNoPeriodo(
  pedido: PedidoVenda,
  dataInicio: string,
  dataFim: string,
): boolean {
  if (!pedidoPago(pedido)) return false;
  const data = dataBRT(dataDaVenda(pedido));
  return data !== null && data >= dataInicio && data <= dataFim;
}

// "2026-08-04 19:06:11.000000" (UTC, formato do `completed_at`) não é aceito
// pelo construtor de Date em todo runtime — vira ISO com sufixo Z.
function normalizaData(valor: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(valor.trim());
  return m ? `${m[1]}T${m[2]}Z` : valor;
}

// Instante em que a venda foi paga. `paid_at` é a fonte preferida; quando o
// gateway não preenche, a conclusão do pedido é o momento do pagamento.
export function dataDaVenda(pedido: PedidoVenda): string | null {
  const completado =
    typeof pedido.completed_at === "string" ? pedido.completed_at : pedido.completed_at?.date;
  return pedido.paid_at || completado || pedido.created_at || null;
}

function quantidade(item: ItemPedido): number {
  const n = Number(item.quantity ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function preco(item: ItemPedido): number {
  const n = Number(item.price ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type CatalogoVariacoes = {
  // `${storeKey}:${ns_variant_id}` → tamanho espelhado da variação.
  tamanhoPorVariacao: Map<string, string>;
  // `${storeKey}:${ns_product_id}` → nome atual do produto.
  nomePorProduto: Map<string, string>;
};

// Soma as quantidades vendidas por peça e tamanho. O agrupamento é por
// `product_id`/`variant_id` (e não pelo nome gravado no pedido), para que peça
// renomeada no meio do ano não se divida em duas linhas; o rótulo exibido é o
// nome atual do catálogo, caindo para o nome do pedido quando a peça já não
// existe mais.
export function agregaVendas(
  storeKey: StoreKey,
  pedidos: PedidoVenda[],
  ano: number,
  catalogo: CatalogoVariacoes,
): VendaAgregada[] {
  return agregaVendasSe(storeKey, pedidos, catalogo, (p) => vendaDoAno(p, ano));
}

// Vendas de um intervalo de datas, com a mesma agregação por peça e tamanho.
export function agregaVendasPorPeriodo(
  storeKey: StoreKey,
  pedidos: PedidoVenda[],
  dataInicio: string,
  dataFim: string,
  catalogo: CatalogoVariacoes,
): VendaAgregada[] {
  return agregaVendasSe(storeKey, pedidos, catalogo, (p) =>
    vendaNoPeriodo(p, dataInicio, dataFim),
  );
}

function agregaVendasSe(
  storeKey: StoreKey,
  pedidos: PedidoVenda[],
  catalogo: CatalogoVariacoes,
  aceita: (pedido: PedidoVenda) => boolean,
): VendaAgregada[] {
  const acc = new Map<string, VendaAgregada>();

  for (const pedido of pedidos) {
    if (!aceita(pedido)) continue;
    for (const item of pedido.products ?? []) {
      const qtd = quantidade(item);
      if (qtd === 0) continue;

      const productId = item.product_id != null ? String(item.product_id) : "";
      const variantId = item.variant_id != null ? String(item.variant_id) : "";
      const produto =
        catalogo.nomePorProduto.get(`${storeKey}:${productId}`) || (item.name ?? "").trim() || "—";
      const tamanho = catalogo.tamanhoPorVariacao.get(`${storeKey}:${variantId}`) || "—";

      const chave = `${productId}|${variantId}`;
      const atual = acc.get(chave);
      if (atual) {
        atual.quantidade += qtd;
        atual.receita += qtd * preco(item);
      } else {
        acc.set(chave, {
          storeKey,
          produto,
          tamanho,
          quantidade: qtd,
          receita: qtd * preco(item),
        });
      }
    }
  }

  return [...acc.values()].sort(
    (a, b) => a.produto.localeCompare(b.produto, "pt-BR") || b.quantidade - a.quantidade,
  );
}
