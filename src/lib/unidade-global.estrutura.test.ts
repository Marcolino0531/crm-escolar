import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Trava estrutural do seletor único: as telas padronizadas não podem voltar a
// ter escolha interna de colégio/unidade (estado próprio, opção "Todas as
// unidades" local ou unidade padrão fixa), porque foi justamente isso que
// deixou o topo em uma unidade e a tela em outra.
const TELAS = [
  "src/routes/conciliacao.tsx",
  "src/routes/documentos.tsx",
  "src/routes/matriculas.tsx",
  "src/routes/cobranca.tsx",
  "src/routes/rematricula-acompanhamento.tsx",
  "src/components/rematricula/MaterialPedagogicoSeries.tsx",
  "src/components/documentos/GerarTermoConfissao.tsx",
  "src/components/documentos/EnvioLoteDeclaracaoIR.tsx",
];

function fonte(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

describe("telas padronizadas pelo seletor global", () => {
  it.each(TELAS)("%s não tem estado próprio de unidade", (caminho) => {
    const src = fonte(caminho);
    expect(src).not.toMatch(/setUnidade|setSchoolId|setFiltroUnidade/);
    expect(src).not.toMatch(/UNIDADES\[0\]/);
  });

  it.each(TELAS)("%s não oferece um 'Todas as unidades' interno", (caminho) => {
    expect(fonte(caminho)).not.toMatch(/SelectItem value="todas">Todas as unidades/);
  });
});
