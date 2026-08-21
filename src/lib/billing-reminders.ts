// Regras puras dos LEMBRETES automáticos (régua PREVENTIVA, antes do vencimento).
//
// Régua diferente da cobrança automática (que só age DEPOIS do vencimento):
//   1. Cada parcela em aberto gera lembrete 5 dias antes, 3 dias antes e no
//      próprio dia do vencimento — sempre pelo vencimento REAL da parcela.
//   2. Parcela quitada (data de pagamento no Sponte ou saldo zerado) não gera o
//      lembrete daquele prazo: o pagamento antecipado encerra a régua.
//   3. Um responsável recebe UM lembrete por dia. Se duas parcelas caírem em
//      prazos diferentes no mesmo dia, vale o prazo mais urgente (D-0 > D-3 > D-5).
//   4. Cobrança automática tem prioridade: quem já é cobrado hoje por algo
//      VENCIDO não recebe o lembrete preventivo no mesmo dia.
//   5. Sábados, domingos e feriados não disparam (mesma regra da cobrança).
//
// Só funções puras aqui; a coleta no Sponte e o envio ficam no cron.

import { addDaysYMD } from "./billing-schedule";
import {
  chaveTelefone,
  comporLinhasDigitaveis,
  juntarNomes,
  parcelaQuitada,
  type ParcelaCobranca,
} from "./billing-recurrence";

// Dias de antecedência de cada lembrete, do menos para o mais urgente.
export const PRAZOS_LEMBRETE = [5, 3, 0] as const;
export type PrazoLembrete = (typeof PRAZOS_LEMBRETE)[number];

// Parcela candidata a lembrete: mesma forma da parcela da cobrança (o cron
// reaproveita a coleta do Sponte), mas aqui o vencimento está no futuro.
export type ParcelaLembrete = ParcelaCobranca;

// Vencimento que dispara o lembrete de `prazo` quando hoje é `hojeYMD`.
export function vencimentoAlvo(hojeYMD: string, prazo: PrazoLembrete): string {
  return addDaysYMD(hojeYMD, prazo);
}

// Todos os vencimentos que geram lembrete hoje, do mais urgente ao menos.
export function vencimentosLembreteHoje(hojeYMD: string): { prazo: PrazoLembrete; venc: string }[] {
  return [...PRAZOS_LEMBRETE]
    .sort((a, b) => a - b)
    .map((prazo) => ({ prazo, venc: vencimentoAlvo(hojeYMD, prazo) }));
}

// Prazo do lembrete que este vencimento gera hoje; null quando o vencimento não
// cai em nenhum dos prazos (inclusive quando já venceu — aí é caso de cobrança).
export function prazoDoVencimento(vencimentoYMD: string, hojeYMD: string): PrazoLembrete | null {
  if (!vencimentoYMD) return null;
  return PRAZOS_LEMBRETE.find((p) => vencimentoAlvo(hojeYMD, p) === vencimentoYMD) ?? null;
}

// Texto da variável {{4}} do template aprovado ("em 5 dias", "em 3 dias", "hoje").
export function rotuloPrazo(prazo: PrazoLembrete): string {
  return prazo === 0 ? "hoje" : `em ${prazo} dias`;
}

// Etiqueta curta usada no histórico de disparos.
export function etiquetaPrazo(prazo: PrazoLembrete): string {
  return `D-${prazo}`;
}

// Parcelas que geram lembrete hoje: em aberto e vencendo em D-5, D-3 ou D-0.
export function lembretesEnviaveis(
  parcelas: ParcelaLembrete[],
  hojeYMD: string,
): ParcelaLembrete[] {
  return parcelas.filter(
    (p) => !parcelaQuitada(p) && prazoDoVencimento(p.vencimento, hojeYMD) !== null,
  );
}

// Um lembrete por responsável por dia.
export interface GrupoLembrete {
  chave: string;
  telefone: string;
  responsavelNome: string;
  unidade: string;
  alunoIds: string[];
  alunosLabel: string;
  prazo: PrazoLembrete;
  vencimento: string;
  // Soma dos saldos das parcelas daquele vencimento. Sem multa nem juros: a
  // parcela ainda não venceu (nem no D-0, em que o pagador tem o dia inteiro).
  valorTotal: number;
  parcelas: ParcelaLembrete[];
  // Variável {{5}} do template: a linha digitável do boleto quando é um só, ou a
  // linha de CADA boleto (aluno + valor) quando o lembrete agrupa irmãos.
  linhaDigitavel: string;
}

// Agrupa por responsável (telefone) e mantém apenas o prazo MAIS URGENTE de cada
// um: com parcelas em D-5 e em D-0 no mesmo dia, o responsável recebe um único
// lembrete, o do vencimento de hoje.
export function agruparLembretesPorResponsavel(
  parcelas: ParcelaLembrete[],
  hojeYMD: string,
): GrupoLembrete[] {
  const porResponsavel = new Map<string, ParcelaLembrete[]>();
  for (const p of lembretesEnviaveis(parcelas, hojeYMD)) {
    const chave = chaveTelefone(p.telefone);
    if (!chave) continue;
    const atual = porResponsavel.get(chave);
    if (atual) atual.push(p);
    else porResponsavel.set(chave, [p]);
  }

  const grupos: GrupoLembrete[] = [];
  for (const [chave, todas] of porResponsavel) {
    const prazo = todas
      .map((p) => prazoDoVencimento(p.vencimento, hojeYMD) as PrazoLembrete)
      .reduce((menor, p) => (p < menor ? p : menor), 5 as PrazoLembrete);
    const doPrazo = todas.filter((p) => prazoDoVencimento(p.vencimento, hojeYMD) === prazo);
    const alunoIds = [...new Set(doPrazo.map((p) => p.alunoId))];
    grupos.push({
      chave,
      telefone: doPrazo[0].telefone,
      responsavelNome: doPrazo[0].responsavelNome,
      unidade: doPrazo[0].unidade,
      alunoIds,
      alunosLabel: juntarNomes(doPrazo.map((p) => p.alunoNome)),
      prazo,
      vencimento: doPrazo[0].vencimento,
      valorTotal: Math.round(doPrazo.reduce((s, p) => s + p.saldo, 0) * 100) / 100,
      parcelas: doPrazo,
      linhaDigitavel: comporLinhasDigitaveis(
        doPrazo.map((p) => ({
          alunoNome: p.alunoNome,
          valor: p.saldo,
          linhaDigitavel: p.linhaDigitavel ?? "",
        })),
      ),
    });
  }
  return grupos.sort((a, b) => a.chave.localeCompare(b.chave));
}

// Prioridade da cobrança automática: o responsável que recebe (ou já recebeu)
// cobrança hoje não recebe o lembrete preventivo no mesmo dia. Cobrança é sobre
// algo já vencido — avisar do próximo vencimento no mesmo dia soa desconexo.
export function filtrarPorPrioridadeCobranca(
  grupos: GrupoLembrete[],
  telefonesComCobrancaHoje: string[],
): GrupoLembrete[] {
  const bloqueados = new Set(telefonesComCobrancaHoje.map(chaveTelefone).filter(Boolean));
  return grupos.filter((g) => !bloqueados.has(chaveTelefone(g.telefone)));
}
