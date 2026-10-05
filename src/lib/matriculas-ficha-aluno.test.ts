import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Travas estruturais da ficha do aluno: a server function é só leitura e
// repete os controles de acesso da ficha da matrícula.
const fonte = readFileSync("src/lib/matriculas.functions.ts", "utf8");
const inicio = fonte.indexOf("export const fichaAlunoMatricula");
const corpo = fonte.slice(inicio, fonte.indexOf("\n  });\n", inicio));

describe("fichaAlunoMatricula", () => {
  it("existe e exige login, Visualizar no e-Formulário e acesso à unidade", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(corpo).toContain(".middleware([requireSupabaseAuth])");
    expect(corpo).toContain("await assertCanViewAdmissoes(context.userId)");
    expect(corpo).toContain("allowedSponteUnidades(context.userId)");
    expect(corpo).toContain('throw new Error("Você não tem acesso a esta unidade.")');
  });

  it("só lê: nenhuma escrita no banco, no storage ou no Sponte, e nenhum log", () => {
    for (const proibido of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".remove(",
      ".rpc(",
      "callSponte",
      "console.",
    ])
      expect(corpo).not.toContain(proibido);
  });

  it("abre a ficha do formulário do mesmo aluno e ano antes de montar outra", () => {
    const formulario = corpo.indexOf('.from("enrollment_submissions" as never)');
    expect(formulario).toBeGreaterThan(0);
    expect(corpo.slice(formulario, formulario + 400)).toMatch(
      /\.eq\("sponte_aluno_id", sponteAlunoId\)\s*\.eq\("ano_letivo", anoLetivo\)/,
    );
    expect(corpo.indexOf("return { ok: true, submissaoId")).toBeLessThan(
      corpo.indexOf("buscarAlunoPorId("),
    );
  });

  it("rotina e saúde só da rematrícula daquele ano, sem cair em outro ano", () => {
    expect(corpo).toContain("submissionIdRematricula(unidade, alunoId, anoLetivo)");
    for (const tabela of ["student_routine", "matricula_saude"]) {
      const i = corpo.indexOf(`.from("${tabela}" as never)`);
      expect(corpo.slice(i, i + 200)).toContain('.eq("submission_id", idRematricula)');
    }
    expect(corpo).toContain("saudeFormDaLinha(");
    expect(corpo).not.toContain("saudeMaisRecente");
  });

  it("origem: Rematrícula <ano> ou Cadastro manual no Sponte", () => {
    expect(corpo).toContain("`Rematrícula ${anoLetivo}`");
    expect(corpo).toContain('"Cadastro manual no Sponte"');
  });
});
