// Regras puras da tela "Falhas de Entrega" das mensagens automáticas de
// cobrança/lembrete por WhatsApp.
//
// A fonte é `whatsapp_billing_logs`: cada disparo tem um status que o webhook
// da Meta evolui (pendente → enviado → entregue → lido) ou marca como `falha`
// (com o texto do erro em `erro_mensagem`). Falhas no próprio envio (antes de
// chegar à Meta, ex.: responsável sem telefone) também ficam em `falha`/`erro`.
//
// A tela mostra UMA linha por responsável/telefone cujo ÚLTIMO disparo falhou,
// com a contagem de falhas seguidas até ele. Quem voltou a receber depois de
// uma falha (entregue/lido) não é mais pendência.

export type CategoriaFalha =
  | "sem_whatsapp"
  | "sem_telefone"
  | "fora_da_janela"
  | "template"
  | "limite_meta"
  | "outro";

export const ROTULO_CATEGORIA: Record<CategoriaFalha, string> = {
  sem_whatsapp: "Número sem WhatsApp / não entregável",
  sem_telefone: "Sem telefone no Sponte",
  fora_da_janela: "Fora da janela de 24h",
  template: "Erro no template",
  limite_meta: "Limite da Meta",
  outro: "Outro erro",
};

// Classifica pelo texto que o webhook/envio gravou. A Meta devolve em inglês
// ("Message Undeliverable", código 131026 = número inválido ou sem WhatsApp;
// 131047 = re-engajamento; 131049/130429 = limites; 132xxx = template).
export function categorizarErro(erro: string | null | undefined): CategoriaFalha {
  const t = (erro ?? "").toLowerCase();
  if (!t) return "outro";
  if (/sem telefone|telefone inv[aá]lido|n[uú]mero inv[aá]lido/.test(t)) return "sem_telefone";
  if (/undeliverable|131026|not a whatsapp|not registered|invalid recipient|131030/.test(t))
    return "sem_whatsapp";
  if (/131047|re-?engagement|24 ?h|outside the allowed window/.test(t)) return "fora_da_janela";
  if (/template|132\d{3}|param/.test(t)) return "template";
  if (/131049|130429|rate limit|limit|healthy ecosystem|131056/.test(t)) return "limite_meta";
  return "outro";
}

export interface LogEntrega {
  id: string;
  data_envio: string;
  responsavel_name: string | null;
  aluno_name: string | null;
  alunos_cobrados?: { id?: string; nome?: string }[] | null;
  telefone: string | null;
  unidade: string | null;
  valor: number | string | null;
  vencimento: string | null;
  status: string;
  erro_mensagem: string | null;
  tipo?: string | null;
}

export interface FalhaEntrega {
  chave: string;
  responsavel: string;
  telefone: string;
  alunos: string[];
  unidade: string;
  categoria: CategoriaFalha;
  erro: string;
  ultimaTentativa: string;
  tentativas: number;
  valor: number;
  vencimento: string | null;
  tipo: string;
  logIds: string[];
}

export function falhou(status: string): boolean {
  return status === "falha" || status === "erro";
}

function digitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

// Agrupa por telefone (só dígitos); sem telefone, pelo nome do responsável na
// unidade — o responsável sem número no Sponte também precisa aparecer.
export function chaveFalha(
  log: Pick<LogEntrega, "telefone" | "responsavel_name" | "unidade">,
): string {
  const tel = digitos(log.telefone);
  if (tel) return `tel:${tel}`;
  return `nome:${(log.unidade ?? "").trim().toLowerCase()}|${(log.responsavel_name ?? "").trim().toLowerCase()}`;
}

export function nomesAlunos(log: Pick<LogEntrega, "aluno_name" | "alunos_cobrados">): string[] {
  const doJson = (log.alunos_cobrados ?? [])
    .map((a) => (a.nome ?? "").trim())
    .filter((n) => n.length > 0);
  if (doJson.length > 0) return Array.from(new Set(doJson));
  const n = (log.aluno_name ?? "").trim();
  return n ? [n] : [];
}

export function valorNumerico(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Uma linha por responsável/telefone cujo disparo mais recente falhou. A
// contagem é a sequência de falhas contígua terminando no último disparo — se
// entre duas falhas houve uma entrega, a sequência recomeça a partir dela.
export function agruparFalhas(logs: readonly LogEntrega[]): FalhaEntrega[] {
  const porChave = new Map<string, LogEntrega[]>();
  for (const l of logs) {
    const k = chaveFalha(l);
    const arr = porChave.get(k);
    if (arr) arr.push(l);
    else porChave.set(k, [l]);
  }

  const linhas: FalhaEntrega[] = [];
  for (const [chave, grupo] of porChave) {
    const ordenado = [...grupo].sort((a, b) => a.data_envio.localeCompare(b.data_envio));
    const ultimo = ordenado[ordenado.length - 1];
    if (!falhou(ultimo.status)) continue;

    const seguidas: LogEntrega[] = [];
    for (let i = ordenado.length - 1; i >= 0 && falhou(ordenado[i].status); i--) {
      seguidas.push(ordenado[i]);
    }

    const alunos = new Set<string>();
    for (const l of seguidas) for (const n of nomesAlunos(l)) alunos.add(n);

    linhas.push({
      chave,
      responsavel: (ultimo.responsavel_name ?? "").trim() || "—",
      telefone: ultimo.telefone ?? "",
      alunos: Array.from(alunos),
      unidade: (ultimo.unidade ?? "").trim() || "—",
      categoria: categorizarErro(ultimo.erro_mensagem),
      erro: (ultimo.erro_mensagem ?? "").trim() || "Falha reportada pela Meta.",
      ultimaTentativa: ultimo.data_envio,
      tentativas: seguidas.length,
      valor: valorNumerico(ultimo.valor),
      vencimento: ultimo.vencimento,
      tipo: ultimo.tipo ?? "cobranca",
      logIds: seguidas.map((l) => l.id),
    });
  }

  return linhas.sort((a, b) => b.ultimaTentativa.localeCompare(a.ultimaTentativa));
}

// Valor em risco: soma do valor cobrado na ÚLTIMA tentativa de cada linha
// (uma vez por responsável, nunca multiplicado pelas tentativas), em centavos
// para não acumular erro de ponto flutuante.
export function totalEmRisco(linhas: readonly FalhaEntrega[]): number {
  const cents = linhas.reduce((acc, l) => acc + Math.round(l.valor * 100), 0);
  return cents / 100;
}

export function contarPorCategoria(
  linhas: readonly FalhaEntrega[],
): Partial<Record<CategoriaFalha, number>> {
  const out: Partial<Record<CategoriaFalha, number>> = {};
  for (const l of linhas) out[l.categoria] = (out[l.categoria] ?? 0) + 1;
  return out;
}
