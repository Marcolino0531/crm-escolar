import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIA_INICIO_AVISO_EXTRAS,
  avisoExtrasPendentes,
  nomeMesSeguinte,
} from "./diario-aviso-faturamento";

const fonte = (p: string) => readFileSync(p, "utf8");

describe("aviso único do sino: Extras do Diário pendentes de faturar (dia 25+)", () => {
  const dia24 = new Date(2026, 8, 24, 10);
  const dia25 = new Date(2026, 8, 25, 10);
  const dia30 = new Date(2026, 8, 30, 23);

  it("dia 24 com pendências → não aparece", () => {
    expect(DIA_INICIO_AVISO_EXTRAS).toBe(25);
    expect(avisoExtrasPendentes(dia24, 3, ["CEC"])).toBeNull();
  });

  it("dia 25 com pendências → aparece, citando o boleto do mês seguinte", () => {
    const aviso = avisoExtrasPendentes(dia25, 2, ["CEC", "CEC Baby"]);
    expect(aviso).not.toBeNull();
    expect(aviso?.titulo).toBe("Extras do Diário do Aluno pendentes de faturar");
    expect(aviso?.descricao).toBe(
      "Lance até o fim do mês para entrarem no boleto de outubro (CEC, CEC Baby).",
    );
    expect(avisoExtrasPendentes(dia30, 1)).not.toBeNull();
  });

  it("dia 25 sem nenhuma pendência → não aparece", () => {
    expect(avisoExtrasPendentes(dia25, 0)).toBeNull();
  });

  it("dia 25 com pendências já faturadas → some sozinho (contagem volta a zero)", () => {
    expect(avisoExtrasPendentes(dia25, 1, ["CEC"])).not.toBeNull();
    // Depois de faturar, a consulta (que exclui faturamento_id preenchido) devolve vazio.
    expect(avisoExtrasPendentes(dia25, 0, [])).toBeNull();
  });

  it("vira o mês: dia 1º do mês seguinte não aparece; dezembro aponta janeiro", () => {
    expect(avisoExtrasPendentes(new Date(2026, 9, 1), 5)).toBeNull();
    expect(nomeMesSeguinte(new Date(2026, 11, 26))).toBe("janeiro");
  });

  it("servidor: pendência segue a mesma regra da aba Faturamento (não faturado, não isento)", () => {
    const src = fonte("src/lib/diario-faturamento.functions.ts");
    expect(src).toMatch(
      /unidadesComExtrasPendentes[\s\S]*?eventosPendentes\(\[\.\.\.alunos\.keys\(\)\]\)/,
    );
    expect(src).toMatch(
      /async function eventosPendentes[\s\S]*?\.eq\("isento", false\)[\s\S]*?\.is\("faturamento_id", null\)/,
    );
  });

  it("sino: bloco por consumo removido; aviso único leva à aba Faturamento", () => {
    const src = fonte("src/components/NotificationsBell.tsx");
    expect(src).not.toContain("diario_extra_today");
    // Guard do sino usa só variáveis declaradas (ReferenceError derruba a página toda).
    expect(src).not.toMatch(/\bcanDiario\b/);
    expect(src).toMatch(/!canCartao &&\s*!canDiarioFin &&/);
    expect(src).not.toContain("cobrança extra gerada para a família");
    expect(src).toMatch(
      /\{avisoExtras && \([\s\S]*?to="\/diario"\s*search=\{\{ aba: "faturamento" \}\}/,
    );
    expect(fonte("src/routes/diario.tsx")).toContain("validateSearch");
  });
});
