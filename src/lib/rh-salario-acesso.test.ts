import { describe, expect, it } from "vitest";
import { ALL_MODULES, MODULE_LABELS } from "./app-context";
import { acessoSalario, subPagamentosPermitida } from "./rh-salario-acesso";

describe("módulo rh_salario", () => {
  it("existe em ALL_MODULES com rótulo próprio (aparece na Gestão de Acessos)", () => {
    expect(ALL_MODULES).toContain("rh_salario");
    expect(MODULE_LABELS.rh_salario).toBe("RH — Salário");
  });
});

describe("acessoSalario", () => {
  it("sem rh_salario não vê nem edita, mesmo editando RH em geral", () => {
    // canEdit("rh") não entra no cálculo: a função nem recebe essa permissão.
    expect(acessoSalario({ canViewRhSalario: false, canEditRhSalario: false })).toEqual({
      visivel: false,
      editavel: false,
    });
  });

  it("com leitura vê mas não edita", () => {
    expect(acessoSalario({ canViewRhSalario: true, canEditRhSalario: false })).toEqual({
      visivel: true,
      editavel: false,
    });
  });

  it("com edição vê e edita", () => {
    expect(acessoSalario({ canViewRhSalario: true, canEditRhSalario: true })).toEqual({
      visivel: true,
      editavel: true,
    });
  });

  it("editar sem ver não libera nada", () => {
    expect(acessoSalario({ canViewRhSalario: false, canEditRhSalario: true })).toEqual({
      visivel: false,
      editavel: false,
    });
  });
});

describe("subPagamentosPermitida (acesso direto pela URL)", () => {
  it("?sub=salario sem permissão cai em Vale Transporte", () => {
    expect(subPagamentosPermitida("salario", { visivel: false, editavel: false })).toBe("vt");
  });

  it("?sub=salario com permissão abre Salário", () => {
    expect(subPagamentosPermitida("salario", { visivel: true, editavel: false })).toBe("salario");
  });

  it("valor ausente ou desconhecido abre Vale Transporte", () => {
    expect(subPagamentosPermitida(undefined, { visivel: true, editavel: true })).toBe("vt");
    expect(subPagamentosPermitida("xyz", { visivel: true, editavel: true })).toBe("vt");
  });
});
