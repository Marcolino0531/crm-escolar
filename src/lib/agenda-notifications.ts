// Notificações de reunião da Agenda no sininho: o que ainda está pendente, o
// que já pode ser concluído sozinho (reunião que passou) e quanto o contador de
// não lidas deve mostrar.
//
// Concluir NÃO apaga: `concluded_at` marca a linha, que continua no banco para
// consulta do histórico de reuniões passadas.

export interface ReuniaoDaNotificacao {
  // Data da reunião no formato YYYY-MM-DD.
  data: string | null;
  // Horário no formato HH:MM (o campo é texto livre no cadastro).
  horario: string | null;
}

export interface NotificacaoReuniao {
  id: string;
  message: string;
  read: boolean;
  created_at: string;
  concluded_at: string | null;
  reuniao: ReuniaoDaNotificacao | null;
}

const HORA_VALIDA = /^([01]\d|2[0-3]):([0-5]\d)/;

// "agora" no horário local, como YYYY-MM-DDTHH:MM — a mesma forma que
// `${data}T${horario}` produz, então a comparação é textual.
export function momentoLocal(agora: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}` +
    `T${p(agora.getHours())}:${p(agora.getMinutes())}`
  );
}

// A reunião já aconteceu. Com horário, compara data+hora; sem horário (ou com
// horário fora do formato), só o dia — uma reunião de hoje sem hora definida
// continua pendente até o dia virar.
export function reuniaoJaPassou(reuniao: ReuniaoDaNotificacao | null, agora: string): boolean {
  const data = reuniao?.data;
  if (!data) return false;
  const horario = (reuniao?.horario ?? "").trim();
  if (HORA_VALIDA.test(horario)) return `${data}T${horario.slice(0, 5)}` < agora;
  return data < agora.slice(0, 10);
}

// Concluída de fato (check manual ou conclusão automática já gravada) ou
// concluível porque a reunião passou — nos dois casos sai da lista.
export function notificacaoConcluida(n: NotificacaoReuniao, agora: string): boolean {
  return !!n.concluded_at || reuniaoJaPassou(n.reuniao, agora);
}

export function notificacoesPendentes(
  notificacoes: readonly NotificacaoReuniao[],
  agora: string,
): NotificacaoReuniao[] {
  return notificacoes.filter((n) => !notificacaoConcluida(n, agora));
}

// Reuniões que já passaram e ainda não estão marcadas: o sininho grava a
// conclusão delas, para o histórico refletir o que a tela já deixou de mostrar.
export function idsParaConcluirAutomaticamente(
  notificacoes: readonly NotificacaoReuniao[],
  agora: string,
): string[] {
  return notificacoes
    .filter((n) => !n.concluded_at && reuniaoJaPassou(n.reuniao, agora))
    .map((n) => n.id);
}

// O contador só conta reunião pendente e ainda não lida.
export function contadorNaoLidas(
  notificacoes: readonly NotificacaoReuniao[],
  agora: string,
): number {
  return notificacoesPendentes(notificacoes, agora).filter((n) => !n.read).length;
}
