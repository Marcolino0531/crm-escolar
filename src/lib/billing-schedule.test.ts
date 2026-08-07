import { describe, it, expect } from "vitest";
import {
  calcularPascoa,
  isFeriadoNacional,
  isFimDeSemana,
  isDiaUtil,
  addDaysYMD,
  proximoDiaUtil,
  vencimentosParaEnvio,
} from "./billing-schedule";

describe("calcularPascoa", () => {
  it("calcula o domingo de Páscoa corretamente", () => {
    expect(calcularPascoa(2024)).toEqual({ mes: 3, dia: 31 });
    expect(calcularPascoa(2025)).toEqual({ mes: 4, dia: 20 });
    expect(calcularPascoa(2026)).toEqual({ mes: 4, dia: 5 });
  });
});

describe("isFeriadoNacional", () => {
  it("reconhece feriados fixos", () => {
    expect(isFeriadoNacional("2026-01-01")).toBe(true); // Confraternização
    expect(isFeriadoNacional("2026-09-07")).toBe(true); // Independência
    expect(isFeriadoNacional("2026-12-25")).toBe(true); // Natal
  });

  it("reconhece feriados móveis derivados da Páscoa", () => {
    expect(isFeriadoNacional("2025-04-18")).toBe(true); // Sexta-feira Santa 2025
    expect(isFeriadoNacional("2025-06-19")).toBe(true); // Corpus Christi 2025
    expect(isFeriadoNacional("2026-02-17")).toBe(true); // Carnaval (terça) 2026
  });

  it("Consciência Negra (20/11) só é nacional a partir de 2024", () => {
    expect(isFeriadoNacional("2023-11-20")).toBe(false);
    expect(isFeriadoNacional("2024-11-20")).toBe(true);
  });

  it("dias comuns não são feriado", () => {
    expect(isFeriadoNacional("2026-08-10")).toBe(false);
  });
});

describe("isFimDeSemana / isDiaUtil", () => {
  it("identifica sábado e domingo", () => {
    expect(isFimDeSemana("2026-08-08")).toBe(true); // sábado
    expect(isFimDeSemana("2026-08-09")).toBe(true); // domingo
    expect(isFimDeSemana("2026-08-10")).toBe(false); // segunda
  });

  it("dia útil exclui fim de semana e feriado", () => {
    expect(isDiaUtil("2026-08-10")).toBe(true); // segunda comum
    expect(isDiaUtil("2026-08-08")).toBe(false); // sábado
    expect(isDiaUtil("2026-09-07")).toBe(false); // feriado (Independência)
  });
});

describe("addDaysYMD", () => {
  it("desloca dias com virada de mês/ano", () => {
    expect(addDaysYMD("2026-08-10", -2)).toBe("2026-08-08");
    expect(addDaysYMD("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysYMD("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("proximoDiaUtil", () => {
  it("mantém o dia se já for útil", () => {
    expect(proximoDiaUtil("2026-08-10")).toBe("2026-08-10");
  });
  it("pula sábado/domingo para segunda", () => {
    expect(proximoDiaUtil("2026-08-08")).toBe("2026-08-10"); // sáb → seg
    expect(proximoDiaUtil("2026-08-09")).toBe("2026-08-10"); // dom → seg
  });
  it("pula feriado que cai em dia útil", () => {
    // 07/09/2026 é segunda-feira (Independência) → próximo útil é terça 08/09.
    expect(proximoDiaUtil("2026-09-07")).toBe("2026-09-08");
  });
});

describe("vencimentosParaEnvio (reagendamento sem duplicidade)", () => {
  it("não dispara nada aos sábados e domingos", () => {
    expect(vencimentosParaEnvio("2026-08-08")).toEqual([]); // sábado
    expect(vencimentosParaEnvio("2026-08-09")).toEqual([]); // domingo
  });

  it("não dispara nada em feriado nacional", () => {
    expect(vencimentosParaEnvio("2026-09-07")).toEqual([]); // Independência (segunda)
  });

  it("num dia útil comum, dispara só o vencimento de D-2", () => {
    // Quarta 12/08: terça (11) é dia útil, então só o gatilho de hoje conta.
    const r = vencimentosParaEnvio("2026-08-12");
    expect(r).toEqual([{ gatilho: "2026-08-12", vencimento: "2026-08-10" }]);
  });

  it("na segunda, consolida os gatilhos de sáb/dom reagendados (venc. de sáb cai na segunda)", () => {
    // Segunda 10/08 recolhe os gatilhos [seg 10, dom 09, sáb 08].
    // Vencimentos (gatilho-2): 08 (sáb), 07 (sex), 06 (qui).
    const r = vencimentosParaEnvio("2026-08-10");
    expect(r).toEqual([
      { gatilho: "2026-08-10", vencimento: "2026-08-08" },
      { gatilho: "2026-08-09", vencimento: "2026-08-07" },
      { gatilho: "2026-08-08", vencimento: "2026-08-06" },
    ]);
    // Um vencimento de sábado (08) cujo gatilho seria 10 (seg) é enviado na segunda.
    expect(r.some((t) => t.vencimento === "2026-08-08")).toBe(true);
  });

  it("dia útil após feriado recolhe o feriado e o fim de semana anteriores a ele", () => {
    // 08/09/2026 é terça; 07/09 (seg) é feriado, precedido por dom 06 e sáb 05.
    // Todos são dias não úteis contíguos antes de terça, então rolam para cá.
    const r = vencimentosParaEnvio("2026-09-08");
    expect(r).toEqual([
      { gatilho: "2026-09-08", vencimento: "2026-09-06" },
      { gatilho: "2026-09-07", vencimento: "2026-09-05" },
      { gatilho: "2026-09-06", vencimento: "2026-09-04" },
      { gatilho: "2026-09-05", vencimento: "2026-09-03" },
    ]);
  });

  it("não gera vencimentos duplicados ao consolidar", () => {
    const r = vencimentosParaEnvio("2026-08-10");
    const vencs = r.map((t) => t.vencimento);
    expect(new Set(vencs).size).toBe(vencs.length);
  });
});
