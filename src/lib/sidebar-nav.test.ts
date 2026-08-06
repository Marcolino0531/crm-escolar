import { describe, it, expect } from "vitest";
import {
  parseExpandedState,
  serializeExpandedState,
  isExpanded,
  toggleExpanded,
  expandGroups,
  groupIdsForPath,
  flattenTos,
  countExpanded,
  type NavNode,
} from "./sidebar-nav";

// Árvore de exemplo espelhando a hierarquia do menu (Financeiro com subcategorias).
const tree: NavNode[] = [
  { kind: "item", to: "/" },
  {
    kind: "group",
    id: "comercial",
    children: [
      { kind: "item", to: "/agenda" },
      { kind: "item", to: "/admissoes" },
    ],
  },
  {
    kind: "group",
    id: "financeiro",
    children: [
      {
        kind: "group",
        id: "fin-bancario",
        children: [
          { kind: "item", to: "/extrato-bancario" },
          { kind: "item", to: "/cartao-credito" },
        ],
      },
      {
        kind: "group",
        id: "fin-cobranca",
        children: [
          { kind: "item", to: "/cobranca" },
          { kind: "item", to: "/cobranca-automatica" },
        ],
      },
    ],
  },
  { kind: "item", to: "/configuracoes" },
];

describe("parseExpandedState", () => {
  it("lê um mapa válido de booleanos", () => {
    expect(parseExpandedState('{"financeiro":false,"pessoas":true}')).toEqual({
      financeiro: false,
      pessoas: true,
    });
  });

  it("retorna {} para nulo, vazio ou JSON inválido", () => {
    expect(parseExpandedState(null)).toEqual({});
    expect(parseExpandedState("")).toEqual({});
    expect(parseExpandedState("{ not json")).toEqual({});
  });

  it("ignora valores não-booleanos e estruturas não-objeto", () => {
    expect(parseExpandedState('{"a":true,"b":1,"c":"x","d":null}')).toEqual({ a: true });
    expect(parseExpandedState("[true,false]")).toEqual({});
    expect(parseExpandedState("42")).toEqual({});
  });

  it("faz round-trip com serializeExpandedState", () => {
    const state = { financeiro: false, "fin-cobranca": true };
    expect(parseExpandedState(serializeExpandedState(state))).toEqual(state);
  });
});

describe("isExpanded / toggleExpanded", () => {
  it("usa o padrão (expandido) quando o id não está salvo", () => {
    expect(isExpanded({}, "financeiro")).toBe(true);
    expect(isExpanded({}, "financeiro", false)).toBe(false);
  });

  it("respeita o valor salvo", () => {
    expect(isExpanded({ financeiro: false }, "financeiro")).toBe(false);
    expect(isExpanded({ financeiro: true }, "financeiro")).toBe(true);
  });

  it("alterna a partir do padrão e depois inverte", () => {
    const s1 = toggleExpanded({}, "financeiro"); // padrão true → false
    expect(s1.financeiro).toBe(false);
    const s2 = toggleExpanded(s1, "financeiro"); // false → true
    expect(s2.financeiro).toBe(true);
  });

  it("não muta o estado original", () => {
    const original = { pessoas: true };
    toggleExpanded(original, "pessoas");
    expect(original).toEqual({ pessoas: true });
  });
});

describe("expandGroups", () => {
  it("marca os ids informados como expandidos", () => {
    expect(expandGroups({ financeiro: false }, ["financeiro", "fin-cobranca"])).toEqual({
      financeiro: true,
      "fin-cobranca": true,
    });
  });

  it("retorna a mesma referência quando nada muda (evita re-render)", () => {
    const state = { financeiro: true, "fin-cobranca": true };
    expect(expandGroups(state, ["financeiro", "fin-cobranca"])).toBe(state);
    expect(expandGroups(state, [])).toBe(state);
  });
});

describe("groupIdsForPath", () => {
  it("não retorna grupos para item de nível superior", () => {
    expect(groupIdsForPath(tree, "/")).toEqual([]);
    expect(groupIdsForPath(tree, "/configuracoes")).toEqual([]);
  });

  it("retorna a categoria de um item direto", () => {
    expect(groupIdsForPath(tree, "/agenda")).toEqual(["comercial"]);
  });

  it("retorna categoria e subcategoria de um item aninhado", () => {
    expect(groupIdsForPath(tree, "/cobranca-automatica").sort()).toEqual(
      ["fin-cobranca", "financeiro"].sort(),
    );
    expect(groupIdsForPath(tree, "/extrato-bancario").sort()).toEqual(
      ["fin-bancario", "financeiro"].sort(),
    );
  });

  it("casa rotas filhas (deep link) pelo prefixo", () => {
    expect(groupIdsForPath(tree, "/cobranca/123").sort()).toEqual(
      ["fin-cobranca", "financeiro"].sort(),
    );
  });

  it("retorna [] quando a rota não existe no menu", () => {
    expect(groupIdsForPath(tree, "/inexistente")).toEqual([]);
  });
});

describe("flattenTos", () => {
  it("lista as rotas na ordem de exibição, descendo nos grupos", () => {
    expect(flattenTos(tree)).toEqual([
      "/",
      "/agenda",
      "/admissoes",
      "/extrato-bancario",
      "/cartao-credito",
      "/cobranca",
      "/cobranca-automatica",
      "/configuracoes",
    ]);
  });
});

describe("countExpanded", () => {
  it("conta apenas as categorias expandidas salvas", () => {
    expect(countExpanded({ a: true, b: false, c: true })).toBe(2);
    expect(countExpanded({})).toBe(0);
  });
});
