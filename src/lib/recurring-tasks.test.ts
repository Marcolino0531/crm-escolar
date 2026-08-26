import { describe, it, expect } from "vitest";
import {
  daysInMonth,
  resolveOccurrenceDay,
  resolveOccurrenceDate,
  monthKey,
  completedKey,
  occurrenceStatus,
  occursInMonth,
  firstOccurrenceMonthKey,
  dueOccurrences,
  countDuePending,
  occurrenceDateInMonth,
  isPontual,
  type RecurringTaskDef,
} from "./recurring-tasks";

// start_month padrão bem no passado para não filtrar os testes que não o exercitam.
const def = (id: string, day: number, title = id, start_month = "2000-01"): RecurringTaskDef => ({
  id,
  title,
  description: null,
  day_of_month: day,
  start_month,
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

describe("firstOccurrenceMonthKey", () => {
  it("usa o próprio mês quando o dia ainda não passou", () => {
    expect(firstOccurrenceMonthKey("2026-08-05", 10)).toBe("2026-08");
  });

  it("inclui o próprio dia da criação (não considera vencido)", () => {
    expect(firstOccurrenceMonthKey("2026-08-10", 10)).toBe("2026-08");
  });

  it("avança para o mês seguinte quando o dia já passou na criação", () => {
    expect(firstOccurrenceMonthKey("2026-08-15", 10)).toBe("2026-09");
  });

  it("vira o ano quando a criação é em dezembro após o dia", () => {
    expect(firstOccurrenceMonthKey("2026-12-20", 10)).toBe("2027-01");
  });

  it("grampeia o dia ao fim do mês ao decidir o marco", () => {
    // Fev não bissexto: dia 31 → ocorrência 28; criando em 28 ainda conta este mês.
    expect(firstOccurrenceMonthKey("2025-02-28", 31)).toBe("2025-02");
    // Criando em 27, a ocorrência (28) ainda não passou → este mês.
    expect(firstOccurrenceMonthKey("2025-02-27", 31)).toBe("2025-02");
  });
});

describe("start_month: sem ocorrências retroativas", () => {
  it("occursInMonth só a partir de start_month (inclusive)", () => {
    const d = def("a", 10, "a", "2026-08");
    expect(occursInMonth(d, "2026-07")).toBe(false);
    expect(occursInMonth(d, "2026-08")).toBe(true);
    expect(occursInMonth(d, "2026-09")).toBe(true);
  });

  it("não gera vencidas em meses anteriores ao de criação", () => {
    // Criada em agosto/2026 (dia 10). Em julho/2026 não deve haver nada vencido.
    const d = def("a", 10, "Faturamento", "2026-08");
    expect(countDuePending([d], new Set(), "2026-07-31")).toBe(0);
    expect(dueOccurrences([d], new Set(), "2026-07-31")).toEqual([]);
  });

  it("quando o dia já passou na criação, o mês da criação também fica sem vencida", () => {
    // Criada em 15/08 para dia 10 → start_month setembro; agosto não vence.
    const sm = firstOccurrenceMonthKey("2026-08-15", 10);
    const d = def("a", 10, "Faturamento", sm);
    expect(sm).toBe("2026-09");
    expect(countDuePending([d], new Set(), "2026-08-31")).toBe(0);
    // Já em setembro, no dia 10, passa a vencer normalmente.
    expect(countDuePending([d], new Set(), "2026-09-10")).toBe(1);
  });

  it("gera a partir do mês de criação quando o dia ainda não passou", () => {
    const sm = firstOccurrenceMonthKey("2026-08-05", 10);
    const d = def("a", 10, "Faturamento", sm);
    expect(sm).toBe("2026-08");
    expect(countDuePending([d], new Set(), "2026-08-05")).toBe(0); // dia 10 ainda não chegou
    expect(countDuePending([d], new Set(), "2026-08-10")).toBe(1); // no dia, vence
  });
});

// A tarefa pontual é criada a partir da data: day_of_month e start_month são
// derivados dela, como faz o Planner ao inserir a linha.
const pontual = (id: string, dueDate: string, title = id): RecurringTaskDef => ({
  id,
  title,
  description: null,
  day_of_month: Number(dueDate.slice(8, 10)),
  start_month: dueDate.slice(0, 7),
  kind: "pontual",
  due_date: dueDate,
});

describe("tarefa pontual (data única, sem repetição)", () => {
  const p = pontual("p", "2026-09-14", "Encomendar salgados");

  it("é distinguível da rotina", () => {
    expect(isPontual(p)).toBe(true);
    expect(isPontual(def("a", 14))).toBe(false);
  });

  it("ocorre só no mês/dia da sua data", () => {
    expect(occurrenceDateInMonth(p, 2026, 8)).toBe("2026-09-14"); // setembro
    expect(occursInMonth(p, "2026-09")).toBe(true);
    for (const [y, m0] of [
      [2026, 7],
      [2026, 9],
      [2026, 11],
      [2027, 8],
    ] as const) {
      expect(occurrenceDateInMonth(p, y, m0)).toBeNull();
    }
    expect(occursInMonth(p, "2026-08")).toBe(false);
    expect(occursInMonth(p, "2026-10")).toBe(false);
  });

  it("vence no dia e conta como pendente até ser cumprida", () => {
    expect(countDuePending([p], new Set(), "2026-09-13")).toBe(0);
    const due = dueOccurrences([p], new Set(), "2026-09-14");
    expect(due).toEqual([{ def: p, date: "2026-09-14", monthKey: "2026-09" }]);
    expect(
      occurrenceStatus("2026-09-14", new Set().has(completedKey(p.id, "2026-09")), "2026-09-14"),
    ).toBe("vencida");
  });

  it("marcada como cumprida, sai do pendente e não volta em nenhum mês", () => {
    const completed = new Set([completedKey(p.id, "2026-09")]);
    expect(countDuePending([p], completed, "2026-09-14")).toBe(0);
    expect(occurrenceStatus("2026-09-14", true, "2026-09-20")).toBe("cumprida");
    // Meses seguintes: nada, cumprida ou não.
    expect(countDuePending([p], completed, "2026-10-14")).toBe(0);
    expect(countDuePending([p], new Set(), "2026-10-14")).toBe(0);
    expect(countDuePending([p], new Set(), "2027-09-14")).toBe(0);
  });

  it("convive com rotinas no mesmo mês, sem interferir nelas", () => {
    const r = def("r", 14, "Faturamento", "2026-01");
    const due = dueOccurrences([r, p], new Set(), "2026-09-14");
    expect(due.map((d) => d.def.id)).toEqual(["p", "r"]); // mesma data, título alfabético
    // Em outubro só a rotina reaparece.
    expect(dueOccurrences([r, p], new Set(), "2026-10-14").map((d) => d.def.id)).toEqual(["r"]);
  });

  it("pontual sem data não gera ocorrência", () => {
    const semData: RecurringTaskDef = { ...p, due_date: null };
    expect(occurrenceDateInMonth(semData, 2026, 8)).toBeNull();
    expect(countDuePending([semData], new Set(), "2026-09-14")).toBe(0);
  });
});
