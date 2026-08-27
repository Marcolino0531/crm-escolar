import { describe, expect, it } from "vitest";

import {
  addMesesYMD,
  calcularParcelasTermo,
  linhaAluno,
  totalParcelasTermo,
} from "@/lib/confissao-divida";

describe("calcularParcelasTermo — valor das parcelas", () => {
  it("divide igualmente quando a divisão é exata", () => {
    const parcelas = calcularParcelasTermo(1200, 4, "2026-03-10");
    expect(parcelas.map((p) => p.valor)).toEqual([300, 300, 300, 300]);
    expect(totalParcelasTermo(parcelas)).toBe(1200);
  });

  it("joga a sobra de centavos na última parcela", () => {
    const parcelas = calcularParcelasTermo(1000, 3, "2026-03-10");
    expect(parcelas.map((p) => p.valor)).toEqual([333.33, 333.33, 333.34]);
    expect(totalParcelasTermo(parcelas)).toBe(1000);
  });

  it("fecha exatamente o total mesmo com centavos quebrados no valor confessado", () => {
    const parcelas = calcularParcelasTermo(8_547.91, 7, "2026-03-10");
    expect(parcelas).toHaveLength(7);
    expect(totalParcelasTermo(parcelas)).toBe(8_547.91);
    // Só a última difere: as demais são todas o mesmo valor base.
    expect(new Set(parcelas.slice(0, 6).map((p) => p.valor)).size).toBe(1);
  });

  it("parcela única recebe o total integral", () => {
    expect(calcularParcelasTermo(199.99, 1, "2026-03-10")).toEqual([
      { numero: 1, valor: 199.99, vencimento: "2026-03-10" },
    ]);
  });

  it("devolve vazio sem valor, sem parcelas ou sem data válida", () => {
    expect(calcularParcelasTermo(0, 3, "2026-03-10")).toEqual([]);
    expect(calcularParcelasTermo(1000, 0, "2026-03-10")).toEqual([]);
    expect(calcularParcelasTermo(1000, 3, "")).toEqual([]);
  });
});

describe("calcularParcelasTermo — vencimentos", () => {
  it("mantém o dia da 1ª parcela e incrementa um mês por parcela", () => {
    const parcelas = calcularParcelasTermo(300, 3, "2026-03-10");
    expect(parcelas.map((p) => p.vencimento)).toEqual(["2026-03-10", "2026-04-10", "2026-05-11"]);
    // 10/05/2026 é domingo — daí o 11.
  });

  it("empurra sábado e domingo para a segunda-feira seguinte", () => {
    // 07/03/2026 é sábado; 08/03/2026 é domingo.
    expect(calcularParcelasTermo(100, 1, "2026-03-07")[0].vencimento).toBe("2026-03-09");
    expect(calcularParcelasTermo(100, 1, "2026-03-08")[0].vencimento).toBe("2026-03-09");
  });

  it("empurra feriado nacional de data fixa para o próximo dia útil", () => {
    // 07/09/2026 (Independência) é uma segunda-feira → vai para terça, 08/09.
    expect(calcularParcelasTermo(100, 1, "2026-09-07")[0].vencimento).toBe("2026-09-08");
    // 25/12/2026 (Natal) é sexta → rola o fim de semana inteiro até 28/12.
    expect(calcularParcelasTermo(100, 1, "2026-12-25")[0].vencimento).toBe("2026-12-28");
  });

  it("empurra feriado nacional móvel (Sexta-feira Santa) para o próximo dia útil", () => {
    // Páscoa 2026: 05/04 → Sexta-feira Santa em 03/04, que rola para 06/04.
    expect(calcularParcelasTermo(100, 1, "2026-04-03")[0].vencimento).toBe("2026-04-06");
  });

  it("ajusta cada parcela isoladamente, sem arrastar o dia-base", () => {
    const parcelas = calcularParcelasTermo(400, 4, "2026-01-31");
    // 31/01 é sábado → 02/02. Fevereiro não tem dia 31 → 28/02 (sábado) → 02/03.
    expect(parcelas.map((p) => p.vencimento)).toEqual([
      "2026-02-02",
      "2026-03-02",
      "2026-03-31",
      "2026-04-30",
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
