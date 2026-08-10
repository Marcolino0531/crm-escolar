// Regras puras da RECORRÊNCIA da cobrança automática por WhatsApp.
//
// Regra de negócio:
//   1. A parcela vencida ganha 2 DIAS ÚTEIS de tolerância antes da 1ª cobrança.
//   2. Depois da tolerância, cobra TODOS OS DIAS ÚTEIS enquanto continuar em aberto.
//   3. Pagamento identificado no Sponte (data de pagamento preenchida ou saldo
//      zerado) encerra a cobrança daquela parcela no mesmo dia.
//   4. Um responsável recebe UMA mensagem por dia, agregando todas as parcelas
//      vencidas de todos os seus alunos.
//   5. Sábados, domingos e feriados nacionais nunca disparam (ver billing-schedule).
//
// Aqui ficam apenas funções puras (aritmética de dias úteis, filtro de parcelas
// e agregação por responsável); a coleta no Sponte e o envio ficam no cron.

import { addDaysYMD, isDiaUtil } from "./billing-schedule";
import { calcularTotalVencido, type ParcelaAberta } from "./billing-debt";

// Dias úteis de tolerância entre o vencimento e a primeira cobrança.
export const TOLERANCIA_DIAS_UTEIS = 2;

// "YYYY-MM-DD" avançado em `n` DIAS ÚTEIS (fins de semana e feriados não contam).
export function addDiasUteis(ymd: string, n: number): string {
  let atual = ymd;
  let restantes = n;
  while (restantes > 0) {
    atual = addDaysYMD(atual, 1);
    if (isDiaUtil(atual)) restantes--;
  }
  return atual;
}

// Primeiro dia em que a parcela pode ser cobrada: o `tolerancia`-ésimo dia útil
// após o vencimento. Sempre cai num dia útil, por construção.
export function primeiroDiaCobranca(
  vencimentoYMD: string,
  tolerancia = TOLERANCIA_DIAS_UTEIS,
): string {
  return addDiasUteis(vencimentoYMD, tolerancia);
}

// A parcela já passou da tolerância e `hoje` é dia útil? A partir daí a cobrança
// se repete diariamente (não é um gatilho de um único dia).
export function toleranciaCumprida(
  vencimentoYMD: string,
  hojeYMD: string,
  tolerancia = TOLERANCIA_DIAS_UTEIS,
): boolean {
  if (!vencimentoYMD) return false;
  if (!isDiaUtil(hojeYMD)) return false;
  return hojeYMD >= primeiroDiaCobranca(vencimentoYMD, tolerancia);
}

// Vencimentos que ENTRAM em cobrança hoje (1º dia após a tolerância). Usado pelo
// cron para descobrir novos devedores sem varrer todo o histórico de vencimentos:
// os já cobrados antes voltam pelo histórico de disparos.
export function vencimentosEntrandoEmCobranca(
  hojeYMD: string,
  tolerancia = TOLERANCIA_DIAS_UTEIS,
): string[] {
  if (!isDiaUtil(hojeYMD)) return [];
  const vencimentos: string[] = [];
  // Janela de busca generosa (cobre emendas de feriado) — o filtro é exato.
  for (let i = 1; i <= 20; i++) {
    const v = addDaysYMD(hojeYMD, -i);
    if (primeiroDiaCobranca(v, tolerancia) === hojeYMD) vencimentos.push(v);
  }
  return vencimentos.sort();
}

// Parcela em aberto de um aluno, como devolvida pelo Sponte.
export interface ParcelaCobranca extends ParcelaAberta {
  alunoId: string;
  alunoNome: string;
  unidade: string;
  telefone: string;
  responsavelNome: string;
  // Data de pagamento no Sponte (YYYY-MM-DD). Preenchida = quitada, encerra a
  // cobrança daquela parcela imediatamente.
  dataPagamento?: string;
  linhaDigitavel?: string;
}

// Parcela quitada: data de pagamento preenchida no Sponte ou saldo zerado.
export function parcelaQuitada(p: ParcelaCobranca): boolean {
  return Boolean(p.dataPagamento && p.dataPagamento.trim()) || p.saldo <= 0;
}

// Parcelas que autorizam disparo HOJE: em aberto, vencidas, fora da tolerância e
// com vencimento a partir da data base da automação.
export function parcelasCobraveis(
  parcelas: ParcelaCobranca[],
  hojeYMD: string,
  dataBase: string,
  tolerancia = TOLERANCIA_DIAS_UTEIS,
): ParcelaCobranca[] {
  return parcelas.filter(
    (p) =>
      !parcelaQuitada(p) &&
      p.vencimento >= dataBase &&
      toleranciaCumprida(p.vencimento, hojeYMD, tolerancia),
  );
}

// Chave de agrupamento do responsável: últimos 8 dígitos do telefone (imune a
// formatação, DDI e ao 9º dígito).
export function chaveTelefone(telefone: string): string {
  return (telefone ?? "").replace(/\D/g, "").slice(-8);
}

// Lista de nomes em português: "A", "A e B", "A, B e C".
export function juntarNomes(nomes: string[]): string {
  const limpos = [...new Set(nomes.map((n) => n.trim()).filter(Boolean))];
  if (limpos.length <= 1) return limpos[0] ?? "";
  return `${limpos.slice(0, -1).join(", ")} e ${limpos[limpos.length - 1]}`;
}

// Uma mensagem diária por responsável, agregando as parcelas de todos os alunos.
export interface GrupoCobranca {
  chave: string;
  telefone: string;
  responsavelNome: string;
  unidade: string;
  alunoIds: string[];
  alunosLabel: string;
  parcelas: ParcelaCobranca[];
  // Vencimento mais antigo em aberto (referência no log e no template simples).
  vencimentoMaisAntigo: string;
  // Total atualizado (multa + juros) de TODAS as parcelas vencidas do grupo.
  totalAtualizado: number;
  // Mais de uma parcela vencida (ou mais de um aluno) → template de cobrança múltipla.
  multipla: boolean;
}

// Agrupa as parcelas cobráveis por responsável (telefone). `parcelasVencidasPorAluno`
// traz TODAS as parcelas vencidas do aluno (inclusive as ainda em tolerância), que
// entram no valor total da dívida sem, por si só, disparar a cobrança.
export function agruparPorResponsavel(
  cobraveis: ParcelaCobranca[],
  hojeYMD: string,
  parcelasVencidasPorAluno: Map<string, ParcelaAberta[]> = new Map(),
): GrupoCobranca[] {
  const mapa = new Map<string, ParcelaCobranca[]>();
  for (const p of cobraveis) {
    const chave = chaveTelefone(p.telefone);
    if (!chave) continue;
    const atual = mapa.get(chave);
    if (atual) atual.push(p);
    else mapa.set(chave, [p]);
  }

  const grupos: GrupoCobranca[] = [];
  for (const [chave, parcelas] of mapa) {
    const ordenadas = [...parcelas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const alunoIds = [...new Set(ordenadas.map((p) => p.alunoId))];
    const paraTotal: ParcelaAberta[] = [];
    for (const alunoId of alunoIds) {
      const vencidas = parcelasVencidasPorAluno.get(alunoId);
      if (vencidas && vencidas.length > 0) paraTotal.push(...vencidas);
      else paraTotal.push(...ordenadas.filter((p) => p.alunoId === alunoId));
    }
    grupos.push({
      chave,
      telefone: ordenadas[0].telefone,
      responsavelNome: ordenadas[0].responsavelNome,
      unidade: ordenadas[0].unidade,
      alunoIds,
      alunosLabel: juntarNomes(ordenadas.map((p) => p.alunoNome)),
      parcelas: ordenadas,
      vencimentoMaisAntigo: ordenadas[0].vencimento,
      totalAtualizado: calcularTotalVencido(paraTotal, hojeYMD),
      multipla: paraTotal.length > 1 || alunoIds.length > 1,
    });
  }
  return grupos.sort((a, b) => a.chave.localeCompare(b.chave));
}

// Idempotência do dia: telefones que já receberam disparo hoje (o cron pode
// rodar mais de uma vez). Compara pelos últimos 8 dígitos.
export function jaCobradoHoje(telefonesEnviadosHoje: string[], telefone: string): boolean {
  const chave = chaveTelefone(telefone);
  if (!chave) return false;
  return telefonesEnviadosHoje.some((t) => chaveTelefone(t) === chave);
}
