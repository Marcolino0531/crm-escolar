import { describe, expect, it } from "vitest";

import {
  escolaAtivaId,
  exigeUnidadeEspecifica,
  filtrarPorUnidade,
  rotuloUnidadeAtiva,
  unidadeAtiva,
} from "./unidade-global";

const schools = [
  { id: "u1", name: "CEC" },
  { id: "u2", name: "CEC Baby" },
  { id: "u3", name: "Núcleo Belvedere" },
];

describe("unidadeAtiva", () => {
  it("devolve o nome da unidade escolhida no topo", () => {
    expect(unidadeAtiva("u3", schools)).toBe("Núcleo Belvedere");
  });

  it("devolve null no consolidado", () => {
    expect(unidadeAtiva("all", schools)).toBeNull();
  });

  it("devolve null quando a seleção não é visível ao usuário", () => {
    expect(unidadeAtiva("u9", schools)).toBeNull();
  });

  it("acompanha a troca do seletor global sem estado interno", () => {
    expect(unidadeAtiva("u1", schools)).toBe("CEC");
    expect(unidadeAtiva("u2", schools)).toBe("CEC Baby");
  });
});

describe("escolaAtivaId", () => {
  it("devolve o id da escola selecionada", () => {
    expect(escolaAtivaId("u2", schools)).toBe("u2");
  });

  it("não devolve id no consolidado nem em seleção inválida", () => {
    expect(escolaAtivaId("all", schools)).toBeNull();
    expect(escolaAtivaId("u9", schools)).toBeNull();
  });
});

describe("exigeUnidadeEspecifica", () => {
  it("cobra escolha no topo quando está em Todas as Unidades", () => {
    expect(exigeUnidadeEspecifica("all", schools)).toBe(true);
  });

  it("libera a tela com uma unidade específica", () => {
    expect(exigeUnidadeEspecifica("u1", schools)).toBe(false);
  });
});

describe("filtrarPorUnidade", () => {
  const linhas = [
    { id: 1, unidade: "CEC" },
    { id: 2, unidade: "CEC Baby" },
    { id: 3, unidade: " cec " },
    { id: 4, unidade: null },
  ];
  const unidadeDe = (l: (typeof linhas)[number]) => l.unidade;

  it("filtra pela unidade do topo, tolerando espaços e caixa", () => {
    expect(filtrarPorUnidade(linhas, "CEC", unidadeDe).map((l) => l.id)).toEqual([1, 3]);
  });

  it("no consolidado devolve tudo o que a consulta trouxe", () => {
    expect(filtrarPorUnidade(linhas, null, unidadeDe)).toHaveLength(4);
  });

  it("troca de unidade troca o resultado sem seleção interna", () => {
    expect(filtrarPorUnidade(linhas, "CEC Baby", unidadeDe).map((l) => l.id)).toEqual([2]);
  });

  it("descarta linha sem unidade quando há unidade ativa", () => {
    expect(filtrarPorUnidade(linhas, "Núcleo Belvedere", unidadeDe)).toEqual([]);
  });
});

describe("rotuloUnidadeAtiva", () => {
  it("mostra a unidade ou o consolidado", () => {
    expect(rotuloUnidadeAtiva("u1", schools)).toBe("CEC");
    expect(rotuloUnidadeAtiva("all", schools)).toBe("Todas as Unidades");
  });
});
