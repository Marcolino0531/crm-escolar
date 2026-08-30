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

// Meio-dia UTC do dia "AAAA-MM-DD": evita que a formatação escorregue para o
// dia vizinho por causa do fuso. Null quando a chave não é uma data.
function meioDiaUtc(dia: string): Date | null {
  const [ano, mes, diaMes] = dia.split("-").map(Number);
  if (!ano || !mes || !diaMes) return null;
  return new Date(Date.UTC(ano, mes - 1, diaMes, 12));
}

// Dias inteiros entre duas chaves de dia (positivo quando `dia` é passado).
export function diasAtras(dia: string, hoje: string): number | null {
  const a = meioDiaUtc(dia);
  const b = meioDiaUtc(hoje);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Nome do dia da semana por extenso em pt-BR (ex.: "sexta-feira").
function diaDaSemana(dia: string): string {
  const d = meioDiaUtc(dia);
  if (!d) return dia;
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long" });
}

function dataCompleta(dia: string): string {
  const d = meioDiaUtc(dia);
  if (!d) return dia;
  return d.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Rótulo do divisor de data, na régua do WhatsApp: "Hoje", "Ontem", o dia da
// semana por extenso até 6 dias atrás e a data completa a partir de 7 dias.
export function rotuloDoDia(dia: string, agora: Date, timeZone?: string): string {
  const hoje = chaveDoDia(agora.toISOString(), timeZone);
  const dias = diasAtras(dia, hoje);
  if (dias === null) return dia;
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias <= 6) return diaDaSemana(dia);
  return dataCompleta(dia);
}

// Rótulo do horário na LISTA de conversas, na régua do WhatsApp: só a hora no
// mesmo dia ("18:51"), "Ontem", o dia da semana por extenso de 2 a 6 dias atrás
// e a data completa ("23/08/2026") a partir de 7 dias.
export function rotuloRelativoLista(iso: string | null, agora: Date, timeZone?: string): string {
  const dia = chaveDoDia(iso, timeZone);
  if (!dia || !iso) return "";
  const dias = diasAtras(dia, chaveDoDia(agora.toISOString(), timeZone));
  if (dias === null) return "";
  if (dias <= 0) {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (dias === 1) return "Ontem";
  if (dias <= 6) return diaDaSemana(dia);
  return dataCompleta(dia);
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
