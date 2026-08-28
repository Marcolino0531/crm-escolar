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
  // Quantidade de parcelas do título (padrão 1). O InsertPlano só aceita UM
  // valor para todas as parcelas: não existe campo de "1ª parcela
  // diferenciada" no WSDL, então o ajuste de centavos da última parcela é
  // feito depois, com UpdateParcela.
  parcelas?: number;
}

// A ordem das tags segue o WSDL.
export function montarParametrosInsertPlano(p: ParametrosInsertPlano): string {
  const parcelas = Math.max(1, Math.trunc(p.parcelas ?? 1));
  return (
    `<nContratoID>0</nContratoID>` +
    `<nContratoAulaLivreID>0</nContratoAulaLivreID>` +
    `<nAlunoID>${escapeXml(p.sponteAlunoId)}</nAlunoID>` +
    `<nTipoPlano>1</nTipoPlano>` +
    `<nBolsaID>0</nBolsaID>` +
    `<dDataPrimeiroVencimento>${p.vencimento}T00:00:00</dDataPrimeiroVencimento>` +
    `<nNumeroParcelas>${parcelas}</nNumeroParcelas>` +
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

export interface ParametrosUpdateParcela {
  contaReceberId: string;
  numeroParcela: number;
  // Todos os campos são obrigatórios na prática: o serviço do Sponte falha com
  // "Object reference not set to an instance of an object" quando algum dos
  // campos declarados como opcionais no WSDL não vem na requisição. Quem chama
  // reenvia o valor ATUAL da parcela nos campos que não está alterando.
  valor: number;
  vencimento: string; // YYYY-MM-DD
  formaCobrancaId: number;
  categoriaId: number;
  observacao: string;
}

// Ajuste de UMA parcela de um título existente (usado para deixar a última
// parcela com os centavos da divisão inexata e para corrigir vencimento que o
// InsertPlano criou em fim de semana/feriado).
export function montarParametrosUpdateParcela(p: ParametrosUpdateParcela): string {
  return (
    `<nContaReceberID>${escapeXml(p.contaReceberId)}</nContaReceberID>` +
    `<nNumeroParcela>${Math.trunc(p.numeroParcela)}</nNumeroParcela>` +
    `<nBolsaID>0</nBolsaID>` +
    `<dDataVencimento>${p.vencimento}T00:00:00</dDataVencimento>` +
    `<nValor>${p.valor.toFixed(2)}</nValor>` +
    `<nFormaCobrancaID>${p.formaCobrancaId}</nFormaCobrancaID>` +
    `<nCategoriaID>${p.categoriaId}</nCategoriaID>` +
    `<sObservacao>${escapeXml(p.observacao)}</sObservacao>`
  );
}
