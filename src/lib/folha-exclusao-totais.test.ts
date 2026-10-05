import { describe, expect, it } from "vitest";
import { chaveColaborador, semDescartados, totaisDasEmpresas } from "./folha-pagamento";

// Dados fictícios.
type Reg = {
  tipo: "empregado" | "contribuinte";
  codigo: string;
  proventos: number;
  descontos: number;
  liquido: number;
};

const reg = (codigo: string, proventos: number, descontos: number): Reg => ({
  tipo: "empregado",
  codigo,
  proventos,
  descontos,
  liquido: Math.round((proventos - descontos) * 100) / 100,
});

// Centavos "quebrados" de propósito: a soma em ponto flutuante erraria.
const FOLHA: Reg[] = [
  reg("1", 1518.1, 121.45),
  reg("2", 2405.47, 250.53),
  reg("3", 3333.33, 0.01),
  reg("4", 0.1, 0.2),
  reg("5", 1999.99, 433.07),
  { ...reg("6", 712.35, 0), tipo: "contribuinte" },
];

const centavos = (t: { proventos: number; descontos: number; liquido: number }) => ({
  proventos: Math.round(t.proventos * 100),
  descontos: Math.round(t.descontos * 100),
  liquido: Math.round(t.liquido * 100),
});

describe("totais da competência ao excluir e desfazer", () => {
  const original = totaisDasEmpresas(FOLHA);
  const alvo = FOLHA[1];

  it("excluir diminui exatamente o valor do colaborador", () => {
    const sem = totaisDasEmpresas(semDescartados(FOLHA, [chaveColaborador(alvo)]));
    expect(centavos(original).proventos - centavos(sem).proventos).toBe(240547);
    expect(centavos(original).descontos - centavos(sem).descontos).toBe(25053);
    expect(centavos(original).liquido - centavos(sem).liquido).toBe(215494);
    expect(sem.colaboradores).toBe(FOLHA.length - 1);
  });

  it("desfazer volta exatamente aos totais originais, centavo por centavo", () => {
    const sem = semDescartados(FOLHA, [chaveColaborador(alvo)]);
    const restaurada = totaisDasEmpresas([...sem, alvo]);
    expect(restaurada).toEqual(original);
    expect(centavos(restaurada)).toEqual(centavos(original));
  });

  it("excluir e desfazer cada um, um de cada vez, sempre volta ao original", () => {
    for (const r of FOLHA) {
      const sem = semDescartados(FOLHA, [chaveColaborador(r)]);
      expect(totaisDasEmpresas([...sem, r])).toEqual(original);
    }
  });

  it("contribuinte e empregado com o mesmo código são registros diferentes", () => {
    const folha = [...FOLHA, reg("6", 100, 10)];
    const sem = totaisDasEmpresas(semDescartados(folha, ["contribuinte:6"]));
    expect(sem.proventos).toBe(totaisDasEmpresas(folha).proventos - 712.35);
  });
});

describe("Belvedere 09/2026: totais após devolver o registro excluído por engano", () => {
  // Folha atual (sem os 7 excluídos e sem o registro desfeito) e o registro
  // devolvido. Só totais: nenhum dado pessoal.
  const atual = { proventos: 98338.89, descontos: 20374.36, liquido: 77964.53 };
  const devolvido = { proventos: 2405.47, descontos: 250.53, liquido: 2154.94 };

  it("proventos R$ 100.744,36, descontos R$ 20.624,89, líquido R$ 80.119,47", () => {
    expect(totaisDasEmpresas([atual, devolvido])).toEqual({
      proventos: 100744.36,
      descontos: 20624.89,
      liquido: 80119.47,
      colaboradores: 2,
    });
  });
});
