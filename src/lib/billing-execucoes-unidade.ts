// Regras puras da aba Lembretes Automáticos que dependem da unidade do topo.
//
// 1. Pausas manuais: filtradas pela unidade ativa e em ordem alfabética por
//    responsável.
// 2. Execuções da Automação: cada linha de `whatsapp_cron_runs` cobre as 4
//    unidades numa execução só. Com uma unidade selecionada, os totais dela são
//    recalculados a partir de `whatsapp_billing_logs` (que tem unidade), casando
//    cada log pela `data_envio` dentro da janela iniciado_em..finalizado_em da
//    execução. O par (data_ref, slot) é único e as tentativas (10h/16h) ficam
//    6h afastadas com execuções de segundos, então as janelas não se sobrepõem.

import { filtrarPorUnidade } from "@/lib/unidade-global";

export type PausaOrdenavel = { responsavel_nome: string; unidade: string };

export function pausasDaUnidade<T extends PausaOrdenavel>(
  pausas: readonly T[],
  unidade: string | null,
): T[] {
  return filtrarPorUnidade(pausas, unidade, (p) => p.unidade).sort((a, b) =>
    a.responsavel_nome.localeCompare(b.responsavel_nome, "pt-BR", { sensitivity: "base" }),
  );
}

export type JanelaExecucao = {
  data_ref: string;
  iniciado_em: string;
  finalizado_em: string | null;
  pulados: number;
};

export type LogExecucao = {
  data_envio: string;
  unidade: string;
  telefone: string;
  status: string;
};

export type TotaisUnidade = { enviados: number; falhas: number; pulados: number };

const STATUS_FALHA = new Set(["erro", "falha"]);

function mesmaUnidade(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function dentroDaJanela(log: LogExecucao, run: JanelaExecucao): boolean {
  const t = new Date(log.data_envio).getTime();
  const ini = new Date(run.iniciado_em).getTime();
  const fim = run.finalizado_em ? new Date(run.finalizado_em).getTime() : Number.POSITIVE_INFINITY;
  return t >= ini && t <= fim;
}

// Totais de UMA execução para a unidade: enviados = logs da unidade na janela
// sem falha; falhas = logs com status erro/falha. "Pulados" (quem já tinha sido
// lembrado hoje) não gera log — é reconstruído pelos telefones da unidade com
// disparo bem-sucedido no mesmo dia ANTES desta execução (a mesma regra que o
// cron usa para pular), limitado ao total da execução.
export function totaisPorUnidade(
  run: JanelaExecucao,
  logs: readonly LogExecucao[],
  unidade: string,
): TotaisUnidade {
  const daUnidade = logs.filter((l) => mesmaUnidade(l.unidade, unidade));
  const naJanela = daUnidade.filter((l) => dentroDaJanela(l, run));
  const falhas = naJanela.filter((l) => STATUS_FALHA.has(l.status)).length;
  const enviados = naJanela.length - falhas;

  const ini = new Date(run.iniciado_em).getTime();
  const lembradosAntes = new Set(
    daUnidade
      .filter(
        (l) =>
          !STATUS_FALHA.has(l.status) &&
          new Date(l.data_envio).getTime() < ini &&
          diaSaoPaulo(l.data_envio) === run.data_ref,
      )
      .map((l) => l.telefone.replace(/\D/g, "")),
  );
  const pulados = run.pulados > 0 ? Math.min(run.pulados, lembradosAntes.size) : 0;
  return { enviados, falhas, pulados };
}

function diaSaoPaulo(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
