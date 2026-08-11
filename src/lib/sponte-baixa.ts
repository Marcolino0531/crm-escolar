// Regra pura que decide QUANTO de uma parcela baixada no Sponte entra na linha
// de cobrança bancária compensada do extrato ("COB COMPE" / "BOLETOS RECEBIDOS").
//
// O ponto central: a `FormaCobranca` da parcela vem "Cobrança Bancária" mesmo
// quando o boleto foi PAGO via PIX, e esse PIX cai no extrato como crédito
// avulso, não na linha agregada de boletos. A forma REAL da liquidação está no
// rateio (`TipoRecebimento`) — é ele que manda.

export interface RateioBaixa {
  contaCreditada: string;
  tipoRecebimento: string;
  valorPagoRateado: string; // formato BR ("1.234,56")
}

export interface ParcelaBaixa {
  formaCobranca: string;
  contaCreditar: string;
  valorPago: string; // formato BR
  rateios: RateioBaixa[];
}

export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function parseBrDecimal(value: string): number {
  if (!value) return 0;
  return parseFloat(value.replace(/\./g, "").replace(",", ".")) || 0;
}

// Reconhece liquidações que caem no crédito bancário agregado do extrato:
// somente boletos compensados ("Cobrança Bancária" / "Boleto Bancário"). Exclui
// PIX, dinheiro, cartão etc. O rótulo varia, então casamos por inclusão
// normalizada (sem acento/caixa).
export function ehRecebimentoBancario(forma: string): boolean {
  const f = normalizarTexto(forma);
  return f.includes("cobranca bancaria") || f.includes("boleto");
}

// Casa o nome da Conta Creditada (ex.: "Caixa - 489426") com a conta-caixa da
// unidade usando .includes — tanto no texto cru ("011311") quanto só nos
// dígitos. NÃO removemos zeros à esquerda: a conta do CEC Baby ("011311")
// precisa casar literalmente.
export function contaCaixaBate(contaTexto: string, contaAlvo: string): boolean {
  if (!contaTexto || !contaAlvo) return false;
  if (contaTexto.includes(contaAlvo)) return true;
  const soDigitos = (s: string) => s.replace(/\D/g, "");
  const a = soDigitos(contaTexto);
  const b = soDigitos(contaAlvo);
  return !!b && a.includes(b);
}

/**
 * Valor da parcela que entra na linha de boletos compensados.
 *
 * Sempre filtra pelo `TipoRecebimento` do rateio (a forma real da liquidação);
 * o filtro de conta é aplicado por cima apenas quando a unidade tem conta-caixa
 * configurada — unidades de conta única (Vale do Sereno, cuja Conta Creditada
 * vem como "Caixa", sem número) somam todos os rateios de boleto.
 * Sem rateio, cai para os campos de topo da parcela.
 */
export function valorBoletoDaParcela(parcela: ParcelaBaixa, contaCaixa: string | null): number {
  if (parcela.rateios.length > 0) {
    return parcela.rateios
      .filter(
        (r) =>
          ehRecebimentoBancario(r.tipoRecebimento) &&
          (!contaCaixa || contaCaixaBate(r.contaCreditada, contaCaixa)),
      )
      .reduce((soma, r) => soma + parseBrDecimal(r.valorPagoRateado), 0);
  }
  const contaOk = !contaCaixa || contaCaixaBate(parcela.contaCreditar, contaCaixa);
  return contaOk && ehRecebimentoBancario(parcela.formaCobranca)
    ? parseBrDecimal(parcela.valorPago)
    : 0;
}
