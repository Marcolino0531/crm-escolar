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

const N = 2500;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (nome: string) => fakeQuery(nome) },
}));
vi.mock("@/lib/sponte.functions", () => ({
  UNIDADES_SPONTE: ["CEC"],
  alunosAtivosDaUnidade: async () => ({
    alunos: Array.from({ length: 2500 }, (_, i) => ({
      alunoId: `a-${i}`,
      nome: "",
      turma: i % 2 === 0 ? "T1" : "T2",
    })),
    error: null,
  }),
}));
vi.mock("@/lib/nuvemshop.server", () => ({
  configuredStores: () => [],
  fetchPaidOrders: async () => [],
}));

import { statusAcompanhamento } from "@/lib/rematricula-acompanhamento";
import { criarFonteDadosModulos } from "./analises-ia-modulos.server";

const fonte = () =>
  criarFonteDadosModulos(async () => ({ ids: ["s1"], nomePorId: new Map([["s1", "CEC"]]) }));

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
});

describe("análises IA — módulos com mais de 1000 linhas", () => {
  it("rematrícula: acessos e envios além da 1000ª linha entram no status", async () => {
    tabelas.rematricula_config = [{ ano_letivo: 2027 }];
    tabelas.rematricula_acessos = linhas(N, (i) => ({ unidade: "CEC", aluno_id: `a-${i}` }));
    tabelas.rematricula_envios = [];
    tabelas.rematricula_escolhas = [];
    const { linhas: out } = await fonte().rematriculaMaterial({ unidades: ["CEC"] });
    const acessou = statusAcompanhamento(null, true, false);
    expect(out).toHaveLength(N);
    expect(out.filter((l) => l.status === acessou)).toHaveLength(N);
  });

  it("esportes: quantidade de alunos por turma soma as 2500 matrículas ativas", async () => {
    tabelas.esportes_modalidades = [
      { id: "m1", nome: "Judô", unidade: "CEC", tipo_repasse: "fixo" },
    ];
    tabelas.esportes_parceiros = [];
    tabelas.esportes_repasses = [];
    tabelas.esportes_matriculas = [
      ...linhas(N, (i) => ({
        modalidade_id: "m1",
        turma: i % 2 === 0 ? "A" : "B",
        cancelado_em: null,
      })),
      { id: "x-1", modalidade_id: "m1", turma: "A", cancelado_em: "2026-01-01" },
    ];
    const { turmas } = await fonte().esportes({
      unidades: ["CEC"],
      mesInicio: "2026-01",
      mesFim: "2026-12",
    });
    expect(turmas.reduce((s, t) => s + t.quantidadeAlunos, 0)).toBe(N);
    expect(turmas.find((t) => t.turma === "A")?.quantidadeAlunos).toBe(N / 2);
  });

  it("documentos: as 2500 emissões e o valor total completo", async () => {
    tabelas.documentos_recibos = linhas(N, () => ({
      unidade: "CEC",
      tipo: "recibo",
      data_recibo: "2026-08-15",
      valor_total: 10,
    }));
    const docs = await fonte().documentosEmitidos({
      unidades: ["CEC"],
      dataInicio: "2026-08-01",
      dataFim: "2026-08-31",
    });
    expect(docs).toHaveLength(N);
    expect(docs.reduce((s, d) => s + d.valorTotal, 0)).toBe(10 * N);
  });

  it("matrículas: as 2500 submissões do período", async () => {
    tabelas.enrollment_submissions = linhas(N, () => ({
      unidade: "CEC",
      status: "sucesso",
      created_at: "2026-08-15T12:00:00Z",
    }));
    const { submissoes, ativos } = await fonte().matriculas({
      unidades: ["CEC"],
      dataInicio: "2026-08-01",
      dataFim: "2026-08-31",
    });
    expect(submissoes).toHaveLength(N);
    expect(ativos.reduce((s, t) => s + t.quantidadeAlunos, 0)).toBe(N);
  });

  it("folha RH: quadro de ativos conta os 2500 funcionários", async () => {
    tabelas.hr_payslip_sends = [];
    tabelas.hr_transport_batches = [];
    tabelas.funcionarios = [
      ...linhas(N, () => ({ school_id: "s1", data_rescisao: null })),
      { id: "x-1", school_id: "s1", data_rescisao: "2026-01-31" },
    ];
    const { quadro } = await fonte().folhaRh({
      unidades: ["CEC"],
      mesInicio: "2026-01",
      mesFim: "2026-12",
    });
    expect(quadro).toEqual([{ unidade: "CEC", funcionariosAtivos: N }]);
  });
});
