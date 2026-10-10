// Alarme do teto de 1000 linhas do PostgREST (regra em
// .agents/skills/leitura-sem-limite-crm-escolar/SKILL.md). Embrulha o `fetch`
// dos clientes Supabase: quando uma leitura SEM paginação explícita volta com
// exatamente 1000 linhas, registra `console.warn` para investigação. Só lê o
// cabeçalho `Content-Range` (nunca o corpo), não altera a resposta e engole
// qualquer erro próprio: a requisição segue normal.
const TETO = 1000;
const REST = "/rest/v1/";

export function linhasDoContentRange(valor: string | null): number | null {
  const m = /^(\d+)-(\d+)\//.exec(valor ?? "");
  return m ? Number(m[2]) - Number(m[1]) + 1 : null;
}

export function avisoDeTeto(
  url: string,
  metodo: string,
  cabecalhos: Headers,
  contentRange: string | null,
): string | null {
  const u = new URL(url);
  const i = u.pathname.indexOf(REST);
  if (i < 0) return null;
  const recurso = u.pathname.slice(i + REST.length);
  const leitura = metodo === "GET" || (metodo === "POST" && recurso.startsWith("rpc/"));
  if (!leitura) return null;
  if (u.searchParams.has("limit") || u.searchParams.has("offset") || cabecalhos.has("range"))
    return null;
  if (linhasDoContentRange(contentRange) !== TETO) return null;
  return `[supabase] leitura sem paginação voltou com exatamente ${TETO} linhas (teto do PostgREST): ${recurso} — ${u.origin}${u.pathname}`;
}

// Primeira linha da pilha fora do supabase-js e deste arquivo: a função que fez a leitura.
export function origemDaChamada(pilha: string | undefined): string | null {
  for (const linha of (pilha ?? "").split("\n").slice(1)) {
    const l = linha.trim();
    if (!l || /node_modules|@supabase|supabase-alarme-teto/.test(l)) continue;
    return l.replace(/^at\s+/, "").replace(/\?[^:)\s]*/, "");
  }
  return null;
}

type Fetch = typeof fetch;

export function fetchComAlarmeDeTeto(base?: Fetch): Fetch {
  const chamar: Fetch = base ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    let pilha: string | undefined;
    try {
      pilha = new Error().stack;
    } catch {
      pilha = undefined;
    }
    const resposta = await chamar(input, init);
    try {
      const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : req!.url;
      const metodo = (init?.method ?? req?.method ?? "GET").toUpperCase();
      const cabecalhos = new Headers(init?.headers ?? req?.headers);
      const aviso = avisoDeTeto(url, metodo, cabecalhos, resposta.headers.get("content-range"));
      if (aviso) {
        const origem = origemDaChamada(pilha);
        console.warn(origem ? `${aviso} (chamada em ${origem})` : aviso);
      }
    } catch {
      // o alarme nunca interfere na requisição
    }
    return resposta;
  };
}
