import { describe, it, expect } from "vitest";
import {
  anoMesDe,
  aplicarUpsertHistorico,
  contarAtivosPorUnidade,
  ehUltimoDiaDoMes,
  hojeEmBrasilia,
  linhasHistoricoDoMes,
  serieHistorico,
  somarTotal,
  unidadesSemDados,
} from "./alunos-ativos";

const CEC = "school-cec";
const BABY = "school-baby";
const BELV = "school-belv";
const VALE = "school-vale";

describe("contarAtivosPorUnidade", () => {
  it("conta alunos distintos por unidade", () => {
    const r = contarAtivosPorUnidade([
      { student_id: "a", school_id: CEC },
      { student_id: "b", school_id: CEC },
      { student_id: "a", school_id: CEC }, // duplicado → conta 1
      { student_id: "c", school_id: BABY },
    ]);
    expect(r).toEqual({ [CEC]: 2, [BABY]: 1 });
  });

  it("mesmo aluno em duas unidades conta em cada uma", () => {
    const r = contarAtivosPorUnidade([
      { student_id: "a", school_id: CEC },
      { student_id: "a", school_id: BELV },
    ]);
    expect(r).toEqual({ [CEC]: 1, [BELV]: 1 });
  });

  it("ignora linhas sem unidade ou sem aluno", () => {
    expect(contarAtivosPorUnidade([{ student_id: "", school_id: CEC }])).toEqual({});
  });

  it("'Todas as Unidades' soma os quatro colégios", () => {
    const por = contarAtivosPorUnidade([
      { student_id: "1", school_id: CEC },
      { student_id: "2", school_id: CEC },
      { student_id: "3", school_id: BABY },
      { student_id: "4", school_id: BELV },
      { student_id: "5", school_id: BELV },
      { student_id: "6", school_id: BELV },
      { student_id: "7", school_id: VALE },
    ]);
    expect(somarTotal(por)).toBe(7);
  });
});

describe("unidadesSemDados", () => {
  it("aponta unidades pedidas sem nenhum vínculo", () => {
    expect(unidadesSemDados([CEC, BABY, BELV], { [CEC]: 10, [BABY]: 3 })).toEqual([BELV]);
  });
  it("vazio quando todas têm dado", () => {
    expect(unidadesSemDados([CEC], { [CEC]: 1 })).toEqual([]);
  });
});

describe("último dia do mês", () => {
  it("detecta fins de mês, inclusive fevereiro bissexto", () => {
    expect(ehUltimoDiaDoMes(new Date(2026, 0, 31))).toBe(true);
    expect(ehUltimoDiaDoMes(new Date(2026, 1, 28))).toBe(true);
    expect(ehUltimoDiaDoMes(new Date(2028, 1, 28))).toBe(false);
    expect(ehUltimoDiaDoMes(new Date(2028, 1, 29))).toBe(true);
    expect(ehUltimoDiaDoMes(new Date(2026, 11, 31))).toBe(true);
  });
  it("não dispara em outros dias", () => {
    expect(ehUltimoDiaDoMes(new Date(2026, 0, 30))).toBe(false);
    expect(ehUltimoDiaDoMes(new Date(2026, 0, 1))).toBe(false);
  });
  it("anoMesDe formata YYYY-MM", () => {
    expect(anoMesDe(new Date(2026, 8, 30))).toBe("2026-09");
    expect(anoMesDe(new Date(2026, 0, 5))).toBe("2026-01");
  });
  it("hojeEmBrasilia: 01:00 UTC do dia 1º ainda é dia 30/31 em Brasília", () => {
    const d = hojeEmBrasilia(new Date(Date.UTC(2026, 9, 1, 1, 0, 0)));
    expect(anoMesDe(d)).toBe("2026-09");
    expect(ehUltimoDiaDoMes(d)).toBe(true);
  });
});

describe("histórico mensal", () => {
  it("gera uma linha por unidade com dado, sem inventar zero", () => {
    expect(linhasHistoricoDoMes({ [CEC]: 240, [BELV]: 140 }, "2026-09")).toEqual([
      { school_id: BELV, ano_mes: "2026-09", total_alunos: 140 },
      { school_id: CEC, ano_mes: "2026-09", total_alunos: 240 },
    ]);
  });

  it("upsert é idempotente por school_id + ano_mes", () => {
    const base = [{ school_id: CEC, ano_mes: "2026-09", total_alunos: 240 }];
    const uma = aplicarUpsertHistorico(base, [
      { school_id: CEC, ano_mes: "2026-09", total_alunos: 241 },
    ]);
    const duas = aplicarUpsertHistorico(uma, [
      { school_id: CEC, ano_mes: "2026-09", total_alunos: 241 },
    ]);
    expect(uma).toEqual([{ school_id: CEC, ano_mes: "2026-09", total_alunos: 241 }]);
    expect(duas).toEqual(uma);
  });

  it("não mistura meses nem unidades no upsert", () => {
    const r = aplicarUpsertHistorico(
      [{ school_id: CEC, ano_mes: "2026-08", total_alunos: 238 }],
      [
        { school_id: CEC, ano_mes: "2026-09", total_alunos: 240 },
        { school_id: BABY, ano_mes: "2026-09", total_alunos: 50 },
      ],
    );
    expect(r).toHaveLength(3);
  });

  it("série soma as unidades do filtro por mês, em ordem, só com meses existentes", () => {
    const rows = [
      { school_id: CEC, ano_mes: "2026-09", total_alunos: 240 },
      { school_id: BABY, ano_mes: "2026-09", total_alunos: 50 },
      { school_id: BELV, ano_mes: "2026-09", total_alunos: 140 },
      { school_id: CEC, ano_mes: "2026-11", total_alunos: 235 },
      { school_id: BELV, ano_mes: "2026-08", total_alunos: 138 },
    ];
    expect(serieHistorico(rows, null)).toEqual([
      { anoMes: "2026-08", month: "08/26", total: 138 },
      { anoMes: "2026-09", month: "09/26", total: 430 },
      { anoMes: "2026-11", month: "11/26", total: 235 },
    ]);
    expect(serieHistorico(rows, [BELV])).toEqual([
      { anoMes: "2026-08", month: "08/26", total: 138 },
      { anoMes: "2026-09", month: "09/26", total: 140 },
    ]);
    expect(serieHistorico(rows, [VALE])).toEqual([]);
  });
});
