import { describe, it, expect } from "vitest";
import { isExpanded, toggleExpanded, setExpanded, flattenTos, type NavNode } from "./sidebar-nav";

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

describe("setExpanded", () => {
  it("abre e fecha a categoria informada", () => {
    const aberto = setExpanded({}, "financeiro", true);
    expect(aberto.financeiro).toBe(true);
    expect(setExpanded(aberto, "financeiro", false).financeiro).toBe(false);
  });

  it("mantém as outras categorias intactas", () => {
    expect(setExpanded({ comercial: true }, "financeiro", true)).toEqual({
      comercial: true,
      financeiro: true,
    });
  });

  it("retorna a mesma referência quando nada muda (evita re-render)", () => {
    const state = { financeiro: true };
    expect(setExpanded(state, "financeiro", true)).toBe(state);
    expect(setExpanded(state, "comercial", false)).toBe(state);
  });

  it("não muta o estado original", () => {
    const original = { pessoas: true };
    setExpanded(original, "pessoas", false);
    expect(original).toEqual({ pessoas: true });
  });
});

describe("toggleExpanded", () => {
  it("alterna a partir do padrão recolhido", () => {
    const s1 = toggleExpanded({}, "financeiro"); // recolhido → expandido
    expect(s1.financeiro).toBe(true);
    const s2 = toggleExpanded(s1, "financeiro"); // expandido → recolhido
    expect(s2.financeiro).toBe(false);
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
