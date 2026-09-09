import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abaInicialDiario, abasDiarioVisiveis, podeAbrirDiario } from "@/lib/diario-acesso";
import { APP_MODULES, MODULE_LABELS } from "@/lib/app-context";

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

  it("só 'diario_financeiro' vê Auditoria Sponte, Tabela de Preços e Faturamento", () => {
    const a = { operacional: false, financeiro: true };
    expect(podeAbrirDiario(a)).toBe(true);
    expect(abasDiarioVisiveis(a)).toEqual(["auditoria", "precos", "faturamento"]);
    expect(abaInicialDiario(a)).toBe("auditoria");
  });

  it("os dois módulos veem tudo; nenhum não abre a página", () => {
    expect(abasDiarioVisiveis({ operacional: true, financeiro: true })).toEqual([
      "registro",
      "extras",
      "auditoria",
      "precos",
      "faturamento",
    ]);
    const nenhum = { operacional: false, financeiro: false };
    expect(podeAbrirDiario(nenhum)).toBe(false);
    expect(abasDiarioVisiveis(nenhum)).toEqual([]);
    expect(abaInicialDiario(nenhum)).toBeNull();
  });

  it("diario_financeiro está cadastrado como módulo, com rótulo e no enum do banco", () => {
    expect(APP_MODULES).toContain("diario_financeiro");
    expect(MODULE_LABELS.diario_financeiro).toMatch(/^Diário do Aluno/);
    expect(fonte("src/lib/admin-users.functions.ts")).toMatch(/"diario_financeiro"/);
    expect(fonte("supabase/migrations/20261019090000_diario_financeiro_module_enum.sql")).toMatch(
      /ADD VALUE IF NOT EXISTS 'diario_financeiro'/,
    );
  });

  it("a página guarda por qualquer dos dois módulos e as abas por módulo (estrutural)", () => {
    const src = fonte("src/routes/diario.tsx");
    expect(src).toMatch(
      /podeAbrirDiario\(\{ operacional: canView\("diario"\), financeiro: canView\("diario_financeiro"\) \}\)/,
    );
    expect(src).toMatch(/podeEditarFinanceiro = canEdit\("diario_financeiro"\)/);
    // Componentes financeiros recebem a permissão financeira, não a operacional.
    expect(src).toMatch(/<AuditoriaSponte[\s\S]*?podeExecutar=\{podeEditarFinanceiro\}/);
    expect(src).toMatch(/<TabelaPrecos[\s\S]*?podeEditar=\{podeEditarFinanceiro\}/);
    expect(src).toMatch(/<FaturamentoExtras[\s\S]*?podeEditar=\{podeEditarFinanceiro\}/);
    // O menu lateral mostra o Diário com qualquer dos dois módulos.
    expect(fonte("src/routes/__root.tsx")).toMatch(
      /canView\("diario"\) \|\| canView\("diario_financeiro"\)/,
    );
  });

  it("server functions financeiras exigem 'diario_financeiro'; operacionais seguem em 'diario'", () => {
    for (const f of [
      "src/lib/diario-faturamento.functions.ts",
      "src/lib/diario-precos.functions.ts",
      "src/lib/diario-auditoria.functions.ts",
    ]) {
      const src = fonte(f);
      expect(src).toMatch(/_module: "diario_financeiro"/);
      expect(src).not.toMatch(/_module: "diario" /);
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
  it("MODULE_LABELS usa os nomes novos", () => {
    expect(MODULE_LABELS.colonia).toBe("Colônia de Férias — Registros");
    expect(MODULE_LABELS.colonia_financeiro).toBe("Colônia de Férias — Fechamento Financeiro");
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
