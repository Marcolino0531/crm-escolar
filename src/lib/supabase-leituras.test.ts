import { beforeEach, describe, expect, it, vi } from "vitest";

// Reproduz o PostgREST: sem `.range`, a resposta é cortada em 1000 linhas SEM erro.
const DB_MAX_ROWS = 1000;
const tabelas: Record<string, Record<string, unknown>[]> = {};

function fakeQuery(nome: string) {
  let rows = tabelas[nome] ?? [];
  let de = 0;
  let ate = DB_MAX_ROWS - 1;
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] === v);
      return q;
    },
    neq: (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] !== v);
      return q;
    },
    is: (col: string, v: unknown) => {
      rows = rows.filter((r) => r[col] === v);
      return q;
    },
    in: (col: string, vs: unknown[]) => {
      rows = rows.filter((r) => vs.includes(r[col]));
      return q;
    },
    gte: (col: string, v: string) => {
      rows = rows.filter((r) => String(r[col]) >= v);
      return q;
    },
    lte: (col: string, v: string) => {
      rows = rows.filter((r) => String(r[col]) <= v);
      return q;
    },
    order: () => q,
    range: (from: number, to: number) => {
      de = from;
      ate = to;
      return q;
    },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data: rows.slice(de, Math.min(ate + 1, de + DB_MAX_ROWS)),
        error: null,
      }).then(resolve),
  };
  return q;
}

function linhas(n: number, f: (i: number) => Record<string, unknown>) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(5, "0")}`, ...f(i) }));
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (nome: string) => fakeQuery(nome) },
}));

import {
  contarMatriculasAtivasPorModalidade,
  lerConclusoesRecorrentes,
  lerLancamentosFundos,
  lerRecebiveisCartao,
  lerRecebiveisDisponiveis,
  lerUsoIaDoMes,
} from "./supabase-leituras";

const N = 2500;

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
});

describe("leituras do navegador com mais de 1000 linhas", () => {
  it("conclusões de rotinas: traz todas, sem pular nem duplicar", async () => {
    tabelas.recurring_task_completions = linhas(N, (i) => ({
      def_id: `def-${i}`,
      month_key: "2026-10",
    }));
    const rows = await lerConclusoesRecorrentes();
    expect(rows).toHaveLength(N);
    expect(new Set(rows.map((r) => r.def_id)).size).toBe(N);
  });

  it("recebíveis disponíveis: contagem e soma consideram todas as linhas", async () => {
    tabelas.credit_card_receivables = [
      ...linhas(N, () => ({
        status: "disponivel",
        data_disponibilidade: "2026-10-01",
        valor_liquido: 10,
      })),
      { id: "x-1", status: "transferido", data_disponibilidade: "2026-10-01", valor_liquido: 999 },
      { id: "x-2", status: "aguardando", data_disponibilidade: "2026-12-01", valor_liquido: 999 },
    ];
    const rows = await lerRecebiveisDisponiveis("2026-10-09");
    expect(rows).toHaveLength(N);
    expect(rows.reduce((s, r) => s + r.valor_liquido, 0)).toBe(10 * N);
  });

  it("lista de recebíveis do cartão: todas as linhas da unidade", async () => {
    tabelas.credit_card_receivables = [
      ...linhas(N, () => ({ unit_id: "u1", valor_liquido: 4 })),
      { id: "x-1", unit_id: "u2", valor_liquido: 999 },
    ];
    const rows = await lerRecebiveisCartao<{ id: string; valor_liquido: number }>("*", ["u1"]);
    expect(rows).toHaveLength(N);
    expect(rows.reduce((s, r) => s + r.valor_liquido, 0)).toBe(4 * N);
    expect(await lerRecebiveisCartao("*", null)).toHaveLength(N + 1);
  });

  it("uso da IA no mês: total e tokens somam as 2500 sugestões", async () => {
    const agora = new Date("2026-10-09T15:00:00Z");
    tabelas.ai_suggestions = linhas(N, () => ({
      gerado_em: "2026-10-05T15:00:00Z",
      tokens_entrada: 3,
      tokens_saida: 4,
    }));
    const uso = await lerUsoIaDoMes(agora);
    expect(uso).toEqual({ competencia: "2026-10", total: N, tokens: 7 * N });
  });

  it("matrículas ativas por modalidade: contagem completa, sem canceladas", async () => {
    tabelas.esportes_matriculas = [
      ...linhas(N, (i) => ({ modalidade_id: i % 2 === 0 ? "m1" : "m2", cancelado_em: null })),
      { id: "x-1", modalidade_id: "m1", cancelado_em: "2026-09-01" },
    ];
    expect(await contarMatriculasAtivasPorModalidade()).toEqual({ m1: N / 2, m2: N / 2 });
  });

  it("lançamentos dos fundos: todas as linhas dos fundos pedidos", async () => {
    tabelas.provision_fund_entries = [
      ...linhas(N, (i) => ({ fund_id: i % 2 === 0 ? "f1" : "f2", saldo: 2 })),
      { id: "x-1", fund_id: "f3", saldo: 999 },
    ];
    const rows = await lerLancamentosFundos<{ id: string; saldo: number }>(["f1", "f2"]);
    expect(rows).toHaveLength(N);
    expect(new Set(rows.map((r) => r.id)).size).toBe(N);
    expect(rows.reduce((s, r) => s + r.saldo, 0)).toBe(2 * N);
  });
});
