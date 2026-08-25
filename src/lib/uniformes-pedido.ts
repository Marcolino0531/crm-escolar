// Uniformes — ciclo de vida da marcação "Pedido realizado".
//
// A peça é marcada à mão quando o pedido é enviado à fábrica e o ciclo se
// encerra sozinho quando o saldo volta ao nível mínimo (pedido atendido).
// Enquanto o saldo continuar abaixo do mínimo a marcação permanece, e depois de
// DIAS_PEDIDO_EM_ATRASO dias ela passa a contar como pedido não atendido.

import { abaixoDoEstoqueMinimo } from "./nuvemshop.stores";

export const DIAS_PEDIDO_EM_ATRASO = 30;

export type EstadoPedido = {
  orderPlacedAt: string | null;
  stock: number;
  minStock: number;
};

// O pedido foi atendido: havia marcação e o saldo já não está abaixo do mínimo.
export function pedidoFoiAtendido({ orderPlacedAt, stock, minStock }: EstadoPedido): boolean {
  if (!orderPlacedAt) return false;
  return !abaixoDoEstoqueMinimo(stock, minStock);
}

export function diasDesdePedido(orderPlacedAt: string | null, agora: Date): number | null {
  if (!orderPlacedAt) return null;
  const inicio = new Date(orderPlacedAt).getTime();
  if (Number.isNaN(inicio)) return null;
  return Math.floor((agora.getTime() - inicio) / 86_400_000);
}

// Pedido marcado há muito tempo e peça ainda em falta: a fábrica não atendeu.
export function pedidoEmAtraso(
  estado: EstadoPedido,
  agora: Date,
  dias: number = DIAS_PEDIDO_EM_ATRASO,
): boolean {
  if (pedidoFoiAtendido(estado)) return false;
  const decorridos = diasDesdePedido(estado.orderPlacedAt, agora);
  return decorridos !== null && decorridos >= dias;
}
