import { describe, it, expect } from "vitest";
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { Legend, Line } from "recharts";
// @ts-expect-error módulo interno do Recharts, sem tipos publicados
import { findAllByType as findAllByTypeRaw } from "recharts/lib/util/ReactUtils";
import { seriePatrimonioPorFundo } from "./fundos";

const findAllByType = findAllByTypeRaw as (children: ReactNode, type: unknown) => ReactNode[];
const LineC = Line as unknown as ComponentType<{ dataKey: string }>;
const LegendC = Legend as unknown as ComponentType;

/**
 * Regressão do gráfico "Evolução do Patrimônio" do Dashboard: o Recharts descobre
 * as séries com findAllByType(children, Line). Com React 19 o react-is 18 não
 * reconhece Fragment, então <Line> dentro de <>…</> fica invisível (sem linha,
 * sem eixo Y). As linhas precisam ser filhas diretas do <LineChart>.
 */
const fundos = [
  { id: "2401c98f-625a-4d7a-98a0-90729cbf2dda", name: "EXPERTISE" },
  { id: "15874848-5803-464e-aeb7-5ef358f7a12c", name: "PLENO DI" },
];
const linhas = fundos.map((f) => createElement(LineC, { key: f.id, dataKey: f.id }));

describe("Evolução do Patrimônio — descoberta das séries pelo Recharts", () => {
  it("Line dentro de Fragment não é enxergada (causa do gráfico vazio)", () => {
    const filhos = [createElement(Fragment, null, createElement(LegendC), ...linhas)];
    expect(findAllByType(filhos, Line)).toHaveLength(0);
  });

  it("Legend + Lines como filhos diretos são todas encontradas", () => {
    const filhos = [createElement(LegendC), ...linhas];
    expect(findAllByType(filhos, Line)).toHaveLength(2);
  });

  it("dataKey (id do fundo) bate com as chaves numéricas de cada ponto da série", () => {
    const pontos = seriePatrimonioPorFundo(
      [
        { fund_id: fundos[0].id, competencia: "2026-01-01", valor_liquido: "421718.79" as never },
        { fund_id: fundos[1].id, competencia: "2026-01-01", valor_liquido: "692604.92" as never },
      ],
      fundos,
      (f) => f.id,
    );
    expect(pontos).toHaveLength(1);
    for (const f of fundos) {
      expect(typeof pontos[0][f.id]).toBe("number");
      expect(Number.isFinite(pontos[0][f.id])).toBe(true);
    }
    expect(pontos[0][fundos[0].id]).toBe(421718.79);
    expect(pontos[0][fundos[1].id]).toBe(692604.92);
  });
});
