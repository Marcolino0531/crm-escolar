import { normalizarTexto } from "./sponte-baixa";

// Montagem e leitura da chamada InsertPlano do Sponte — o único mecanismo de
// escrita financeira da API: cria uma CONTA A RECEBER nova (título de 1
// parcela). Não existe método para acrescentar um item a um boleto de
// mensalidade já emitido.
//
// Parte pura, sem rede: é o que precisa estar certo para não cobrar valor,
// categoria ou vencimento errados da família (Fechamento da Colônia e recargas
// da Cantina).

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ParametrosInsertPlano {
  sponteAlunoId: string;
  valor: number;
  vencimento: string; // YYYY-MM-DD
  formaCobrancaId: number;
  categoriaId: number;
  observacao: string;
}

// Parcela única: uma recarga/fechamento é sempre uma cobrança só, no vencimento
// informado. A ordem das tags segue o WSDL.
export function montarParametrosInsertPlano(p: ParametrosInsertPlano): string {
  return (
    `<nContratoID>0</nContratoID>` +
    `<nContratoAulaLivreID>0</nContratoAulaLivreID>` +
    `<nAlunoID>${escapeXml(p.sponteAlunoId)}</nAlunoID>` +
    `<nTipoPlano>1</nTipoPlano>` +
    `<nBolsaID>0</nBolsaID>` +
    `<dDataPrimeiroVencimento>${p.vencimento}T00:00:00</dDataPrimeiroVencimento>` +
    `<nNumeroParcelas>1</nNumeroParcelas>` +
    `<nValorParcelas>${p.valor.toFixed(2)}</nValorParcelas>` +
    `<nFormaCobrancaID>${p.formaCobrancaId}</nFormaCobrancaID>` +
    `<nCategoriaID>${p.categoriaId}</nCategoriaID>` +
    `<sObservacao>${escapeXml(p.observacao)}</sObservacao>` +
    `<nClienteID>0</nClienteID>` +
    `<nContaID>0</nContaID>`
  );
}

// A cobrança só é considerada criada com confirmação do Sponte: ID de conta a
// receber positivo ou retorno explícito de sucesso. Qualquer outra resposta
// (ID 0, vazio, mensagem de erro) é falha — nunca se reporta lançamento feito
// sem essa confirmação.
export function contaReceberCriada(retornoOperacao: string, contaReceberID: string): boolean {
  const conta = parseInt(contaReceberID, 10);
  if (Number.isFinite(conta) && conta > 0) return true;
  return normalizarTexto(retornoOperacao).includes("sucesso");
}
