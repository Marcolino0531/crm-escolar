// Registro e monitoramento das execuções do cron de cobrança automática.
//
// O disparo diário é tentado várias vezes ao longo do dia útil (ver as entradas
// de cron em `vercel.json`): se uma tentativa se perder — deploy na hora do
// agendamento, timeout, erro do Sponte —, a seguinte cobre o dia. Duas travas
// impedem duplicidade: o par (data, slot), que torna cada tentativa única, e a
// idempotência por telefone/dia já existente no envio.
//
// Toda execução é registrada, inclusive as que não enviam nada, para que um
// disparo perdido apareça no sistema em vez de passar despercebido.

// Tentativas do dia (hora de Brasília) e o slot gravado por cada uma.
export const SLOTS_CRON: Record<string, string> = {
  "/api/whatsapp/cron": "09h",
  "/api/whatsapp/cron/tentativa-2": "12h",
  "/api/whatsapp/cron/tentativa-3": "15h",
  "/api/whatsapp/cron/tentativa-4": "18h",
};

export function slotDaRota(pathname: string): string | null {
  return SLOTS_CRON[pathname] ?? null;
}

export type StatusExecucao =
  | "em_andamento"
  | "ok" // enviou pelo menos uma cobrança
  | "sem_envio" // rodou, mas ninguém era cobrável hoje
  | "nao_util" // fim de semana ou feriado
  | "pausado" // kill switch ligado
  | "erro";

export interface ExecucaoCron {
  data_ref: string;
  slot: string;
  status: StatusExecucao;
  enviados: number;
  falhas: number;
  erro?: string | null;
}

// Execuções que confirmam que a régua do dia foi avaliada até o fim.
const STATUS_CONCLUIDO: StatusExecucao[] = ["ok", "sem_envio", "nao_util", "pausado"];

export function execucaoConcluida(e: ExecucaoCron): boolean {
  return STATUS_CONCLUIDO.includes(e.status);
}

// Hora (0-23) do fuso de Brasília a partir da qual a ausência de execução vira
// alerta: já passou da 1ª tentativa (09h) e da 2ª (12h).
export const HORA_LIMITE_ALERTA = 13;

export interface ResumoDia {
  tentativas: number;
  enviados: number;
  falhas: number;
  concluida: boolean;
  comErro: boolean;
}

export function resumoDoDia(execucoes: ExecucaoCron[], dataRef: string): ResumoDia {
  const doDia = execucoes.filter((e) => e.data_ref === dataRef);
  return {
    tentativas: doDia.length,
    enviados: doDia.reduce((s, e) => s + (e.enviados || 0), 0),
    falhas: doDia.reduce((s, e) => s + (e.falhas || 0), 0),
    concluida: doDia.some(execucaoConcluida),
    comErro: doDia.some((e) => e.status === "erro"),
  };
}

// Aviso para o sininho: nulo quando não há o que reportar. Só alerta em dia
// útil e depois da hora limite, para não acusar antes da 1ª tentativa rodar.
export function alertaExecucaoCron(
  execucoes: ExecucaoCron[],
  dataRef: string,
  horaBRT: number,
  diaUtil: boolean,
): string | null {
  if (!diaUtil) return null;
  if (horaBRT < HORA_LIMITE_ALERTA) return null;

  const resumo = resumoDoDia(execucoes, dataRef);
  if (resumo.concluida) {
    return resumo.comErro
      ? "A cobrança automática registrou falha em uma das tentativas de hoje."
      : null;
  }
  return resumo.tentativas === 0
    ? "A cobrança automática não foi executada hoje."
    : "A cobrança automática não concluiu nenhuma execução hoje.";
}
