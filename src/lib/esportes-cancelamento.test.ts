import { describe, expect, it } from "vitest";
import { contarAtivas, matriculadoNoMes, matriculasDoMes } from "./esportes-repasse";

const alunos = [
  { aluno_id: "1", cancelado_em: null },
  { aluno_id: "2", cancelado_em: "2026-05-20" },
  { aluno_id: "3", cancelado_em: "2026-02-01" },
];

describe("matriculadoNoMes", () => {
  it("ativa conta em qualquer mês", () => {
    expect(matriculadoNoMes(null, "2026-01")).toBe(true);
    expect(matriculadoNoMes(undefined, "2030-12")).toBe(true);
  });
  it("cancelada conta nos meses anteriores e no próprio mês do cancelamento", () => {
    expect(matriculadoNoMes("2026-05-20", "2026-03")).toBe(true);
    expect(matriculadoNoMes("2026-05-20", "2026-05")).toBe(true);
  });
  it("cancelada não conta nos meses posteriores", () => {
    expect(matriculadoNoMes("2026-05-20", "2026-06")).toBe(false);
    expect(matriculadoNoMes("2026-05-20", "2027-01")).toBe(false);
  });
  it("aceita mês de referência com dia", () => {
    expect(matriculadoNoMes("2026-05-20", "2026-06-01")).toBe(false);
  });
});

describe("matriculasDoMes", () => {
  it("aluno cancelado no meio do ano aparece antes, não depois", () => {
    expect(matriculasDoMes(alunos, "2026-01").map((a) => a.aluno_id)).toEqual(["1", "2", "3"]);
    expect(matriculasDoMes(alunos, "2026-03").map((a) => a.aluno_id)).toEqual(["1", "2"]);
    expect(matriculasDoMes(alunos, "2026-09").map((a) => a.aluno_id)).toEqual(["1"]);
  });
});

describe("contarAtivas", () => {
  it("não inclui quem já foi cancelado", () => {
    expect(contarAtivas(alunos)).toBe(1);
    expect(contarAtivas([])).toBe(0);
  });
});
