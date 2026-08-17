// Cálculo puro do valor total da dívida usado na cobrança automática.
//
// Separa a AGREGAÇÃO do valor (filtro de parcelas vencidas + regra contratual de
// multa/juros) da coleta no Sponte, para ser testável isoladamente e evitar o
// bug de somar parcelas com vencimento futuro (ainda não vencidas) no total.

// Regra contratual de atualização de débitos em atraso (Cenário B):
//   multa de 2% (uma única vez) + juros de mora de 1% ao mês, pró rata die
// (proporcional aos dias exatos de atraso), sobre o valor original da parcela.
export const MULTA_ATRASO = 0.02;
export const JUROS_MORA_MES = 0.01;

export interface ParcelaAberta {
  vencimento: string; // YYYY-MM-DD
  saldo: number; // valor em aberto (original - pago); já exclui a parte paga
}

// Dias entre duas datas YYYY-MM-DD (timezone-safe: usa só os componentes, sem
// new Date() local, pois a Vercel roda em UTC). Positivo = `ate` após `de`.
export function diasEntreYMD(de: string, ate: string): number {
  const [fy, fm, fd] = de.split("-").map(Number);
  const [ty, tm, td] = ate.split("-").map(Number);
  if (!fy || !ty) return 0;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Valor de UMA parcela atualizado para `hojeYMD`: sem atraso devolve o original;
// vencida aplica 2% de multa + 1%/mês de juros pró rata die sobre os dias de atraso.
export function valorAtualizadoParcela(
  original: number,
  vencimentoYMD: string,
  hojeYMD: string,
): number {
  const dias = diasEntreYMD(vencimentoYMD, hojeYMD);
  if (dias <= 0 || !vencimentoYMD) return original;
  const multa = original * MULTA_ATRASO;
  const juros = original * JUROS_MORA_MES * (dias / 30);
  return original + multa + juros;
}

// Filtra as parcelas que entram no total da cobrança: apenas as VENCIDAS na data
// do disparo — vencimento preenchido e ESTRITAMENTE anterior a hoje — e com
// saldo em aberto (> 0). Nunca inclui parcelas com vencimento futuro nem já
// quitadas (saldo <= 0). É o coração da correção do cálculo.
//
// A parcela que vence HOJE fica de fora: o cron dispara às 09h e o pagador tem o
// dia inteiro para pagar, então ela não está em atraso (nem gera multa/juros).
// Incluí-la inflava o "valor total atualizado da dívida" com uma parcela do dia.
// Isso não deixa de cobrar nada: a régua só dispara 2 dias úteis após o
// vencimento, nunca no próprio dia.
export function parcelasVencidas<T extends ParcelaAberta>(boletos: T[], hojeYMD: string): T[] {
  return boletos.filter((b) => b.vencimento && b.vencimento < hojeYMD && b.saldo > 0);
}

// Soma o valor ATUALIZADO no dia do disparo apenas das parcelas VENCIDAS (o
// filtro acima), aplicando a regra contratual parcela a parcela. Parcelas
// futuras e já pagas ficam de fora.
export function calcularTotalVencido(boletos: ParcelaAberta[], hojeYMD: string): number {
  const total = parcelasVencidas(boletos, hojeYMD).reduce(
    (soma, b) => soma + valorAtualizadoParcela(b.saldo, b.vencimento, hojeYMD),
    0,
  );
  return Math.round(total * 100) / 100;
}
