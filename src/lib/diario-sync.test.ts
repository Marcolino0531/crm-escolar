import { describe, expect, it } from "vitest";
import {
  alunosVigentesDoAno,
  contarTurmasCorrigidas,
  planejarSincronizacaoAno,
  turmaMaisRecente,
  turmasDoAno,
  unidadeDestinoDiario,
  type ContratoSponte,
  type VinculoAno,
} from "./diario-sync";

const contrato = (p: Partial<ContratoSponte>): ContratoSponte => ({
  alunoId: "1",
  nome: "Aluno",
  turma: "01 - Turma",
  contratoId: "10",
  situacao: "Vigente",
  ...p,
});

// Espelha uma sincronização completa: GetMatriculas do ano → vínculos do ano.
function sincronizar(
  ano: number,
  contratos: ContratoSponte[],
  existentes: VinculoAno[],
  studentIdPorSponte: Record<string, string>,
) {
  const alunos = alunosVigentesDoAno(contratos).map((a) => ({
    studentId: studentIdPorSponte[a.sponteId],
    turma: a.turma,
    contratoId: a.contratoId,
  }));
  const plano = planejarSincronizacaoAno(ano, alunos, existentes);
  const inativados = new Set(plano.inativar);
  const finais: VinculoAno[] = [
    ...existentes
      .filter(
        (v) =>
          !plano.upserts.some((u) => u.student_id === v.studentId && u.ano_letivo === v.anoLetivo),
      )
      .map((v) =>
        v.anoLetivo === ano && inativados.has(v.studentId) ? { ...v, ativo: false } : v,
      ),
    ...plano.upserts.map((u) => ({
      studentId: u.student_id,
      anoLetivo: u.ano_letivo,
      turmaNome: u.turma_nome,
      ativo: true,
    })),
  ];
  return { plano, finais };
}

describe("alunosVigentesDoAno", () => {
  it("ignora contratos não vigentes e AlunoID vazio/0", () => {
    const lista = alunosVigentesDoAno([
      contrato({ alunoId: "1", situacao: "Vigente" }),
      contrato({ alunoId: "2", situacao: "Cancelado" }),
      contrato({ alunoId: "3", situacao: "Transferido" }),
      contrato({ alunoId: "0" }),
      contrato({ alunoId: "" }),
    ]);
    expect(lista.map((a) => a.sponteId)).toEqual(["1"]);
  });

  it("com dois contratos vigentes do mesmo aluno no ano, fica o de maior ContratoID", () => {
    const lista = alunosVigentesDoAno([
      contrato({ alunoId: "7", contratoId: "100", turma: "01 - Antiga" }),
      contrato({ alunoId: "7", contratoId: "120", turma: "02 - Nova" }),
    ]);
    expect(lista).toEqual([
      { sponteId: "7", nome: "Aluno", turma: "02 - Nova", contratoId: "120" },
    ]);
  });
});

describe("unidadeDestinoDiario (CEC × CEC Baby pela turma do ano)", () => {
  it("Berçário e Maternal vão para CEC Baby; Períodos e Anos para CEC", () => {
    expect(unidadeDestinoDiario("01 - Berçário I")).toBe("CEC Baby");
    expect(unidadeDestinoDiario("03 - Maternal 3 M")).toBe("CEC Baby");
    expect(unidadeDestinoDiario("04 - 1º Período T")).toBe("CEC");
    expect(unidadeDestinoDiario("07 - 1º Ano T")).toBe("CEC");
  });

  it("Maternal 3 em 2026 rematriculado no 1º Período em 2027 fica em cada unidade no seu ano", () => {
    const c26 = contrato({ alunoId: "50", turma: "03 - Maternal 3 M", contratoId: "300" });
    const c27 = contrato({ alunoId: "50", turma: "04 - 1º Período M", contratoId: "400" });
    expect(unidadeDestinoDiario(alunosVigentesDoAno([c26])[0].turma)).toBe("CEC Baby");
    expect(unidadeDestinoDiario(alunosVigentesDoAno([c27])[0].turma)).toBe("CEC");
  });
});

describe("planejarSincronizacaoAno", () => {
  const ids = { "1": "s1", "2": "s2", "169": "gabriel" };

  it("aluno com contrato só no ano corrente aparece só nesse ano", () => {
    const { finais } = sincronizar(
      2026,
      [contrato({ alunoId: "1", turma: "05 - 2º Período" })],
      [],
      ids,
    );
    expect(turmasDoAno(finais, 2026).get("s1")).toBe("05 - 2º Período");
    expect(turmasDoAno(finais, 2027).has("s1")).toBe(false);
  });

  it("aluno vigente em dois anos aparece nos dois, cada um com a sua turma", () => {
    const r26 = sincronizar(
      2026,
      [contrato({ alunoId: "1", turma: "05 - 2º Período", contratoId: "1" })],
      [],
      ids,
    );
    const r27 = sincronizar(
      2027,
      [contrato({ alunoId: "1", turma: "07 - 1º Ano T", contratoId: "2" })],
      r26.finais,
      ids,
    );
    expect(turmasDoAno(r27.finais, 2026).get("s1")).toBe("05 - 2º Período");
    expect(turmasDoAno(r27.finais, 2027).get("s1")).toBe("07 - 1º Ano T");
    // Sincronizar 2027 não inativa nem reescreve 2026.
    expect(r27.plano.inativar).toEqual([]);
    expect(r27.plano.upserts).toHaveLength(1);
    expect(r27.plano.upserts[0].ano_letivo).toBe(2027);
    // class_name de conveniência = maior ano ativo.
    expect(turmaMaisRecente(r27.finais.filter((v) => v.studentId === "s1"))).toBe("07 - 1º Ano T");
  });

  it("aluno que sai do vigente do ano fica inativo só naquele ano", () => {
    const existentes: VinculoAno[] = [
      { studentId: "s2", anoLetivo: 2026, turmaNome: "A", ativo: true },
      { studentId: "s2", anoLetivo: 2027, turmaNome: "B", ativo: true },
    ];
    const { plano, finais } = sincronizar(2026, [contrato({ alunoId: "1" })], existentes, ids);
    expect(plano.inativar).toEqual(["s2"]);
    expect(turmasDoAno(finais, 2026).has("s2")).toBe(false);
    expect(turmasDoAno(finais, 2027).get("s2")).toBe("B");
    expect(turmaMaisRecente(finais.filter((v) => v.studentId === "s2"))).toBe("B");
  });

  it("vínculo já inativo não entra de novo em inativar; sem vínculo ativo, turma mais recente é null", () => {
    const existentes: VinculoAno[] = [
      { studentId: "s2", anoLetivo: 2026, turmaNome: "A", ativo: false },
    ];
    const { plano } = sincronizar(2026, [], existentes, ids);
    expect(plano.inativar).toEqual([]);
    expect(turmaMaisRecente(existentes)).toBeNull();
  });

  it("caso real: Gabriel Guatimosim (AlunoID 169) fora de 2026, dentro de 2027 em 07 - 1º Ano T", () => {
    // Estado anterior (sync antigo por GetAlunos): Gabriel vazou para 2026 com a turma de 2027.
    const existentes: VinculoAno[] = [
      { studentId: "gabriel", anoLetivo: 2026, turmaNome: "07 - 1º Ano T", ativo: true },
    ];
    const vigentes2026 = [
      contrato({ alunoId: "1", turma: "06 - 2º Período T", contratoId: "200" }),
    ];
    const vigentes2027 = [
      contrato({ alunoId: "1", turma: "07 - 1º Ano T", contratoId: "220" }),
      contrato({
        alunoId: "169",
        nome: "Gabriel Guatimosim Machado",
        turma: "07 - 1º Ano T",
        contratoId: "221",
      }),
    ];
    const r26 = sincronizar(2026, vigentes2026, existentes, ids);
    expect(r26.plano.inativar).toEqual(["gabriel"]);
    const r27 = sincronizar(2027, vigentes2027, r26.finais, ids);

    expect(turmasDoAno(r27.finais, 2026).has("gabriel")).toBe(false);
    expect(turmasDoAno(r27.finais, 2027).get("gabriel")).toBe("07 - 1º Ano T");
    expect(r27.plano.upserts.find((u) => u.student_id === "gabriel")?.contrato_sponte_numero).toBe(
      "221",
    );
    // O colega segue em 2026 (2º Período) e em 2027 (1º Ano).
    expect(turmasDoAno(r27.finais, 2026).get("s1")).toBe("06 - 2º Período T");
    expect(turmasDoAno(r27.finais, 2027).get("s1")).toBe("07 - 1º Ano T");
  });
});

describe("contarTurmasCorrigidas", () => {
  it("conta só quem tinha class_name diferente da turma do ano", () => {
    const antes = new Map([
      ["s1", "07 - 1º Ano T"],
      ["s2", "05 - 2º Período"],
    ]);
    const plano = planejarSincronizacaoAno(
      2026,
      [
        { studentId: "s1", turma: "06 - 2º Período T", contratoId: null },
        { studentId: "s2", turma: "05 - 2º Período", contratoId: null },
        { studentId: "novo", turma: "X", contratoId: null },
      ],
      [],
    );
    expect(contarTurmasCorrigidas(plano.upserts, antes)).toBe(1);
  });
});
