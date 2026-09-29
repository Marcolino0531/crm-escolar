import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  abaInicialDiario,
  abasDiarioVisiveis,
  acoesPlanoAluno,
  podeAbrirDiario,
} from "@/lib/diario-acesso";
import { MODULE_LABELS } from "@/lib/app-context";
import { noPorChave } from "@/lib/permissoes-arvore";

function fonte(caminho: string): string {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

describe("Diário do Aluno — dois módulos de acesso (padrão da Colônia)", () => {
  it("só 'diario' vê Registro e Consumos Extras, não as abas financeiras", () => {
    const a = { operacional: true, financeiro: false };
    expect(podeAbrirDiario(a)).toBe(true);
    expect(abasDiarioVisiveis(a)).toEqual(["registro", "extras"]);
    expect(abaInicialDiario(a)).toBe("registro");
  });

  it("só 'diario_financeiro' vê Auditoria Sponte e Faturamento", () => {
    const a = { operacional: false, financeiro: true };
    expect(podeAbrirDiario(a)).toBe(true);
    expect(abasDiarioVisiveis(a)).toEqual(["auditoria", "faturamento"]);
    expect(abaInicialDiario(a)).toBe("auditoria");
  });

  it("os dois módulos veem tudo; nenhum não abre a página", () => {
    expect(abasDiarioVisiveis({ operacional: true, financeiro: true })).toEqual([
      "registro",
      "extras",
      "auditoria",
      "faturamento",
    ]);
    const nenhum = { operacional: false, financeiro: false };
    expect(podeAbrirDiario(nenhum)).toBe(false);
    expect(abasDiarioVisiveis(nenhum)).toEqual([]);
    expect(abaInicialDiario(nenhum)).toBeNull();
  });

  it("as páginas do Diário estão na árvore canônica, com o legado mapeado", () => {
    expect(noPorChave("diario.registro")?.legado?.ver.flat()).toContain("diario");
    expect(noPorChave("diario.faturamento")?.legado?.ver.flat()).toContain("diario_financeiro");
    expect(noPorChave("diario.auditoria")?.legado?.ver.flat()).toContain("diario_financeiro");
    expect(MODULE_LABELS["diario.faturamento"]).toBe("Faturamento");
    expect(fonte("supabase/migrations/20261019090000_diario_financeiro_module_enum.sql")).toMatch(
      /ADD VALUE IF NOT EXISTS 'diario_financeiro'/,
    );
  });

  it("a página guarda pelo módulo e as abas pela chave da página (estrutural)", () => {
    const src = fonte("src/routes/diario.tsx");
    expect(src).toMatch(/canView\("diario"\)/);
    expect(src).toMatch(/canEdit\("diario.registro"\)/);
    expect(src).toMatch(/<AuditoriaSponte[\s\S]*?podeExecutar=\{canEdit\("diario.auditoria"\)\}/);
    expect(src).not.toMatch(/<TabelaPrecos/);
    expect(fonte("src/components/configuracoes/CadastrosGerais.tsx")).toMatch(
      /<TabelaPrecos[\s\S]*?podeEditar=\{canEdit\(chaveCadastro\("diario"\)\)\}/,
    );
    expect(src).toMatch(/<FaturamentoExtras[\s\S]*?podeEditar=\{canEdit\("diario.faturamento"\)\}/);
  });

  it("server functions financeiras exigem a página financeira; operacionais não", () => {
    const esperado: Record<string, string> = {
      "src/lib/diario-faturamento.functions.ts": "diario.faturamento",
      "src/lib/diario-precos.functions.ts": "configuracoes.cadastros.valor_diario",
      "src/lib/diario-auditoria.functions.ts": "diario.auditoria",
    };
    for (const [f, chave] of Object.entries(esperado)) {
      const src = fonte(f);
      expect(src).toContain(`"${chave}"`);
      expect(src).not.toMatch(/can_(view|edit)_module/);
    }
  });
});

describe("Isentar só a partir da aba Faturamento", () => {
  it("Consumos Extras não tem mais o botão Isentar, mas continua mostrando o status Isento", () => {
    const src = fonte("src/routes/diario.tsx");
    expect(src).not.toMatch(/Isentar/);
    expect(src).not.toMatch(/isentarEventoDiario/);
    expect(src).toMatch(/ROTULO_STATUS_CONSUMO/);
    expect(src).toMatch(/isento_motivo/);
  });

  it("FaturamentoExtras dispara a isenção por evento, com motivo obrigatório", () => {
    const src = fonte("src/components/diario/FaturamentoExtras.tsx");
    expect(src).toMatch(/isentarEventoDiario/);
    expect(src).toMatch(/p\.eventos\.map/);
    expect(src).toMatch(/\{podeEditar && \([\s\S]*?Isentar/);
    expect(src).toMatch(/motivo\.trim\(\)\.length < 3/);
  });
});

describe("Rótulos da Colônia de Férias", () => {
  it("a árvore usa os nomes das abas", () => {
    expect(MODULE_LABELS["colonia.registro"]).toBe("Registrar Consumos");
    expect(MODULE_LABELS["colonia.fechamento"]).toBe("Fechamento Semanal");
  });

  it("nenhum consumidor mantém o texto antigo fixo", () => {
    for (const f of [
      "src/lib/app-context.tsx",
      "src/routes/configuracoes.tsx",
      "src/routes/colonia.tsx",
      "src/routes/__root.tsx",
    ]) {
      const src = fonte(f);
      expect(src).not.toMatch(/Colônia — Registros \(Operacional\)/);
      expect(src).not.toMatch(/Colônia — Fechamento Financeiro/);
    }
  });
});
