// Leituras de lista do navegador que alimentam contagens e somas da tela.
// Todas passam por `selectAll`: o PostgREST corta em 1000 linhas sem erro, e o
// badge/total precisa considerar todas as linhas, não só a primeira página.
import { supabase } from "@/integrations/supabase/client";
import { competenciaDeIso, contarSugestoesDoMes } from "@/lib/atendimento-ia";
import { selectAll } from "@/lib/supabase-paginate";

export type ConclusaoRecorrente = { def_id: string; month_key: string };

export function lerConclusoesRecorrentes(): Promise<ConclusaoRecorrente[]> {
  return selectAll<ConclusaoRecorrente>(() =>
    supabase
      .from("recurring_task_completions" as never)
      .select("def_id, month_key")
      .order("id", { ascending: true }),
  );
}

export type RecebivelDisponivel = { id: string; valor_liquido: number };

export function lerRecebiveisDisponiveis(today: string): Promise<RecebivelDisponivel[]> {
  return selectAll<RecebivelDisponivel>(() =>
    supabase
      .from("credit_card_receivables" as never)
      .select("id, valor_liquido")
      .neq("status", "transferido")
      .lte("data_disponibilidade", today)
      .order("data_disponibilidade", { ascending: true })
      .order("id", { ascending: true }),
  );
}

export function lerRecebiveisCartao<T>(columns: string, unitIds: string[] | null): Promise<T[]> {
  return selectAll<T>(() => {
    let rq = supabase
      .from("credit_card_receivables" as never)
      .select(columns)
      .order("data_disponibilidade", { ascending: true })
      .order("id", { ascending: true });
    if (unitIds) rq = rq.in("unit_id", unitIds as never);
    return rq;
  });
}

export type UsoIaDoMes = { competencia: string; total: number; tokens: number };

export async function lerUsoIaDoMes(agora: Date = new Date()): Promise<UsoIaDoMes> {
  const desde = new Date(agora.getTime() - 62 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await selectAll<{ gerado_em: string; tokens_entrada: number; tokens_saida: number }>(
    () =>
      supabase
        .from("ai_suggestions" as never)
        .select("gerado_em, tokens_entrada, tokens_saida")
        .gte("gerado_em", desde)
        .order("id", { ascending: true }),
  );
  const competencia = competenciaDeIso(agora.toISOString());
  const doMes = rows.filter((r) => competenciaDeIso(r.gerado_em) === competencia);
  return {
    competencia,
    total: contarSugestoesDoMes(rows, competencia),
    tokens: doMes.reduce((s, r) => s + (r.tokens_entrada ?? 0) + (r.tokens_saida ?? 0), 0),
  };
}

export async function contarMatriculasAtivasPorModalidade(): Promise<Record<string, number>> {
  const rows = await selectAll<{ modalidade_id: string }>(() =>
    supabase
      .from("esportes_matriculas" as never)
      .select("modalidade_id")
      .is("cancelado_em", null)
      .order("id", { ascending: true }),
  );
  const contagem: Record<string, number> = {};
  for (const row of rows) {
    contagem[row.modalidade_id] = (contagem[row.modalidade_id] ?? 0) + 1;
  }
  return contagem;
}

export function lerLancamentosFundos<T>(fundIds: string[]): Promise<T[]> {
  return selectAll<T>(() =>
    supabase
      .from("provision_fund_entries" as never)
      .select("*")
      .in("fund_id", fundIds as never)
      .order("competencia", { ascending: true })
      .order("id", { ascending: true }),
  );
}
