import { describe, expect, it } from "vitest";
import { MODULE_LABELS } from "./app-context";
import { noPorChave } from "./permissoes-arvore";
import { acessoSalario, subAbasPagamentos, subPagamentosPermitida } from "./rh-salario-acesso";

describe("página RH > Pagamentos > Salário", () => {
  it("existe na árvore com rótulo próprio e herda o legado rh_salario", () => {
    expect(MODULE_LABELS["rh.pagamentos.salario"]).toBe("Salário");
    expect(noPorChave("rh.pagamentos.salario")?.legado?.ver.flat()).toEqual(["rh_salario"]);
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

  it("?sub=folhas abre Folhas Salvas para qualquer um", () => {
    expect(subPagamentosPermitida("folhas", { visivel: false, editavel: false })).toBe("folhas");
  });
});

describe("subAbasPagamentos", () => {
  it("ordem Salário, Vale Transporte, Folhas Salvas com permissão", () => {
    expect(subAbasPagamentos({ visivel: true, editavel: false }).map((a) => a.id)).toEqual([
      "salario",
      "vt",
      "folhas",
    ]);
  });

  it("sem rh_salario, Salário não aparece", () => {
    expect(subAbasPagamentos({ visivel: false, editavel: false }).map((a) => a.id)).toEqual([
      "vt",
      "folhas",
    ]);
  });
});
