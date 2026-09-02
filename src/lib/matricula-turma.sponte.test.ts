import { beforeEach, describe, expect, it, vi } from "vitest";

// Sponte mockado: as suítes cobrem a decisão (qual turma, matricular ou não) sem
// tocar na API real.
const chamadas: { metodo: string; parametros: string }[] = [];
const respostas = new Map<string, string>();

vi.mock("@/lib/sponte.functions", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/sponte.functions")>("@/lib/sponte.functions");
  return {
    parseXmlValue: real.parseXmlValue,
    parseXmlList: real.parseXmlList,
    checkFault: real.checkFault,
    resolverCredenciais: (unidade: string) =>
      unidade === "Sem Integração" ? null : { codigoCliente: "1", token: "t" },
    callSponte: async (metodo: string, parametros: string) => {
      chamadas.push({ metodo, parametros });
      return respostas.get(metodo) ?? "";
    },
    callSponteMethod: async (metodo: string, parametros: string) => {
      chamadas.push({ metodo, parametros });
      return respostas.get(metodo) ?? "";
    },
  };
});

const { matricularEmTurma } = await import("@/lib/matricula-turma.sponte");

const CURSOS = `<GetCursosResult><wsCurso><CursoID>10</CursoID><Nome>07 - 1º Ano</Nome><Serie>1º Ano</Serie></wsCurso></GetCursosResult>`;

function turmasXml(...turmas: { id: number; nome: string; situacao: string }[]): string {
  return turmas
    .map(
      (t) =>
        `<wsTurma><TurmaID>${t.id}</TurmaID><Nome>${t.nome}</Nome><CursoID>10</CursoID>` +
        `<Curso>07 - 1º Ano</Curso><AnoLetivo>2026</AnoLetivo><Situacao>${t.situacao}</Situacao>` +
        `<Horario>Fundamental 1/2 ${t.nome.includes(" T ") ? "T" : "M"}</Horario>` +
        `<MaxAlunos>25</MaxAlunos><VagasOcupadas>3</VagasOcupadas></wsTurma>`,
    )
    .join("");
}

const ENTRADA = {
  unidade: "Colégio Espaço Cultural",
  alunoId: 700,
  serie: "1º Ano",
  turno: "T" as const,
  anoLetivo: 2026,
  dataMatricula: "2026-09-02",
  observacao: "protocolo site-1",
};

beforeEach(() => {
  chamadas.length = 0;
  respostas.clear();
  respostas.set("GetCursos", CURSOS);
  respostas.set(
    "GetTurmas",
    turmasXml(
      { id: 122, nome: "07 - 1º Ano M / Prof. Priscilla", situacao: "Aberta" },
      { id: 123, nome: "07 - 1º Ano T / A Prof. Priscilla", situacao: "Aberta" },
    ),
  );
  respostas.set("GetMatriculas", "");
  respostas.set(
    "InsertMatricula",
    "<InsertMatriculaResult><RetornoOperacao>01 - Operação Realizada com Sucesso.</RetornoOperacao><ContratoID>4321</ContratoID></InsertMatriculaResult>",
  );
});

function metodos(): string[] {
  return chamadas.map((c) => c.metodo);
}

describe("matrícula na turma", () => {
  it("matricula na turma do turno pedido e guarda o ContratoID", async () => {
    const r = await matricularEmTurma(ENTRADA);

    expect(r.status).toBe("matriculado");
    expect(r.cursoId).toBe(10);
    expect(r.turmaId).toBe(123);
    expect(r.contratoId).toBe(4321);
    expect(r.jaExistia).toBe(false);
    expect(metodos()).toContain("InsertMatricula");
  });

  it("não repete a matrícula quando o aluno já tem contrato na turma", async () => {
    respostas.set(
      "GetMatriculas",
      "<wsMatricula><ContratoID>999</ContratoID><TurmaID>123</TurmaID></wsMatricula>",
    );

    const r = await matricularEmTurma(ENTRADA);

    expect(r.status).toBe("matriculado");
    expect(r.contratoId).toBe(999);
    expect(r.jaExistia).toBe(true);
    expect(metodos()).not.toContain("InsertMatricula");
  });

  it("vira pendência quando não existe turma aberta para o turno", async () => {
    respostas.set(
      "GetTurmas",
      turmasXml(
        { id: 122, nome: "07 - 1º Ano M / Prof. Priscilla", situacao: "Aberta" },
        { id: 137, nome: "07 - 1º Ano T / B Prof. Kelly", situacao: "Encerrada" },
      ),
    );

    const r = await matricularEmTurma(ENTRADA);

    expect(r.status).toBe("sem_turma");
    expect(r.turmaId).toBeNull();
    expect(r.erro).toContain("Tarde");
    expect(metodos()).not.toContain("InsertMatricula");
  });

  it("vira pendência quando a rotina não define o turno", async () => {
    const r = await matricularEmTurma({ ...ENTRADA, turno: null });

    expect(r.status).toBe("sem_turma");
    expect(metodos()).toEqual([]);
  });

  it("vira pendência quando nenhum curso ativo corresponde à série", async () => {
    const r = await matricularEmTurma({ ...ENTRADA, serie: "9º Ano" });

    expect(r.status).toBe("sem_turma");
    expect(metodos()).toEqual(["GetCursos"]);
  });

  it("reporta erro sem matricular quando o Sponte não confirma", async () => {
    respostas.set(
      "InsertMatricula",
      "<InsertMatriculaResult><RetornoOperacao>29 - Registro já cadastrado</RetornoOperacao><ContratoID>0</ContratoID></InsertMatriculaResult>",
    );

    const r = await matricularEmTurma(ENTRADA);

    expect(r.status).toBe("erro");
    expect(r.erro).toContain("29");
  });

  it("não tenta nada quando a unidade não tem integração", async () => {
    const r = await matricularEmTurma({ ...ENTRADA, unidade: "Sem Integração" });

    expect(r.status).toBe("erro");
    expect(metodos()).toEqual([]);
  });
});
