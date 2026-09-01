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
  "src/components/documentos/DadosColegios.tsx",
  "src/routes/cobranca-automatica.tsx",
  "src/routes/upload.tsx",
  "src/routes/fundos.tsx",
];

// Ações de escrita cujo destino é a unidade: precisam bloquear em "Todas as
// Unidades" com a mensagem padronizada, em vez de escolher de novo na tela.
const ACOES_UNIDADE_UNICA = [
  "src/components/documentos/DadosColegios.tsx",
  "src/routes/cobranca-automatica.tsx",
  "src/routes/upload.tsx",
  "src/routes/fundos.tsx",
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

  it.each(ACOES_UNIDADE_UNICA)("%s bloqueia a ação em Todas as Unidades", (caminho) => {
    expect(fonte(caminho)).toMatch(/<SelecioneUnidade acao=/);
  });

  it("o formulário de extrato não escolhe mais o colégio", () => {
    const src = fonte("src/routes/upload.tsx");
    expect(src).not.toMatch(/Colégio \(obrigatório\)/);
    expect(src).toMatch(/escolaAtivaId\(selected, schools\)/);
  });

  it("o novo fundo grava o colégio do topo", () => {
    const src = fonte("src/routes/fundos.tsx");
    expect(src).not.toMatch(/selSchool/);
    expect(src).toMatch(/school_id: escolaId/);
  });
});
