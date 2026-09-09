import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_EXTRA,
  ROTULO_CATEGORIA_EXTRA,
  anosDaTabela,
  categoriasSemPreco,
  isCategoriaExtra,
  tabelaDoAno,
  valorHoraExtra,
  valorRefeicoes,
  type PrecoExtra,
} from "@/lib/diario-precos";

function preco(
  unidade: string,
  categoria: PrecoExtra["categoria"],
  anoLetivo: number,
  valor: number,
): PrecoExtra {
  return { unidade, categoria, anoLetivo, valor, atualizadoEm: "", atualizadoPor: "" };
}

describe("categorias dos Extras", () => {
  it("cobre as 4 refeições e a Hora Extra, com rótulos", () => {
    expect(CATEGORIAS_EXTRA).toEqual(["breakfast", "lunch", "snack", "dinner", "hora_extra"]);
    expect(ROTULO_CATEGORIA_EXTRA.hora_extra).toBe("Hora Extra");
    expect(ROTULO_CATEGORIA_EXTRA.breakfast).toBe("Lanche da Manhã");
    expect(isCategoriaExtra("lunch")).toBe(true);
    expect(isCategoriaExtra("uniforme")).toBe(false);
  });
});

describe("tabelaDoAno", () => {
  const precos = [
    preco("CEC", "lunch", 2026, 20),
    preco("CEC", "lunch", 2027, 22),
    preco("CEC", "hora_extra", 2027, 40),
    preco("CEC Baby", "lunch", 2027, 18),
  ];

  it("isola por unidade e ano, sem misturar o ano anterior", () => {
    expect(tabelaDoAno(precos, "CEC", 2027)).toEqual({ lunch: 22, hora_extra: 40 });
    expect(tabelaDoAno(precos, "CEC", 2026)).toEqual({ lunch: 20 });
    expect(tabelaDoAno(precos, "CEC Baby", 2027)).toEqual({ lunch: 18 });
    expect(tabelaDoAno(precos, "Núcleo Belvedere", 2027)).toEqual({});
  });

  it("aponta as categorias ainda sem preço", () => {
    expect(categoriasSemPreco(tabelaDoAno(precos, "CEC", 2027))).toEqual([
      "breakfast",
      "snack",
      "dinner",
    ]);
  });
});

describe("valorRefeicoes", () => {
  it("cobra por ocorrência", () => {
    expect(valorRefeicoes(3, 22)).toBe(66);
    expect(valorRefeicoes(0, 22)).toBe(0);
    expect(valorRefeicoes(2, 0)).toBe(0);
    expect(valorRefeicoes(3, 10.33)).toBe(30.99);
  });
});

describe("valorHoraExtra", () => {
  it("converte minutos em fração de hora × preço da hora", () => {
    expect(valorHoraExtra(60, 40)).toBe(40);
    expect(valorHoraExtra(30, 40)).toBe(20);
    expect(valorHoraExtra(15, 40)).toBe(10);
    expect(valorHoraExtra(75, 40)).toBe(50);
    expect(valorHoraExtra(10, 40)).toBe(6.67);
  });

  it("não cobra sem minutos ou sem preço", () => {
    expect(valorHoraExtra(0, 40)).toBe(0);
    expect(valorHoraExtra(-5, 40)).toBe(0);
    expect(valorHoraExtra(30, 0)).toBe(0);
  });
});

describe("anosDaTabela", () => {
  it("oferece o vigente e o seguinte, mais os anos já cadastrados, do mais novo ao mais antigo", () => {
    expect(anosDaTabela([], 2026)).toEqual([2027, 2026]);
    expect(
      anosDaTabela([preco("CEC", "lunch", 2025, 1), preco("CEC", "lunch", 2027, 1)], 2026),
    ).toEqual([2027, 2026, 2025]);
  });
});
