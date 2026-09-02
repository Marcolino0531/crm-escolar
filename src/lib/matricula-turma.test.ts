import { describe, expect, it } from "vitest";

import {
  anoLetivoValidoMatricula,
  anosLetivosDisponiveis,
  cursoIdDaSerie,
  datasContratoAnoLetivo,
  escolherTurma,
  matriculaConfirmada,
  montarParametrosInsertMatricula,
  textoPendenciaTurma,
  turmaAberta,
  turnoDaRotina,
  turnoDaTurma,
  type CursoSponte,
  type TurmaSponte,
} from "@/lib/matricula-turma";

function turma(over: Partial<TurmaSponte> & { turmaId: number }): TurmaSponte {
  return {
    nome: "07 - 1º Ano M / Prof. Priscilla Miranda",
    cursoId: 10,
    curso: "07 - 1º Ano",
    anoLetivo: 2026,
    situacao: "Aberta",
    horario: "Fundamental 1/2 M",
    maxAlunos: 25,
    vagasOcupadas: 10,
    ...over,
  };
}

describe("ano letivo", () => {
  it("oferece o ano vigente e o seguinte, derivados da data do servidor", () => {
    expect(anosLetivosDisponiveis("2026-09-02")).toEqual([2026, 2027]);
    expect(anosLetivosDisponiveis("2031-01-01")).toEqual([2031, 2032]);
  });

  it("aceita só as duas opções oferecidas", () => {
    expect(anoLetivoValidoMatricula(2026, "2026-09-02")).toBe(true);
    expect(anoLetivoValidoMatricula(2027, "2026-09-02")).toBe(true);
    expect(anoLetivoValidoMatricula(2025, "2026-09-02")).toBe(false);
    expect(anoLetivoValidoMatricula(2028, "2026-09-02")).toBe(false);
    expect(anoLetivoValidoMatricula(0, "2026-09-02")).toBe(false);
  });

  it("faz o contrato cobrir o ano letivo inteiro", () => {
    expect(datasContratoAnoLetivo(2027)).toEqual({
      inicio: "01/01/2027",
      termino: "31/12/2027",
    });
  });
});

describe("turno da rotina", () => {
  const base = {
    periodoManha: false,
    periodoTarde: false,
    horarioEstendido: false,
    horarioCurricular: "" as const,
  };

  it("usa o período escolhido quando é manhã ou tarde", () => {
    expect(turnoDaRotina({ ...base, periodoManha: true })).toBe("M");
    expect(turnoDaRotina({ ...base, periodoTarde: true })).toBe("T");
  });

  it("usa o horário curricular no horário estendido", () => {
    expect(turnoDaRotina({ ...base, horarioEstendido: true, horarioCurricular: "T" })).toBe("T");
  });

  it("não chuta turno sem período escolhido nem no estendido sem resposta", () => {
    expect(turnoDaRotina(base)).toBeNull();
    expect(turnoDaRotina({ ...base, horarioEstendido: true })).toBeNull();
    expect(turnoDaRotina({ ...base, periodoManha: true, periodoTarde: true })).toBeNull();
  });
});

describe("turno da turma", () => {
  it("lê o turno do horário e do nome, ignorando a inicial do professor", () => {
    expect(turnoDaTurma({ nome: "07 - 1º Ano M / Prof. Priscilla", horario: "" })).toBe("M");
    expect(turnoDaTurma({ nome: "07 - 1º Ano T / A Prof. Kelly", horario: "" })).toBe("T");
    // "Marcos" depois da barra não pode virar turno da manhã.
    expect(turnoDaTurma({ nome: "07 - 1º Ano T / Prof. Marcos", horario: "" })).toBe("T");
    expect(turnoDaTurma({ nome: "sem turno", horario: "Fundamental 1/2 T" })).toBe("T");
  });

  it("devolve null quando nome e horário não dizem o turno", () => {
    expect(turnoDaTurma({ nome: "07 - 1º Ano", horario: "" })).toBeNull();
  });
});

describe("curso da série", () => {
  const cursos: CursoSponte[] = [
    { cursoId: 10, nome: "07 - 1º Ano", serie: "1º Ano" },
    { cursoId: 11, nome: "17 - 11º Ano", serie: "11º Ano" },
    { cursoId: 12, nome: "03 - Maternal II", serie: "" },
  ];

  it("casa pela série e pelo nome com prefixo de código", () => {
    expect(cursoIdDaSerie("1º Ano", cursos)).toBe(10);
    expect(cursoIdDaSerie("11º Ano", cursos)).toBe(11);
    expect(cursoIdDaSerie("Maternal II", cursos)).toBe(12);
  });

  it("não casa série inexistente nem vazia", () => {
    expect(cursoIdDaSerie("2º Ano", cursos)).toBeNull();
    expect(cursoIdDaSerie("", cursos)).toBeNull();
  });
});

describe("escolha da turma", () => {
  const alvo = { cursoId: 10, turno: "T" as const, anoLetivo: 2026 };

  it("escolhe a turma aberta do curso, turno e ano", () => {
    const escolhida = escolherTurma(
      [
        turma({ turmaId: 122 }),
        turma({ turmaId: 123, nome: "07 - 1º Ano T / A", horario: "Fundamental 1/2 T" }),
      ],
      alvo,
    );
    expect(escolhida?.turmaId).toBe(123);
  });

  it("com mais de uma candidata fica na de menor TurmaID", () => {
    const escolhida = escolherTurma(
      [
        turma({ turmaId: 140, nome: "07 - 1º Ano T / B", horario: "Fundamental 1/2 T" }),
        turma({ turmaId: 123, nome: "07 - 1º Ano T / A", horario: "Fundamental 1/2 T" }),
      ],
      alvo,
    );
    expect(escolhida?.turmaId).toBe(123);
  });

  it("ignora turma encerrada, de outro ano e de outro curso", () => {
    expect(turmaAberta(turma({ turmaId: 137, situacao: "Encerrada" }))).toBe(false);
    const candidatas = [
      turma({ turmaId: 137, situacao: "Encerrada", horario: "Fundamental 1/2 T" }),
      turma({ turmaId: 200, anoLetivo: 2025, horario: "Fundamental 1/2 T" }),
      turma({ turmaId: 300, cursoId: 11, horario: "Fundamental 1/2 T" }),
    ];
    expect(escolherTurma(candidatas, alvo)).toBeNull();
  });

  it("sem turma compatível devolve null e a pendência cita série, turno e ano", () => {
    expect(escolherTurma([turma({ turmaId: 122 })], alvo)).toBeNull();
    const texto = textoPendenciaTurma({ serie: "1º Ano", turno: "T", anoLetivo: 2026 });
    expect(texto).toContain("1º Ano");
    expect(texto).toContain("Tarde");
    expect(texto).toContain("2026");
  });
});

describe("InsertMatricula", () => {
  it("monta os parâmetros na ordem do WSDL com os valores confirmados", () => {
    const xml = montarParametrosInsertMatricula({
      alunoId: 700,
      cursoId: 10,
      turmaId: 123,
      anoLetivo: 2026,
      dataMatricula: "2026-09-02",
      observacao: "protocolo site-1 & teste",
    });

    expect(xml).toBe(
      "<nSituacao>1</nSituacao>" +
        "<nAlunoID>700</nAlunoID>" +
        "<nCursoID>10</nCursoID>" +
        "<nTurmaID>123</nTurmaID>" +
        "<nTipoContratoID>-2</nTipoContratoID>" +
        "<dDataInicio>01/01/2026</dDataInicio>" +
        "<dDataTermino>31/12/2026</dDataTermino>" +
        "<dDataMatricula>2026-09-02T00:00:00</dDataMatricula>" +
        "<nTipo>1</nTipo>" +
        "<sDisciplinas></sDisciplinas>" +
        "<nModulo></nModulo>" +
        "<nContratante></nContratante>" +
        "<nNumeroHoras></nNumeroHoras>" +
        "<sObservacao>protocolo site-1 &amp; teste</sObservacao>",
    );
  });

  it("só considera matriculado com ContratoID positivo ou sucesso explícito", () => {
    expect(matriculaConfirmada("01 - Operação Realizada com Sucesso.", "4321")).toBe(true);
    expect(matriculaConfirmada("", "4321")).toBe(true);
    expect(matriculaConfirmada("01 - Operação Realizada com Sucesso.", "0")).toBe(true);
    expect(matriculaConfirmada("29 - Registro já cadastrado", "0")).toBe(false);
    expect(matriculaConfirmada("", "")).toBe(false);
  });
});
