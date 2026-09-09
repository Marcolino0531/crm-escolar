import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  abaInicialDiario,
  abasDiarioVisiveis,
  acoesPlanoAluno,
  podeAbrirDiario,
} from "@/lib/diario-acesso";
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

describe("botão Plano no modal do aluno — visualizar abre, editar salva", () => {
  it("só canView vê o botão Plano e abre o modal, mas sem Foto nem Salvar plano", () => {
    expect(acoesPlanoAluno({ canView: true, canEdit: false })).toEqual({
      mostrarBotaoPlano: true,
      mostrarBotaoFoto: false,
      planoEditavel: false,
      mostrarSalvarPlano: false,
    });
  });

  it("canEdit mantém o comportamento de hoje: Plano, Foto e Salvar plano, tudo editável", () => {
    expect(acoesPlanoAluno({ canView: true, canEdit: true })).toEqual({
      mostrarBotaoPlano: true,
      mostrarBotaoFoto: true,
      planoEditavel: true,
      mostrarSalvarPlano: true,
    });
  });

  it("StudentActionSheet usa a regra pura e passa canEdit ao PlanEditor", () => {
    const src = fonte("src/components/diario/StudentActionSheet.tsx");
    expect(src).toMatch(
      /acoesPlano\.mostrarBotaoPlano && \(\s*<button\s*onClick=\{\(\) => setEditingPlan\(true\)\}/,
    );
    expect(src).toMatch(
      /acoesPlano\.mostrarBotaoFoto && \(\s*<button\s*onClick=\{\(\) => setEditingPhoto\(true\)\}/,
    );
    expect(src).toMatch(/<PlanEditor[\s\S]*?canEdit=\{acoesPlano\.planoEditavel\}/);
    expect(fonte("src/routes/diario.tsx")).toContain("canView={acesso.operacional}");
  });

  it("PlanEditor sem canEdit: botão Salvar plano não renderiza e campos ficam só leitura", () => {
    const src = fonte("src/components/diario/PlanEditor.tsx");
    expect(src).toMatch(/\{canEdit && \(\s*<Button[\s\S]*?Salvar plano/);
    expect(src).toContain("disabled={!canEdit}");
    expect(src).toContain("readOnly={!canEdit}");
    expect(src).toContain(
      'if (!canEdit) throw new Error("Você não tem permissão para editar o plano.")',
    );
  });
});
