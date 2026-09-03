import { beforeEach, describe, expect, it, vi } from "vitest";

// Reproduz o comportamento do PostgREST: sem `.range`, a resposta é cortada em
// 1000 linhas SEM erro. Cada tabela é um array em memória e a "consulta"
// registra os filtros aplicados só o bastante para o teste (type/school_id).
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
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data: rows.slice(de, Math.min(ate + 1, de + DB_MAX_ROWS)),
        error: null,
      }).then(resolve),
  };
  return q;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (nome: string) => fakeQuery(nome) },
}));
vi.mock("@/lib/sponte.functions", () => ({
  allowedSponteUnidades: async () => null,
  coletarInadimplenciaPorEscopo: async () => [],
  UNIDADES_SPONTE: [],
}));
vi.mock("@/lib/analises-ia-modulos.server", () => ({
  criarFonteDadosModulos: () => ({}),
}));

import { criarFonteDados } from "./financeiro-ia.server";

const CEC = "escola-cec";
const BABY = "escola-baby";

function transacoes(n: number, type: "entrada" | "saida") {
  return Array.from({ length: n }, (_, i) => ({
    id: `${type}-${String(i).padStart(5, "0")}`,
    school_id: i % 2 === 0 ? CEC : BABY,
    type,
    date: "2026-08-15",
    amount: 10, // soma esperada = 10 × n
    description: `lançamento ${i}`,
    cost_center_id: null,
    sub_cost_center_id: null,
  }));
}

const filtro = {
  unidades: ["CEC", "CEC Baby"],
  dataInicio: "2026-08-01",
  dataFim: "2026-08-31",
};

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  tabelas.schools = [
    { id: CEC, name: "CEC" },
    { id: BABY, name: "CEC Baby" },
  ];
  tabelas.cost_centers = [];
  tabelas.sub_cost_centers = [];
});

describe("Análises com IA — leitura paginada acima do teto de 1000 do PostgREST", () => {
  it("receitas realizadas somam todas as linhas mesmo com 2.922 transações", async () => {
    tabelas.transactions = [...transacoes(2922, "entrada"), ...transacoes(300, "saida")];
    const fonte = criarFonteDados("user-1");

    const receitas = await fonte.receitasRealizadas(filtro);

    expect(receitas).toHaveLength(2922);
    expect(receitas.reduce((s, r) => s + r.valor, 0)).toBe(29_220);
  });

  it("lançamentos do extrato (saídas) trazem todas as linhas acima de 1000", async () => {
    tabelas.transactions = transacoes(1750, "saida");
    const fonte = criarFonteDados("user-1");

    const saidas = await fonte.lancamentosExtrato(filtro);

    expect(saidas).toHaveLength(1750);
    expect(saidas.reduce((s, r) => s + r.valor, 0)).toBe(17_500);
  });

  it("volume exatamente igual ao teto (1000) não perde nem duplica linhas", async () => {
    tabelas.transactions = transacoes(1000, "entrada");
    const fonte = criarFonteDados("user-1");

    const receitas = await fonte.receitasRealizadas(filtro);

    expect(receitas).toHaveLength(1000);
    expect(receitas.reduce((s, r) => s + r.valor, 0)).toBe(10_000);
  });

  it("controle: a mesma consulta SEM paginação devolve só 1000 (o corte silencioso)", async () => {
    tabelas.transactions = transacoes(2922, "entrada");
    const { data } = await fakeQuery("transactions").select().eq("type", "entrada");
    expect(data).toHaveLength(1000);
  });
});
