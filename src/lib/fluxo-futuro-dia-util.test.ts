import { describe, expect, it } from "vitest";
import {
  enesimoDiaUtil,
  isDiaUtilDespesa,
  proximoDiaUtilDespesa,
  vencimentoRecorrente,
} from "./fluxo-futuro-dia-util";

// Calendário de referência (2026): 03/10 sábado, 04/10 domingo, 05/10 segunda;
// 12/10 (N. Sra. Aparecida) segunda; 02/11 (Finados) segunda; 15/11 domingo;
// 08/12 (Imaculada Conceição, BH) terça; 25/12 sexta.

describe("isDiaUtilDespesa", () => {
  it("fim de semana e feriado nacional não são dia útil", () => {
    expect(isDiaUtilDespesa("2026-10-03")).toBe(false); // sábado
    expect(isDiaUtilDespesa("2026-10-04")).toBe(false); // domingo
    expect(isDiaUtilDespesa("2026-10-12")).toBe(false); // N. Sra. Aparecida
    expect(isDiaUtilDespesa("2026-11-02")).toBe(false); // Finados
    expect(isDiaUtilDespesa("2026-10-05")).toBe(true);
  });

  it("feriado municipal de Belo Horizonte também não é dia útil", () => {
    expect(isDiaUtilDespesa("2026-12-08")).toBe(false); // Imaculada Conceição (terça)
    expect(isDiaUtilDespesa("2026-08-15")).toBe(false); // Assunção
    expect(isDiaUtilDespesa("2026-12-09")).toBe(true);
  });
});

describe("proximoDiaUtilDespesa", () => {
  it("mantém dia útil", () => {
    expect(proximoDiaUtilDespesa("2026-10-05")).toBe("2026-10-05");
  });
  it("sábado e domingo vão para segunda", () => {
    expect(proximoDiaUtilDespesa("2026-10-03")).toBe("2026-10-05");
    expect(proximoDiaUtilDespesa("2026-10-04")).toBe("2026-10-05");
  });
  it("feriado na segunda vai para terça; sábado antes de feriado pula os dois", () => {
    expect(proximoDiaUtilDespesa("2026-10-12")).toBe("2026-10-13");
    expect(proximoDiaUtilDespesa("2026-10-10")).toBe("2026-10-13"); // sáb → dom → feriado → ter
  });
  it("feriado municipal de BH empurra para o dia seguinte", () => {
    expect(proximoDiaUtilDespesa("2026-12-08")).toBe("2026-12-09");
  });
});

describe("enesimoDiaUtil (5º dia útil do Salário)", () => {
  it("outubro/2026: 1 qui, 2 sex, (3 sáb, 4 dom), 5 seg, 6 ter, 7 qua → 07/10", () => {
    expect(enesimoDiaUtil("2026-10-01", 5)).toBe("2026-10-07");
  });
  it("novembro/2026: (1 dom), 2 Finados, 3 ter, 4 qua, 5 qui, 6 sex, (7/8), 9 seg → 09/11", () => {
    expect(enesimoDiaUtil("2026-11-01", 5)).toBe("2026-11-09");
  });
  it("dezembro/2026: 1 ter, 2 qua, 3 qui, 4 sex, (5/6), 7 seg → 07/12", () => {
    expect(enesimoDiaUtil("2026-12-01", 5)).toBe("2026-12-07");
  });
  it("janeiro/2027: (1 feriado, 2 sáb, 3 dom), 4, 5, 6, 7, 8 → 08/01", () => {
    expect(enesimoDiaUtil("2027-01-01", 5)).toBe("2027-01-08");
  });
  it("1º dia útil de janeiro/2027 é 04/01", () => {
    expect(enesimoDiaUtil("2027-01-01", 1)).toBe("2027-01-04");
  });
});

describe("vencimentoRecorrente", () => {
  it("antes de outubro/2026 não ajusta (setembro fica como está)", () => {
    expect(vencimentoRecorrente("2026-09-01", 5, "Salário")).toBe("2026-09-05"); // sábado
    expect(vencimentoRecorrente("2026-09-01", 20, "Aluguel")).toBe("2026-09-20"); // domingo
  });
  it("a partir de outubro/2026 move para o próximo dia útil", () => {
    expect(vencimentoRecorrente("2026-10-01", 10, "Aluguel")).toBe("2026-10-13"); // sáb + feriado
    expect(vencimentoRecorrente("2026-10-01", 15, "Cemig")).toBe("2026-10-15"); // quinta
  });
  it("Salário usa o 5º dia útil, ignorando o dia fixo cadastrado", () => {
    expect(vencimentoRecorrente("2026-10-01", 5, "Salário")).toBe("2026-10-07");
    expect(vencimentoRecorrente("2026-11-01", 5, "SALARIO")).toBe("2026-11-09");
    expect(vencimentoRecorrente("2026-10-01", 5, "Salário extra")).toBe("2026-10-05"); // não é "Salário"
  });
  it("dia fixo maior que o mês cai no último dia e então ajusta", () => {
    expect(vencimentoRecorrente("2027-02-01", 31, "Copasa")).toBe("2027-03-01"); // 28/02/2027 domingo
  });
});
