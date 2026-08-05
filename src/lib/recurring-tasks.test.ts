import { describe, it, expect } from "vitest";
import {
  daysInMonth,
  resolveOccurrenceDay,
  resolveOccurrenceDate,
  monthKey,
  completedKey,
  occurrenceStatus,
  dueOccurrences,
  countDuePending,
  type RecurringTaskDef,
} from "./recurring-tasks";

const def = (id: string, day: number, title = id): RecurringTaskDef => ({
  id,
  title,
  description: null,
  day_of_month: day,
});

describe("daysInMonth", () => {
  it("retorna o tamanho correto de cada mês", () => {
    expect(daysInMonth(2025, 0)).toBe(31); // janeiro
    expect(daysInMonth(2025, 1)).toBe(28); // fevereiro (não bissexto)
    expect(daysInMonth(2024, 1)).toBe(29); // fevereiro bissexto
    expect(daysInMonth(2025, 3)).toBe(30); // abril
  });
});

describe("resolveOccurrenceDay / resolveOccurrenceDate", () => {
  it("mantém o dia quando ele existe no mês", () => {
    expect(resolveOccurrenceDay(2025, 0, 15)).toBe(15);
    expect(resolveOccurrenceDate(2025, 0, 1)).toBe("2025-01-01");
    expect(resolveOccurrenceDate(2025, 8, 10)).toBe("2025-09-10");
  });

  it("grampeia o dia ao último dia do mês quando excede o tamanho", () => {
    expect(resolveOccurrenceDate(2025, 1, 31)).toBe("2025-02-28"); // fev não bissexto
    expect(resolveOccurrenceDate(2024, 1, 31)).toBe("2024-02-29"); // fev bissexto
    expect(resolveOccurrenceDate(2025, 3, 31)).toBe("2025-04-30"); // abril (30)
    expect(resolveOccurrenceDate(2025, 0, 31)).toBe("2025-01-31"); // janeiro (31)
  });

  it("normaliza valores inválidos/fora do intervalo", () => {
    expect(resolveOccurrenceDay(2025, 0, 0)).toBe(1);
    expect(resolveOccurrenceDay(2025, 0, -5)).toBe(1);
    expect(resolveOccurrenceDay(2025, 0, 10.9)).toBe(10);
  });
});

describe("recorrência mês a mês", () => {
  it("gera uma ocorrência por mês, cada uma no dia configurado", () => {
    const d = def("a", 10);
    const meses = [0, 1, 2, 3].map((m0) => resolveOccurrenceDate(2025, m0, d.day_of_month));
    expect(meses).toEqual(["2025-01-10", "2025-02-10", "2025-03-10", "2025-04-10"]);
  });

  it("cada mês tem sua própria chave", () => {
    expect(monthKey(2025, 0)).toBe("2025-01");
    expect(monthKey(2025, 11)).toBe("2025-12");
  });
});

describe("occurrenceStatus", () => {
  it("cumprida quando marcada, independentemente da data", () => {
    expect(occurrenceStatus("2025-01-10", true, "2025-01-05")).toBe("cumprida");
    expect(occurrenceStatus("2025-01-10", true, "2025-01-20")).toBe("cumprida");
  });

  it("vencida quando a data já chegou (inclui o próprio dia) e não cumprida", () => {
    expect(occurrenceStatus("2025-01-10", false, "2025-01-10")).toBe("vencida");
    expect(occurrenceStatus("2025-01-10", false, "2025-01-15")).toBe("vencida");
  });

  it("futura quando a data ainda não chegou", () => {
    expect(occurrenceStatus("2025-01-10", false, "2025-01-09")).toBe("futura");
  });
});

describe("dueOccurrences / countDuePending", () => {
  const defs = [def("a", 1, "Faturamento"), def("b", 10, "Seguro"), def("c", 20, "Relatório")];

  it("conta apenas as rotinas cujo dia já venceu e não estão cumpridas", () => {
    // Hoje é dia 10: 'a' (dia 1) e 'b' (dia 10) venceram; 'c' (dia 20) não.
    const due = dueOccurrences(defs, new Set(), "2025-03-10");
    expect(due.map((d) => d.def.id)).toEqual(["a", "b"]);
    expect(countDuePending(defs, new Set(), "2025-03-10")).toBe(2);
  });

  it("exclui as ocorrências já marcadas como cumpridas no mês corrente", () => {
    const completed = new Set([completedKey("a", "2025-03")]);
    const due = dueOccurrences(defs, completed, "2025-03-10");
    expect(due.map((d) => d.def.id)).toEqual(["b"]);
    expect(countDuePending(defs, completed, "2025-03-10")).toBe(1);
  });

  it("isolamento por mês: cumprir num mês não suprime a ocorrência do mês seguinte", () => {
    // 'a' foi cumprida em fevereiro; em março ela volta a vencer normalmente.
    const completedFev = new Set([completedKey("a", "2025-02")]);
    const due = dueOccurrences(defs, completedFev, "2025-03-10");
    expect(due.map((d) => d.def.id)).toEqual(["a", "b"]);
  });

  it("nenhuma vencida antes do primeiro dia configurado", () => {
    // Hoje dia 1, menor def é dia 1 → apenas 'a'.
    expect(countDuePending(defs, new Set(), "2025-03-01")).toBe(1);
  });

  it("ordena por data e depois por título", () => {
    const mesmoDia = [def("x", 5, "Zebra"), def("y", 5, "Abacaxi")];
    const due = dueOccurrences(mesmoDia, new Set(), "2025-03-10");
    expect(due.map((d) => d.def.title)).toEqual(["Abacaxi", "Zebra"]);
  });
});
