import { describe, expect, it } from "vitest";
import {
  anosDisponiveis,
  competenciasDoPeriodo,
  dentroDoPeriodo,
  periodoAtual,
  rotuloPeriodo,
} from "./rh-periodo";

describe("periodoAtual", () => {
  it("começa no mês corrente", () => {
    expect(periodoAtual(new Date(2026, 8, 15))).toEqual({ modo: "mes", ano: 2026, mes: 9 });
  });
});

describe("dentroDoPeriodo", () => {
  const mes = { modo: "mes", ano: 2026, mes: 7 } as const;
  const ano = { modo: "ano", ano: 2026, mes: 7 } as const;

  it("filtro mensal aceita só as datas do mês", () => {
    expect(dentroDoPeriodo("2026-07-01", mes)).toBe(true);
    expect(dentroDoPeriodo("2026-07-31", mes)).toBe(true);
    expect(dentroDoPeriodo("2026-06-30", mes)).toBe(false);
    expect(dentroDoPeriodo("2026-08-01", mes)).toBe(false);
    expect(dentroDoPeriodo("2025-07-10", mes)).toBe(false);
  });

  it("filtro anual soma todos os meses do ano", () => {
    expect(dentroDoPeriodo("2026-01-05", ano)).toBe(true);
    expect(dentroDoPeriodo("2026-12-31", ano)).toBe(true);
    expect(dentroDoPeriodo("2025-12-31", ano)).toBe(false);
  });

  it("data vazia ou inválida fica fora", () => {
    expect(dentroDoPeriodo("", mes)).toBe(false);
    expect(dentroDoPeriodo(undefined, ano)).toBe(false);
  });
});

describe("competenciasDoPeriodo / rotuloPeriodo", () => {
  it("mês devolve uma competência; ano devolve as doze", () => {
    expect(competenciasDoPeriodo({ modo: "mes", ano: 2026, mes: 3 })).toEqual(["2026-03"]);
    const doAno = competenciasDoPeriodo({ modo: "ano", ano: 2026, mes: 3 });
    expect(doAno).toHaveLength(12);
    expect(doAno[0]).toBe("2026-01");
    expect(doAno[11]).toBe("2026-12");
  });

  it("rótulo distingue mês de ano inteiro", () => {
    expect(rotuloPeriodo({ modo: "mes", ano: 2026, mes: 7 })).toBe("Julho/2026");
    expect(rotuloPeriodo({ modo: "ano", ano: 2026, mes: 7 })).toBe("2026");
  });
});

describe("anosDisponiveis", () => {
  it("inclui o ano corrente e os anos das datas, do mais recente ao mais antigo", () => {
    const anos = anosDisponiveis(["2024-03-01", "2026-07-10", "1998-01-01"], new Date(2026, 0, 1));
    expect(anos).toEqual([2026, 2024]);
  });
});
