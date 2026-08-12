// Agrupamento das mensagens do chat por dia, para os divisores de data no
// estilo do WhatsApp ("Hoje", "Ontem", "07 de agosto de 2026").
//
// Lógica pura (sem React nem banco): recebe as mensagens em ordem cronológica e
// devolve a sequência de itens a renderizar, intercalando um divisor sempre que
// o dia muda — inclusive antes da primeira mensagem.

export interface MensagemComData {
  wa_timestamp: string | null;
  created_at: string;
}

export type ItemThread<T> =
  | { tipo: "divisor"; dia: string; label: string }
  | { tipo: "mensagem"; msg: T };

// O horário exibido vem de wa_timestamp (hora real no WhatsApp) e cai para
// created_at quando a Meta não informou o carimbo.
export function instanteDaMensagem(m: MensagemComData): string {
  return m.wa_timestamp ?? m.created_at;
}

// Chave do dia no fuso do usuário, no formato "AAAA-MM-DD". String vazia quando
// a data é inválida (mensagem sem carimbo utilizável).
export function chaveDoDia(iso: string | null, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// "Hoje" / "Ontem" / "07 de agosto de 2026", comparando com a data de referência.
export function rotuloDoDia(dia: string, agora: Date, timeZone?: string): string {
  const hoje = chaveDoDia(agora.toISOString(), timeZone);
  if (dia === hoje) return "Hoje";
  const ontemDate = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  if (dia === chaveDoDia(ontemDate.toISOString(), timeZone)) return "Ontem";
  const [ano, mes, diaMes] = dia.split("-").map(Number);
  if (!ano || !mes || !diaMes) return dia;
  // Meio-dia UTC evita que a formatação escorregue para o dia vizinho.
  return new Date(Date.UTC(ano, mes - 1, diaMes, 12)).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// Intercala divisores de data entre as mensagens (ordem preservada).
export function agruparPorDia<T extends MensagemComData>(
  mensagens: T[],
  agora: Date,
  timeZone?: string,
): ItemThread<T>[] {
  const itens: ItemThread<T>[] = [];
  let diaAtual: string | null = null;
  for (const msg of mensagens) {
    const dia = chaveDoDia(instanteDaMensagem(msg), timeZone);
    if (dia && dia !== diaAtual) {
      itens.push({ tipo: "divisor", dia, label: rotuloDoDia(dia, agora, timeZone) });
      diaAtual = dia;
    }
    itens.push({ tipo: "mensagem", msg });
  }
  return itens;
}
