import { describe, expect, it } from "vitest";
import {
  competenciaAtual,
  competenciaDe,
  competenciaValida,
  historicoDoFuncionario,
  partesCompetencia,
  preenchimentoSalario,
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
  valorLiquido: number | null = null,
  observacao = "",
): SalarioRegistro => ({
  id,
  funcionarioId,
  competencia,
  valor,
  valorLiquido,
  observacao,
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

describe("competenciaDe / partesCompetencia", () => {
  it("mês+ano ⇄ YYYY-MM", () => {
    expect(competenciaDe(2026, 9)).toBe("2026-09");
    expect(competenciaDe(2027, 12)).toBe("2027-12");
    expect(partesCompetencia("2026-09")).toEqual({ ano: 2026, mes: 9 });
  });
});

describe("preenchimentoSalario (pré-preenchimento do cadastro)", () => {
  const regs = [
    reg("a", "2026-07", 2200, undefined, 1900, "reajuste"),
    reg("a", "2026-01", 2000, undefined, 1750),
  ];

  it("competência sem registro próprio herda bruto e líquido do vigente (virada do mês)", () => {
    expect(preenchimentoSalario(regs, "a", "2026-08")).toEqual({
      valor: 2200,
      valorLiquido: 1900,
      observacao: "",
      proprio: false,
      origem: "2026-07",
    });
  });

  it("competência com registro próprio devolve o próprio (inclusive observação)", () => {
    expect(preenchimentoSalario(regs, "a", "2026-07")).toEqual({
      valor: 2200,
      valorLiquido: 1900,
      observacao: "reajuste",
      proprio: true,
      origem: "2026-07",
    });
  });

  it("competência entre dois registros herda do anterior, não do posterior", () => {
    expect(preenchimentoSalario(regs, "a", "2026-04")).toMatchObject({
      valor: 2000,
      valorLiquido: 1750,
      proprio: false,
      origem: "2026-01",
    });
  });

  it("sem histórico anterior → campos vazios", () => {
    expect(preenchimentoSalario(regs, "a", "2025-12")).toEqual({
      valor: null,
      valorLiquido: null,
      observacao: "",
      proprio: false,
      origem: null,
    });
    expect(preenchimentoSalario(regs, "zz", "2026-08").valor).toBeNull();
  });

  it("não muta os registros (salvar só cria a competência selecionada)", () => {
    const antes = JSON.stringify(regs);
    preenchimentoSalario(regs, "a", "2026-08");
    expect(JSON.stringify(regs)).toBe(antes);
  });
});

describe("validarSalario", () => {
  it("líquido é opcional, mas se vier precisa ser >= 0", () => {
    expect(validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: null })).toEqual({});
    expect(validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: 90 })).toEqual({});
    expect(
      validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: -1 }).valorLiquido,
    ).toBeTruthy();
    expect(
      validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: NaN }).valorLiquido,
    ).toBeTruthy();
  });

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
