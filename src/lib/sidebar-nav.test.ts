import { describe, it, expect } from "vitest";
import { isExpanded, toggleExclusive, collapseAll, flattenTos, type NavNode } from "./sidebar-nav";

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

describe("isExpanded", () => {
  it("trata categoria ausente do mapa como recolhida", () => {
    expect(isExpanded({}, "financeiro")).toBe(false);
    expect(isExpanded({ comercial: true }, "financeiro")).toBe(false);
  });

  it("respeita o valor em memória", () => {
    expect(isExpanded({ financeiro: false }, "financeiro")).toBe(false);
    expect(isExpanded({ financeiro: true }, "financeiro")).toBe(true);
  });
});

describe("toggleExclusive", () => {
  const irmas = ["comercial", "financeiro"];

  it("alterna a partir do padrão recolhido", () => {
    const s1 = toggleExclusive({}, "financeiro", irmas);
    expect(isExpanded(s1, "financeiro")).toBe(true);
    const s2 = toggleExclusive(s1, "financeiro", irmas);
    expect(isExpanded(s2, "financeiro")).toBe(false);
  });

  it("abrir uma categoria recolhe as irmãs do mesmo nível", () => {
    const state = toggleExclusive({ comercial: true }, "financeiro", irmas);
    expect(isExpanded(state, "financeiro")).toBe(true);
    expect(isExpanded(state, "comercial")).toBe(false);
  });

  it("não mexe em grupos de outro nível ao abrir", () => {
    const state = toggleExclusive({ "fin-cobranca": true }, "financeiro", irmas);
    expect(isExpanded(state, "fin-cobranca")).toBe(true);
  });

  it("recolher não reabre nem altera as irmãs", () => {
    const state = toggleExclusive({ financeiro: true, comercial: false }, "financeiro", irmas);
    expect(isExpanded(state, "financeiro")).toBe(false);
    expect(isExpanded(state, "comercial")).toBe(false);
  });

  it("não muta o estado original", () => {
    const original = { comercial: true };
    toggleExclusive(original, "financeiro", irmas);
    expect(original).toEqual({ comercial: true });
  });
});

describe("collapseAll", () => {
  it("recolhe todas as categorias abertas", () => {
    expect(collapseAll({ comercial: true, financeiro: true, "fin-cobranca": true })).toEqual({});
  });

  it("retorna a mesma referência quando nada estava aberto (evita re-render)", () => {
    const state = { comercial: false };
    expect(collapseAll(state)).toBe(state);
    const vazio = {};
    expect(collapseAll(vazio)).toBe(vazio);
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
