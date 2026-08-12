// Exceções da cobrança automática por ACORDO DE PARCELAMENTO.
//
// Regra de negócio: quando o acordo é fechado direto com o responsável, a
// automação de WhatsApp deve parar de insistir nas parcelas anteriores ao
// acordo, mas continuar cobrando o que vencer depois dele. A exceção guarda o
// MÊS DE REFERÊNCIA do acordo (YYYY-MM); parcelas com vencimento até o último
// dia desse mês (inclusive) saem da régua.
//
// A exceção afeta SOMENTE o disparo automático: nada é escrito no Sponte nem
// nos débitos do School Hub, e as parcelas continuam contando em Inadimplência,
// Fluxo Futuro etc. Remover a exceção devolve o aluno à régua completa, sem
// nenhum resíduo — por isso o filtro é aplicado na hora do disparo, e não
// gravado nas parcelas.
//
// Aqui ficam apenas funções puras; a leitura da tabela e o envio ficam no cron.

// Exceção cadastrada para um aluno.
export interface ExcecaoCobranca {
  alunoId: string;
  // Mês do acordo, no formato YYYY-MM. Parcelas vencidas até o fim dele saem.
  mesReferencia: string;
}

// Parcela vista pelo filtro: de qual aluno é e quando vence.
export interface ParcelaComAluno {
  alunoId: string;
  vencimento: string; // YYYY-MM-DD
}

// Mês de referência válido: YYYY-MM com mês entre 01 e 12.
export function isMesReferencia(valor: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor ?? "");
}

// Mês do vencimento ("2026-07-31" → "2026-07"). Vazio para data inválida.
export function mesDoVencimento(vencimentoYMD: string): string {
  const mes = (vencimentoYMD ?? "").slice(0, 7);
  return isMesReferencia(mes) ? mes : "";
}

// AlunoID → mês de referência do acordo. Com mais de uma exceção para o mesmo
// aluno, vale a de mês MAIOR (o acordo mais recente cobre mais parcelas).
export function mapaExcecoes(excecoes: ExcecaoCobranca[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const e of excecoes) {
    const alunoId = (e.alunoId ?? "").trim();
    if (!alunoId || !isMesReferencia(e.mesReferencia)) continue;
    const atual = mapa.get(alunoId);
    if (!atual || e.mesReferencia > atual) mapa.set(alunoId, e.mesReferencia);
  }
  return mapa;
}

// O vencimento está coberto pelo acordo? Compara mês a mês, então o dia do
// vencimento não importa: todo o mês de referência entra.
export function cobertoPeloAcordo(vencimentoYMD: string, mesReferencia: string): boolean {
  const mes = mesDoVencimento(vencimentoYMD);
  if (!mes || !isMesReferencia(mesReferencia)) return false;
  return mes <= mesReferencia;
}

// Parcela isenta de cobrança automática (aluno com acordo e vencimento coberto).
export function parcelaIsentaPorAcordo(
  parcela: ParcelaComAluno,
  excecoes: Map<string, string>,
): boolean {
  const mesReferencia = excecoes.get(parcela.alunoId);
  if (!mesReferencia) return false;
  return cobertoPeloAcordo(parcela.vencimento, mesReferencia);
}

// Remove das parcelas cobráveis o que estiver coberto por acordo. Aluno sem
// exceção (ou com exceção removida, que simplesmente não está no mapa) passa
// inteiro — é o que faz a remoção da exceção voltar a cobrar tudo.
export function filtrarPorAcordo<T extends ParcelaComAluno>(
  parcelas: T[],
  excecoes: Map<string, string>,
): T[] {
  if (excecoes.size === 0) return parcelas;
  return parcelas.filter((p) => !parcelaIsentaPorAcordo(p, excecoes));
}

// Variante para as parcelas de UM aluno (usada no total da dívida, cuja lista
// vem indexada por aluno e não carrega o AlunoID em cada item). Também serve
// para não exibir/somar no template o que o acordo já cobriu.
export function filtrarPorAcordoDoAluno<T extends { vencimento: string }>(
  alunoId: string,
  parcelas: T[],
  excecoes: Map<string, string>,
): T[] {
  const mesReferencia = excecoes.get(alunoId);
  if (!mesReferencia) return parcelas;
  return parcelas.filter((p) => !cobertoPeloAcordo(p.vencimento, mesReferencia));
}

// Rótulo do mês de referência para a tela ("2026-07" → "julho de 2026").
export function rotuloMesReferencia(mesReferencia: string): string {
  if (!isMesReferencia(mesReferencia)) return mesReferencia ?? "";
  const [ano, mes] = mesReferencia.split("-").map(Number);
  const nome = new Date(Date.UTC(ano, mes - 1, 1)).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return nome;
}
