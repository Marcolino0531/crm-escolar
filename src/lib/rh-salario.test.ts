import { describe, expect, it } from "vitest";
import {
  competenciaAtual,
  competenciaValida,
  historicoDoFuncionario,
  rotuloCompetencia,
  salarioVigente,
  validarSalario,
  type SalarioRegistro,
} from "./rh-salario";

const reg = (
  funcionarioId: string,
  competencia: string,
  valor: number,
  id = `${funcionarioId}-${competencia}`,
): SalarioRegistro => ({
  id,
  funcionarioId,
  competencia,
  valor,
  observacao: "",
  criadoEm: "2026-01-01T00:00:00Z",
  criadoPor: "Teste",
});

const base = [
  reg("a", "2026-01", 2000),
  reg("a", "2026-07", 2200),
  reg("a", "2025-05", 1800),
  reg("b", "2026-03", 3000),
];

describe("competência", () => {
  it("valida YYYY-MM", () => {
    expect(competenciaValida("2026-09")).toBe(true);
    expect(competenciaValida("2026-13")).toBe(false);
    expect(competenciaValida("09/2026")).toBe(false);
    expect(competenciaValida("")).toBe(false);
  });

  it("competência atual e rótulo MM/AAAA", () => {
    expect(competenciaAtual(new Date(2026, 8, 17))).toBe("2026-09");
    expect(rotuloCompetencia("2026-09")).toBe("09/2026");
  });
});

describe("historicoDoFuncionario", () => {
  it("filtra pelo funcionário, mais recente primeiro, sem mutar a entrada", () => {
    const copia = [...base];
    expect(historicoDoFuncionario(base, "a").map((r) => r.competencia)).toEqual([
      "2026-07",
      "2026-01",
      "2025-05",
    ]);
    expect(base).toEqual(copia);
  });
});

describe("salarioVigente", () => {
  it("usa a maior competência <= pedida (histórico preservado, não sobrescreve)", () => {
    expect(salarioVigente(base, "a", "2026-03")?.valor).toBe(2000);
    expect(salarioVigente(base, "a", "2026-07")?.valor).toBe(2200);
    expect(salarioVigente(base, "a", "2027-01")?.valor).toBe(2200);
    expect(salarioVigente(base, "a", "2025-12")?.valor).toBe(1800);
  });

  it("antes do primeiro registro ou funcionário sem salário → null", () => {
    expect(salarioVigente(base, "a", "2025-01")).toBeNull();
    expect(salarioVigente(base, "c", "2026-09")).toBeNull();
  });

  it("não vaza salário de outro funcionário", () => {
    expect(salarioVigente(base, "b", "2026-09")?.valor).toBe(3000);
    expect(salarioVigente(base, "b", "2026-02")).toBeNull();
  });
});

describe("validarSalario", () => {
  it("aceita competência válida e valor >= 0", () => {
    expect(validarSalario({ competencia: "2026-09", valor: 0 })).toEqual({});
    expect(validarSalario({ competencia: "2026-09", valor: 2500.5 })).toEqual({});
  });

  it("rejeita competência inválida e valor negativo/NaN", () => {
    expect(validarSalario({ competencia: "2026", valor: -1 })).toEqual({
      competencia: "Informe a competência (MM/AAAA).",
      valor: "Informe um valor maior ou igual a zero.",
    });
    expect(validarSalario({ competencia: "2026-09", valor: NaN }).valor).toBeDefined();
  });
});
