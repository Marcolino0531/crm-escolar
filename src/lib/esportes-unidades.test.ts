import { describe, expect, it } from "vitest";
import {
  agruparPorUnidade,
  modalidadeDaUnidade,
  modalidadesDaUnidade,
  podeOperarModalidade,
  selecaoValida,
  unidadeDaSelecao,
  unidadeParaCadastro,
} from "./esportes-unidades";

const SCHOOLS = [
  { id: "uuid-cec", name: "CEC" },
  { id: "uuid-baby", name: "CEC Baby" },
  { id: "uuid-belvedere", name: "Núcleo Belvedere" },
  { id: "uuid-vale", name: "Núcleo Vale do Sereno" },
];

// Mesmo nome em unidades diferentes: registros independentes.
const JAZZ_CEC = { id: "m1", nome: "Jazz", unidade: "CEC" };
const JAZZ_BELVEDERE = { id: "m2", nome: "Jazz", unidade: "Núcleo Belvedere" };
const TEATRO_CEC = { id: "m3", nome: "Teatro", unidade: "CEC" };
const JIU_BABY = { id: "m4", nome: "Jiu-Jitsu", unidade: "CEC Baby" };
const TODAS = [JAZZ_CEC, JAZZ_BELVEDERE, TEATRO_CEC, JIU_BABY];

describe("unidadeDaSelecao", () => {
  it("traduz o uuid da unidade selecionada no nome usado pela modalidade", () => {
    expect(unidadeDaSelecao("uuid-belvedere", SCHOOLS)).toBe("Núcleo Belvedere");
  });

  it('"Todas as Unidades" não tem unidade ativa', () => {
    expect(unidadeDaSelecao("all", SCHOOLS)).toBeNull();
  });

  it("uuid desconhecido não vira unidade nenhuma", () => {
    expect(unidadeDaSelecao("uuid-inexistente", SCHOOLS)).toBeNull();
  });
});

describe("modalidadesDaUnidade — isolamento", () => {
  it("a unidade vê só as próprias modalidades", () => {
    expect(modalidadesDaUnidade(TODAS, "CEC")).toEqual([JAZZ_CEC, TEATRO_CEC]);
    expect(modalidadesDaUnidade(TODAS, "CEC Baby")).toEqual([JIU_BABY]);
  });

  it("mesmo nome em duas unidades não se confunde", () => {
    const noBelvedere = modalidadesDaUnidade(TODAS, "Núcleo Belvedere");
    expect(noBelvedere).toHaveLength(1);
    expect(noBelvedere[0].id).toBe(JAZZ_BELVEDERE.id);
  });

  it("unidade sem modalidade não herda as das outras", () => {
    expect(modalidadesDaUnidade(TODAS, "Núcleo Vale do Sereno")).toEqual([]);
  });

  it("o consolidado não opera modalidade nenhuma", () => {
    expect(modalidadesDaUnidade(TODAS, null)).toEqual([]);
  });

  it("nome de unidade com espaços sobrando ainda é a mesma unidade", () => {
    expect(modalidadeDaUnidade({ id: "x", nome: "Jazz", unidade: " CEC " }, "CEC")).toBe(true);
  });

  it("unidade parecida não é a mesma unidade", () => {
    expect(modalidadeDaUnidade(JAZZ_CEC, "CEC Baby")).toBe(false);
    expect(modalidadeDaUnidade(JIU_BABY, "CEC")).toBe(false);
  });
});

describe("selecaoValida", () => {
  it("mantém a modalidade selecionada quando ela é da unidade", () => {
    expect(selecaoValida(TODAS, "CEC", TEATRO_CEC.id)).toBe(TEATRO_CEC.id);
  });

  it("ao trocar de unidade, descarta a modalidade da unidade anterior", () => {
    expect(selecaoValida(TODAS, "CEC Baby", TEATRO_CEC.id)).toBe(JIU_BABY.id);
  });

  it("unidade sem modalidades zera a seleção", () => {
    expect(selecaoValida(TODAS, "Núcleo Vale do Sereno", JAZZ_CEC.id)).toBe("");
  });

  it("consolidado não seleciona modalidade", () => {
    expect(selecaoValida(TODAS, null, JAZZ_CEC.id)).toBe("");
  });
});

describe("podeOperarModalidade", () => {
  it("edita a modalidade da unidade ativa", () => {
    expect(podeOperarModalidade(JAZZ_CEC, "CEC", true)).toBe(true);
  });

  it("nunca edita modalidade de outra unidade", () => {
    expect(podeOperarModalidade(JAZZ_BELVEDERE, "CEC", true)).toBe(false);
  });

  it("consolidado é somente leitura", () => {
    expect(podeOperarModalidade(JAZZ_CEC, null, true)).toBe(false);
  });

  it("sem permissão de edição no módulo, nem na própria unidade", () => {
    expect(podeOperarModalidade(JAZZ_CEC, "CEC", false)).toBe(false);
  });

  it("sem modalidade selecionada não há o que operar", () => {
    expect(podeOperarModalidade(null, "CEC", true)).toBe(false);
  });
});

describe("unidadeParaCadastro", () => {
  it("a modalidade nova nasce na unidade selecionada", () => {
    expect(unidadeParaCadastro("Núcleo Belvedere")).toBe("Núcleo Belvedere");
  });

  it("no consolidado o cadastro é recusado (nunca fica solta)", () => {
    expect(() => unidadeParaCadastro(null)).toThrow(/unidade específica/i);
  });
});

describe("agruparPorUnidade", () => {
  it("agrupa e ordena por unidade e por nome, sem misturar unidades", () => {
    expect(agruparPorUnidade(TODAS)).toEqual([
      { unidade: "CEC", modalidades: [JAZZ_CEC, TEATRO_CEC] },
      { unidade: "CEC Baby", modalidades: [JIU_BABY] },
      { unidade: "Núcleo Belvedere", modalidades: [JAZZ_BELVEDERE] },
    ]);
  });

  it("cada modalidade aparece uma única vez, na sua unidade", () => {
    const grupos = agruparPorUnidade(TODAS);
    const ids = grupos.flatMap((g) => g.modalidades.map((m) => m.id));
    expect(ids).toHaveLength(new Set(ids).size);
    for (const g of grupos) {
      for (const m of g.modalidades) expect(m.unidade.trim()).toBe(g.unidade);
    }
  });
});
