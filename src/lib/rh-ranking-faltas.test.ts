import { describe, expect, it } from "vitest";
import { rankingFaltasPorTipo, FuncionarioRankeavel } from "./rh-ranking-faltas";

const periodo = { modo: "mes", ano: 2026, mes: 8 } as const;

const funcionarios: FuncionarioRankeavel[] = [
  {
    id: "a",
    nomeCompleto: "Ana",
    faltas: [
      { data: "2026-08-03", tipo: "sem_atestado" },
      { data: "2026-08-10", tipo: "sem_atestado" },
      { data: "2026-08-12", tipo: "com_atestado", categoria: "integral" },
      // fora do período
      { data: "2026-07-30", tipo: "sem_atestado" },
      // atraso não entra em ranking de faltas
      { data: "2026-08-15", tipo: "sem_atestado", categoria: "atraso" },
    ],
  },
  {
    id: "b",
    nomeCompleto: "Bruno",
    faltas: [
      { data: "2026-08-05", tipo: "com_atestado" },
      { data: "2026-08-06", tipo: "com_atestado" },
      { data: "2026-08-07", tipo: "com_atestado" },
    ],
  },
  { id: "c", nomeCompleto: "Carla", faltas: [{ data: "2026-08-20", tipo: "sem_atestado" }] },
  { id: "d", nomeCompleto: "Duda", faltas: [] },
];

describe("rankingFaltasPorTipo", () => {
  it("sem atestado conta só as ocorrências sem atestado, no período, integrais", () => {
    expect(rankingFaltasPorTipo(funcionarios, "sem_atestado", periodo)).toEqual([
      { id: "a", nome: "Ana", total: 2 },
      { id: "c", nome: "Carla", total: 1 },
    ]);
  });

  it("com atestado é independente do ranking sem atestado", () => {
    expect(rankingFaltasPorTipo(funcionarios, "com_atestado", periodo)).toEqual([
      { id: "b", nome: "Bruno", total: 3 },
      { id: "a", nome: "Ana", total: 1 },
    ]);
  });

  it("modo ano soma todos os meses e quem não tem ocorrência fica fora", () => {
    const r = rankingFaltasPorTipo(funcionarios, "sem_atestado", {
      modo: "ano",
      ano: 2026,
      mes: 1,
    });
    expect(r.map((x) => [x.id, x.total])).toEqual([
      ["a", 3],
      ["c", 1],
    ]);
    expect(r.find((x) => x.id === "d")).toBeUndefined();
  });

  it("empate é desfeito por nome", () => {
    const r = rankingFaltasPorTipo(
      [
        { id: "z", nomeCompleto: "Zé", faltas: [{ data: "2026-08-01", tipo: "sem_atestado" }] },
        { id: "m", nomeCompleto: "Márcia", faltas: [{ data: "2026-08-01", tipo: "sem_atestado" }] },
      ],
      "sem_atestado",
      periodo,
    );
    expect(r.map((x) => x.id)).toEqual(["m", "z"]);
  });
});
