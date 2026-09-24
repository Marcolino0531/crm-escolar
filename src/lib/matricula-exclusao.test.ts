import { describe, expect, it } from "vitest";
import { existeAlgoNoSponte, resumirIntegracao, rotuloCobrancas } from "./matricula-exclusao";

describe("resumirIntegracao", () => {
  it("nada criado no Sponte → confirmação simples", () => {
    const s = resumirIntegracao({
      sponteAlunoId: null,
      turmaStatus: null,
      turmaNome: null,
      lancamentos: [],
    });
    expect(existeAlgoNoSponte(s)).toBe(false);
    expect(rotuloCobrancas(s.cobrancasLancadas)).toBe("nenhuma");
  });

  it("aluno criado, turma matriculada e só cobranças 'lancado' contam", () => {
    const s = resumirIntegracao({
      sponteAlunoId: 707,
      turmaStatus: "matriculado",
      turmaNome: "04 - Maternal 3 M",
      lancamentos: [
        { tipo: "material", status: "lancado" },
        { tipo: "mensalidade", status: "lancado" },
        { tipo: "matricula", status: "erro" },
        { tipo: "alimentacao", status: "pendente" },
      ],
    });
    expect(existeAlgoNoSponte(s)).toBe(true);
    expect(s.turmaNome).toBe("04 - Maternal 3 M");
    expect(s.cobrancasLancadas).toEqual(["mensalidade", "material"]);
    expect(rotuloCobrancas(s.cobrancasLancadas)).toBe("Mensalidade, Material pedagógico");
  });

  it("turma sem_turma não conta como matriculada, mas aluno criado exige ciência", () => {
    const s = resumirIntegracao({
      sponteAlunoId: 706,
      turmaStatus: "sem_turma",
      turmaNome: null,
      lancamentos: [],
    });
    expect(s.turmaMatriculada).toBe(false);
    expect(existeAlgoNoSponte(s)).toBe(true);
  });
});
