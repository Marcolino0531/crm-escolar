import { describe, it, expect } from "vitest";
import {
  statusAoArquivar,
  statusAoDesarquivar,
  statusAoReceberMensagem,
  deveDesarquivarAoReceber,
  pertenceAAba,
  separarPorAba,
  totalNaoLidas,
} from "./atendimento-archive";

describe("transições manuais de status", () => {
  it("arquivar marca archived=true", () => {
    expect(statusAoArquivar()).toEqual({ archived: true });
  });
  it("desarquivar marca archived=false", () => {
    expect(statusAoDesarquivar()).toEqual({ archived: false });
  });
});

describe("retorno automático ao receber mensagem", () => {
  it("conversa arquivada volta para ativa e incrementa não-lidas", () => {
    const r = statusAoReceberMensagem({ archived: true, unread_count: 0 });
    expect(r).toEqual({ archived: false, unread_count: 1 });
  });

  it("conversa já ativa permanece ativa e incrementa não-lidas", () => {
    const r = statusAoReceberMensagem({ archived: false, unread_count: 2 });
    expect(r).toEqual({ archived: false, unread_count: 3 });
  });

  it("deveDesarquivarAoReceber só é verdadeiro quando estava arquivada", () => {
    expect(deveDesarquivarAoReceber({ archived: true, unread_count: 0 })).toBe(true);
    expect(deveDesarquivarAoReceber({ archived: false, unread_count: 5 })).toBe(false);
  });
});

describe("pertenceAAba / separarPorAba", () => {
  const conversas = [
    { id: "a", archived: false, unread_count: 0 },
    { id: "b", archived: true, unread_count: 3 },
    { id: "c", archived: false, unread_count: 1 },
    { id: "d", archived: true, unread_count: 0 },
  ];

  it("classifica cada conversa na aba correta", () => {
    expect(pertenceAAba(conversas[0], "ativas")).toBe(true);
    expect(pertenceAAba(conversas[0], "arquivadas")).toBe(false);
    expect(pertenceAAba(conversas[1], "arquivadas")).toBe(true);
    expect(pertenceAAba(conversas[1], "ativas")).toBe(false);
  });

  it("particiona preservando a ordem", () => {
    const { ativas, arquivadas } = separarPorAba(conversas);
    expect(ativas.map((c) => c.id)).toEqual(["a", "c"]);
    expect(arquivadas.map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("arquivar em lote move várias conversas de uma vez", () => {
    const idsParaArquivar = new Set(["a", "c"]);
    const depois = conversas.map((c) =>
      idsParaArquivar.has(c.id) ? { ...c, ...statusAoArquivar() } : c,
    );
    const { ativas, arquivadas } = separarPorAba(depois);
    expect(ativas).toEqual([]);
    expect(arquivadas.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("contador de não-lidas em ambas as abas", () => {
  const conversas = [
    { archived: false, unread_count: 2 },
    { archived: true, unread_count: 3 },
    { archived: false, unread_count: 0 },
    { archived: true, unread_count: 0 },
  ];

  it("soma não-lidas por aba independentemente do arquivamento", () => {
    const { ativas, arquivadas } = separarPorAba(conversas);
    expect(totalNaoLidas(ativas)).toBe(2);
    expect(totalNaoLidas(arquivadas)).toBe(3);
  });

  it("arquivar não zera o contador de não-lidas da conversa", () => {
    const c = { archived: false, unread_count: 4 };
    const arquivada = { ...c, ...statusAoArquivar() };
    expect(arquivada.unread_count).toBe(4);
  });
});
