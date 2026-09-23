import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Trava estrutural do seletor único: as telas padronizadas não podem voltar a
// ter escolha interna de colégio/unidade (estado próprio, opção "Todas as
// unidades" local, unidade padrão fixa, abas/select iterando a lista de
// unidades ou unidade lida da URL), porque foi justamente isso que deixou o
// topo em uma unidade e a tela em outra. Regra permanente em
// .agents/skills/seletor-global-unidade-crm-escolar/SKILL.md.
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
  "src/components/documentos/ZapSignDocumentos.tsx",
  "src/components/NotificationsBell.tsx",
  "src/routes/cobranca-automatica.tsx",
  "src/routes/upload.tsx",
  "src/routes/fundos.tsx",
  "src/routes/agenda.tsx",
];

const DIR_COBRANCA = "src/components/cobranca";
const DIR_ROTAS = "src/routes";

// Rotas fora da trava (documentadas): telas públicas sem login (não existe
// seletor do topo) e arquivos de infraestrutura de rota.
const EXCECOES_ROTAS = new Set([
  "__root.tsx",
  "matricula.tsx", // pública: o responsável escolhe o colégio no formulário
  "rematricula.index.tsx", // pública (portal de rematrícula)
  "rematricula.$ano.tsx", // pública (campanha do ano)
  "rematricula_.verificar.tsx", // pública (link mágico)
  "rematricula_.$ano_.verificar.tsx", // pública (link mágico)
  "portal.tsx", // pública (Portal do Responsável)
  "portal-cantina.tsx", // pública (recarga da cantina)
  "professor.tsx", // login contextual do professor (sem seletor do topo)
]);

// Ações de escrita cujo destino é a unidade: precisam bloquear em "Todas as
// Unidades" com a mensagem padronizada, em vez de escolher de novo na tela.
const ACOES_UNIDADE_UNICA = [
  "src/components/documentos/DadosColegios.tsx",
  "src/routes/cobranca-automatica.tsx",
  "src/routes/upload.tsx",
  "src/routes/fundos.tsx",
  "src/routes/cobranca.tsx",
  "src/routes/agenda.tsx",
];

function fonte(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

function arquivosDe(dir: string): string[] {
  return readdirSync(new URL(`../../${dir}`, import.meta.url))
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .sort();
}

const COMPONENTES_COBRANCA = arquivosDe(DIR_COBRANCA).map((f) => `${DIR_COBRANCA}/${f}`);
const ROTAS_COBERTAS = arquivosDe(DIR_ROTAS)
  .filter((f) => !EXCECOES_ROTAS.has(f))
  .map((f) => `${DIR_ROTAS}/${f}`);

// Bloco `.map` sobre lista de unidades/colégios que renderiza TabsTrigger ou
// SelectItem (aba/select por unidade dentro da tela).
const MAP_UNIDADES =
  /\b(UNIDADES(?:_SPONTE)?|unidades|schools|escolas|colegios)\.map\([^)]*\)\s*=>\s*\(?\s*<(TabsTrigger|SelectItem)\b/;
// Unidade lida de parâmetro de URL (search da rota ou URLSearchParams).
const UNIDADE_NA_URL =
  /search\.unidade\b|searchParams\.get\(["']unidade["']\)|\bunidade\?: string;[^}]*\}\s*=>\s*\(\{[^}]*unidade: typeof s\.unidade/;

function verificaSemEscolhaInterna(caminho: string) {
  const src = fonte(caminho);
  expect(src, `${caminho}: estado próprio de unidade`).not.toMatch(
    /setUnidade\b|setSchoolId\b|setFiltroUnidade\b|setAbaUnidade\b/,
  );
  expect(src, `${caminho}: unidade padrão fixa`).not.toMatch(/UNIDADES(?:_SPONTE)?\[0\]/);
  expect(src, `${caminho}: 'Todas as unidades' interno`).not.toMatch(
    /SelectItem value="todas">Todas as unidades/,
  );
  expect(src, `${caminho}: Tabs/Select iterando unidades`).not.toMatch(MAP_UNIDADES);
  expect(src, `${caminho}: unidade vinda da URL`).not.toMatch(UNIDADE_NA_URL);
}

describe("telas padronizadas pelo seletor global", () => {
  it.each(TELAS)("%s não tem escolha interna de unidade", verificaSemEscolhaInterna);

  it.each(ACOES_UNIDADE_UNICA)("%s bloqueia a ação em Todas as Unidades", (caminho) => {
    expect(fonte(caminho)).toMatch(/<SelecioneUnidade acao=/);
  });

  it("o formulário de extrato não escolhe mais o colégio", () => {
    const src = fonte("src/routes/upload.tsx");
    expect(src).not.toMatch(/Colégio \(obrigatório\)/);
    expect(src).toMatch(/escolaAtivaId\(selected, schools\)/);
  });

  it("a nova reunião da Agenda grava a unidade do topo, sem select", () => {
    const src = fonte("src/routes/agenda.tsx");
    expect(src).not.toMatch(/setUnitId\b/);
    expect(src).not.toMatch(/<Select\b/);
    expect(src).toMatch(/escolaAtivaId\(selected, schools\)/);
  });

  it("o novo fundo grava o colégio do topo", () => {
    const src = fonte("src/routes/fundos.tsx");
    expect(src).not.toMatch(/selSchool/);
    expect(src).toMatch(/school_id: escolaId/);
  });
});

describe("Cobrança inteira segue o seletor do topo", () => {
  it("varre todos os componentes de src/components/cobranca", () => {
    expect(COMPONENTES_COBRANCA.length).toBeGreaterThan(0);
  });

  it.each(COMPONENTES_COBRANCA)("%s não tem escolha interna de unidade", verificaSemEscolhaInterna);

  it("a rota /cobranca não aceita unidade pela URL nem abas por unidade", () => {
    const src = fonte("src/routes/cobranca.tsx");
    expect(src).not.toMatch(/UNIDADES_SPONTE/);
    expect(src).not.toMatch(/unidade\?: string/);
    expect(src).toMatch(/useUnidadeAtiva\(\)/);
  });

  it("o sino troca o seletor global em vez de passar unidade na URL", () => {
    const src = fonte("src/components/NotificationsBell.tsx");
    expect(src).not.toMatch(/search=\{\{\s*unidade:/);
  });

  it("a Notificação Extrajudicial não tem exceção para caso de outra unidade", () => {
    expect(fonte("src/components/cobranca/NotificacaoExtrajudicial.tsx")).not.toMatch(
      /pode ser de outra unidade/,
    );
  });
});

describe("todas as rotas nascem cobertas", () => {
  it("as exceções documentadas existem de fato", () => {
    const existentes = new Set(arquivosDe(DIR_ROTAS));
    for (const e of EXCECOES_ROTAS) if (e !== "__root.tsx") expect(existentes.has(e), e).toBe(true);
  });

  it.each(ROTAS_COBERTAS)("%s não tem escolha interna de unidade", verificaSemEscolhaInterna);
});
