import { describe, expect, it } from "vitest";

import {
  addMesesYMD,
  calcularParcelasBlocos,
  linhaAluno,
  totalDosBlocos,
  totalParcelasTermo,
  vencimentoSugeridoProximoBloco,
  type BlocoParcelamento,
} from "@/lib/confissao-divida";

function bloco(
  id: string,
  quantidade: number,
  valorParcela: number,
  primeiroVencimento: string,
): BlocoParcelamento {
  return { id, quantidade, valorParcela, primeiroVencimento };
}

describe("blocos de parcelamento — caso real do acordo em três faixas", () => {
  // 4x 726,20 (set–dez/2026) + 2x 2.300,00 (jan–fev/2027) + 1x 138,00 (mar/2027).
  const blocos = [
    bloco("a", 4, 726.2, "2026-09-10"),
    bloco("b", 2, 2300, "2027-01-10"),
    bloco("c", 1, 138, "2027-03-10"),
  ];

  it("soma o total confessado dos três blocos", () => {
    expect(totalDosBlocos(blocos)).toBe(7642.8);
  });

  it("gera o cronograma completo em ordem, com numeração contínua", () => {
    const parcelas = calcularParcelasBlocos(blocos);
    expect(parcelas).toHaveLength(7);
    expect(parcelas.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parcelas.map((p) => p.valor)).toEqual([726.2, 726.2, 726.2, 726.2, 2300, 2300, 138]);
    expect(parcelas.map((p) => p.vencimento)).toEqual([
      "2026-09-10",
      "2026-10-13", // 10/10 é sábado e 12/10 (Padroeira) é feriado → 13/10
      "2026-11-10",
      "2026-12-10",
      "2027-01-11", // 10/01/2027 é domingo
      "2027-02-10",
      "2027-03-10",
    ]);
    expect(totalParcelasTermo(parcelas)).toBe(7642.8);
  });

  it("sugere o vencimento do bloco seguinte um mês após a última parcela do anterior", () => {
    expect(vencimentoSugeridoProximoBloco([blocos[0]])).toBe("2027-01-10");
    expect(vencimentoSugeridoProximoBloco(blocos.slice(0, 2))).toBe("2027-03-10");
  });
});

describe("calcularParcelasBlocos — vencimentos", () => {
  it("mantém o dia da 1ª parcela e incrementa um mês por parcela", () => {
    const parcelas = calcularParcelasBlocos([bloco("a", 3, 100, "2026-03-10")]);
    expect(parcelas.map((p) => p.vencimento)).toEqual(["2026-03-10", "2026-04-10", "2026-05-11"]);
    // 10/05/2026 é domingo — daí o 11.
  });

  it("empurra sábado e domingo para a segunda-feira seguinte", () => {
    // 07/03/2026 é sábado; 08/03/2026 é domingo.
    expect(calcularParcelasBlocos([bloco("a", 1, 100, "2026-03-07")])[0].vencimento).toBe(
      "2026-03-09",
    );
    expect(calcularParcelasBlocos([bloco("a", 1, 100, "2026-03-08")])[0].vencimento).toBe(
      "2026-03-09",
    );
  });

  it("empurra feriado nacional de data fixa para o próximo dia útil", () => {
    // 07/09/2026 (Independência) é uma segunda-feira → vai para terça, 08/09.
    expect(calcularParcelasBlocos([bloco("a", 1, 100, "2026-09-07")])[0].vencimento).toBe(
      "2026-09-08",
    );
    // 25/12/2026 (Natal) é sexta → rola o fim de semana inteiro até 28/12.
    expect(calcularParcelasBlocos([bloco("a", 1, 100, "2026-12-25")])[0].vencimento).toBe(
      "2026-12-28",
    );
  });

  it("empurra feriado nacional móvel (Sexta-feira Santa) para o próximo dia útil", () => {
    // Páscoa 2026: 05/04 → Sexta-feira Santa em 03/04, que rola para 06/04.
    expect(calcularParcelasBlocos([bloco("a", 1, 100, "2026-04-03")])[0].vencimento).toBe(
      "2026-04-06",
    );
  });

  it("ajusta cada parcela isoladamente, sem arrastar o dia-base", () => {
    const parcelas = calcularParcelasBlocos([bloco("a", 4, 100, "2026-01-31")]);
    // 31/01 é sábado → 02/02. Fevereiro não tem dia 31 → 28/02 (sábado) → 02/03.
    expect(parcelas.map((p) => p.vencimento)).toEqual([
      "2026-02-02",
      "2026-03-02",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("aplica o ajuste de feriado também em bloco posterior", () => {
    // Bloco que começa em 12/10/2027 (Padroeira, terça) → 13/10.
    const parcelas = calcularParcelasBlocos([
      bloco("a", 1, 100, "2027-09-15"),
      bloco("b", 1, 200, "2027-10-12"),
    ]);
    expect(parcelas[1].vencimento).toBe("2027-10-13");
  });

  it("ignora bloco sem valor, sem parcelas ou sem data válida", () => {
    expect(calcularParcelasBlocos([bloco("a", 3, 0, "2026-03-10")])).toEqual([]);
    expect(calcularParcelasBlocos([bloco("a", 0, 100, "2026-03-10")])).toEqual([]);
    expect(calcularParcelasBlocos([bloco("a", 3, 100, "")])).toEqual([]);
    expect(totalDosBlocos([bloco("a", 2, 100, ""), bloco("b", 1, 50, "2026-03-10")])).toBe(250);
  });

  it("parcela única recebe exatamente o valor digitado", () => {
    expect(calcularParcelasBlocos([bloco("a", 1, 199.99, "2026-03-10")])).toEqual([
      { numero: 1, valor: 199.99, vencimento: "2026-03-10" },
    ]);
  });
});

describe("addMesesYMD", () => {
  it("preserva o dia quando ele existe no mês de destino", () => {
    expect(addMesesYMD("2026-03-10", 1)).toBe("2026-04-10");
    expect(addMesesYMD("2026-12-05", 1)).toBe("2027-01-05");
  });

  it("cai no último dia do mês quando o dia não existe", () => {
    expect(addMesesYMD("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMesesYMD("2024-01-31", 1)).toBe("2024-02-29");
  });
});

describe("linhaAluno", () => {
  it('usa o formato "código – NOME" com a matrícula do Sponte', () => {
    expect(
      linhaAluno({ alunoId: "672", matricula: "20240765", nome: "Giovanna Gomes Oliveira Maron" }),
    ).toBe("20240765 – GIOVANNA GOMES OLIVEIRA MARON");
  });

  it("cai no AlunoID quando o aluno não tem número de matrícula", () => {
    expect(linhaAluno({ alunoId: "672", matricula: "", nome: "Bento Silva" })).toBe(
      "672 – BENTO SILVA",
    );
  });
});
