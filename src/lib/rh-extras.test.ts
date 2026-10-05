import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chaveNomeExtra, nomeExtraDuplicado } from "./rh-extras";
import { noPorChave } from "./permissoes-arvore";

const fonte = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Extras: nome único entre os ativos do colégio", () => {
  it("compara sem diferenciar maiúsculas, acentos e espaços extras", () => {
    expect(chaveNomeExtra("  JOSÉ   da Silva ")).toBe("jose da silva");
    const extras = [
      { id: "1", nomeCompleto: "José da Silva", ativo: true },
      { id: "2", nomeCompleto: "Ana Exemplo", ativo: false },
    ];
    expect(nomeExtraDuplicado(extras, "JOSE DA SILVA")).toBe(true);
    expect(nomeExtraDuplicado(extras, "José da Silva", "1")).toBe(false);
    expect(nomeExtraDuplicado(extras, "ana exemplo")).toBe(false);
  });
});

describe("Extras: permissão e acesso", () => {
  it("página rh.pessoal.extras na árvore, sem cópia de acesso (só admin)", () => {
    const no = noPorChave("rh.pessoal.extras");
    expect(no?.nome).toBe("Extras");
    expect(no?.legado).toBeUndefined();
  });

  it("migration: enum, RLS ativo e acesso só por service_role, sem policies", () => {
    const sql = fonte("supabase/migrations/20261201090000_rh_extras_valores_permissoes_arvore.sql");
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'rh\.pessoal\.extras'/);
    for (const t of ["rh_extras", "rh_pagamentos_valores"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM anon, authenticated;`);
      expect(sql).toContain(`GRANT ALL ON public.${t} TO service_role;`);
    }
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toMatch(/UNIQUE \(tipo, pessoa_id, competencia\)/);
    expect(sql).toMatch(/CHECK \(valor >= 0\)/);
    expect(sql).not.toMatch(/funcionarios_salarios/);
  });

  it("server functions conferem permissão da página e unidade", () => {
    const extras = fonte("src/lib/rh-extras.functions.ts");
    expect(extras).toMatch(/\["rh\.pessoal\.extras"\]/);
    expect(extras.match(/exigirPermissaoExtras\(context\.userId/g)).toHaveLength(4);
    expect(extras.match(/exigirUnidadeFolha\(context\.userId/g)).toHaveLength(4);
    const valores = fonte("src/lib/rh-salario.functions.ts");
    for (const fn of ["listarValoresMensais", "salvarValorMensal", "excluirValorMensal"]) {
      const corpo = valores.slice(valores.indexOf(`export const ${fn}`));
      const ate = corpo.indexOf("export const", 10);
      const trecho = ate > 0 ? corpo.slice(0, ate) : corpo;
      expect(trecho, fn).toMatch(/exigirPermissaoSalario\(context\.userId/);
      expect(trecho, fn).toMatch(/exigirUnidadeFolha\(context\.userId/);
      expect(trecho, fn).not.toMatch(/funcionarios_salarios|valor_turno|faltas|grade/);
    }
  });
});
