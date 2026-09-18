import { describe, expect, it } from "vitest";
import {
  contagemQuitados,
  montarFolhaSalario,
  podeEditarLote,
  podeVerLote,
  tipoLote,
} from "./rh-folhas";
import type { SalarioRegistro } from "./rh-salario";

const reg = (
  funcionarioId: string,
  competencia: string,
  valor: number,
  valorLiquido: number | null = null,
): SalarioRegistro => ({
  id: `${funcionarioId}-${competencia}`,
  funcionarioId,
  competencia,
  valor,
  valorLiquido,
  observacao: "",
  criadoEm: "2026-01-01T00:00:00Z",
  criadoPor: "Teste",
});

const funcs = [
  { id: "b", nomeCompleto: "Bruna" },
  { id: "a", nomeCompleto: "Ana" },
  { id: "c", nomeCompleto: "Carlos", dataRescisao: "2026-05-01" },
  { id: "d", nomeCompleto: "Dora" },
];

const regs = [
  reg("a", "2026-01", 3000, 2500),
  reg("a", "2026-09", 3300, 2700),
  reg("b", "2026-03", 2000),
  reg("c", "2026-01", 9999, 9000),
  reg("d", "2026-10", 1500),
];

describe("tipoLote", () => {
  it("tudo que não é 'salario' é VT (dados antigos sem tipo)", () => {
    expect(tipoLote("salario")).toBe("salario");
    expect(tipoLote("vt")).toBe("vt");
    expect(tipoLote(null)).toBe("vt");
    expect(tipoLote(undefined)).toBe("vt");
  });
});

describe("montarFolhaSalario", () => {
  it("um item por ativo com salário vigente, líquido quando houver, ordenado por nome", () => {
    const f = montarFolhaSalario(funcs, regs, "2026-08");
    expect(f.itens).toEqual([
      { employee_id: "a", employee_name: "Ana", total_amount: 2500 },
      { employee_id: "b", employee_name: "Bruna", total_amount: 2000 },
    ]);
    expect(f.total).toBe(4500);
  });

  it("respeita a competência (reajuste de setembro não entra em agosto)", () => {
    expect(montarFolhaSalario(funcs, regs, "2026-09").itens[0].total_amount).toBe(2700);
    expect(montarFolhaSalario(funcs, regs, "2026-08").itens[0].total_amount).toBe(2500);
  });

  it("desligado fica fora; ativo sem salário vigente vai para semSalario", () => {
    const f = montarFolhaSalario(funcs, regs, "2026-08");
    expect(f.itens.map((i) => i.employee_id)).not.toContain("c");
    expect(f.semSalario).toEqual(["Dora"]);
    // Em outubro Dora já tem salário.
    expect(montarFolhaSalario(funcs, regs, "2026-10").semSalario).toEqual([]);
  });

  it("total arredondado a centavos", () => {
    const f = montarFolhaSalario(
      [
        { id: "x", nomeCompleto: "X" },
        { id: "y", nomeCompleto: "Y" },
      ],
      [reg("x", "2026-01", 0.1), reg("y", "2026-01", 0.2)],
      "2026-01",
    );
    expect(f.total).toBe(0.3);
  });
});

describe("permissões por tipo de lote", () => {
  const soRh = { podeEditarRh: true, podeVerSalario: false, podeEditarSalario: false };
  const veSalario = { podeEditarRh: false, podeVerSalario: true, podeEditarSalario: false };
  const editaSalario = { podeEditarRh: false, podeVerSalario: true, podeEditarSalario: true };

  it("editar RH não dá acesso a lotes de salário", () => {
    expect(podeVerLote("vt", soRh)).toBe(true);
    expect(podeEditarLote("vt", soRh)).toBe(true);
    expect(podeVerLote("salario", soRh)).toBe(false);
    expect(podeEditarLote("salario", soRh)).toBe(false);
  });

  it("rh_salario controla os lotes de salário, sem afetar VT", () => {
    expect(podeVerLote("salario", veSalario)).toBe(true);
    expect(podeEditarLote("salario", veSalario)).toBe(false);
    expect(podeEditarLote("salario", editaSalario)).toBe(true);
    expect(podeEditarLote("vt", editaSalario)).toBe(false);
  });
});

describe("contagemQuitados", () => {
  it("conta pagos e marca quitado só com todos pagos", () => {
    expect(contagemQuitados([{ is_paid: true }, { is_paid: false }])).toEqual({
      pagos: 1,
      total: 2,
      quitado: false,
    });
    expect(contagemQuitados([{ is_paid: true }, { is_paid: true }]).quitado).toBe(true);
    expect(contagemQuitados([]).quitado).toBe(false);
  });
});
