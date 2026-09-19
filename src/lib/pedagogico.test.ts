import { describe, expect, it } from "vitest";
import { alunosVigentesDoAno, type ContratoSponte } from "@/lib/diario-sync";
import {
  atribuicaoDuplicada,
  atribuicoesDoProfessor,
  ehCargoDeProfessor,
  planejarSincronizacaoPedagogico,
  professorLecionaTurma,
  trimestresDoCalendario,
  turmasDoAnoPedagogico,
  validarCalendario,
  type Atribuicao,
  type MatriculaAnoRow,
} from "@/lib/pedagogico";

const CEC = "school-cec";
const BABY = "school-baby";

const contrato = (p: Partial<ContratoSponte>): ContratoSponte => ({
  alunoId: "1",
  nome: "Aluno",
  turma: "1º Ano A",
  contratoId: "100",
  situacao: "Vigente",
  ...p,
});

describe("sincronização anual do Pedagógico (mesma regra do Diário)", () => {
  it("só contratos vigentes entram; com dois contratos no ano vale o de maior número", () => {
    const vigentes = alunosVigentesDoAno([
      contrato({ alunoId: "1", turma: "1º Ano A", contratoId: "100" }),
      contrato({ alunoId: "1", turma: "1º Ano B", contratoId: "250" }),
      contrato({ alunoId: "2", turma: "2º Ano A", situacao: "Cancelado" }),
    ]);
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0]).toMatchObject({ sponteId: "1", turma: "1º Ano B", contratoId: "250" });
  });

  it("preserva anos anteriores e inativa só quem sumiu do ano sincronizado", () => {
    const existentes: MatriculaAnoRow[] = [
      {
        school_id: CEC,
        sponte_aluno_id: "1",
        ano_letivo: 2026,
        turma_nome: "1º Ano A",
        ativo: true,
      },
      {
        school_id: CEC,
        sponte_aluno_id: "2",
        ano_letivo: 2026,
        turma_nome: "1º Ano A",
        ativo: true,
      },
      {
        school_id: CEC,
        sponte_aluno_id: "1",
        ano_letivo: 2027,
        turma_nome: "2º Ano A",
        ativo: true,
      },
    ];
    const plano = planejarSincronizacaoPedagogico(
      2026,
      [
        {
          schoolId: CEC,
          aluno: { sponteId: "1", nome: "Ana", turma: "1º Ano B", contratoId: "300" },
        },
      ],
      existentes.filter((e) => e.ano_letivo === 2026),
    );
    expect(plano.upserts).toEqual([
      {
        school_id: CEC,
        sponte_aluno_id: "1",
        aluno_nome: "Ana",
        ano_letivo: 2026,
        turma_nome: "1º Ano B",
        contrato_sponte_numero: "300",
        ativo: true,
      },
    ]);
    expect(plano.inativar).toEqual([{ school_id: CEC, sponte_aluno_id: "2" }]);
    // O vínculo de 2027 nem entra no plano: o aluno continua nas duas listas.
    expect(plano.inativar.some((i) => i.sponte_aluno_id === "1")).toBe(false);
  });

  it("mesmo AlunoID em unidades diferentes não colide (chave inclui a unidade)", () => {
    const plano = planejarSincronizacaoPedagogico(
      2026,
      [
        { schoolId: CEC, aluno: { sponteId: "7", nome: "A", turma: "1º Ano", contratoId: "1" } },
        { schoolId: BABY, aluno: { sponteId: "7", nome: "B", turma: "Maternal", contratoId: "2" } },
      ],
      [],
    );
    expect(plano.upserts.map((u) => [u.school_id, u.turma_nome])).toEqual([
      [CEC, "1º Ano"],
      [BABY, "Maternal"],
    ]);
  });

  it("turmas do ano vêm só dos vínculos ativos da unidade/ano, sem repetir", () => {
    const rows: MatriculaAnoRow[] = [
      { school_id: CEC, sponte_aluno_id: "1", ano_letivo: 2026, turma_nome: "2º Ano", ativo: true },
      { school_id: CEC, sponte_aluno_id: "2", ano_letivo: 2026, turma_nome: "1º Ano", ativo: true },
      { school_id: CEC, sponte_aluno_id: "3", ano_letivo: 2026, turma_nome: "1º Ano", ativo: true },
      {
        school_id: CEC,
        sponte_aluno_id: "4",
        ano_letivo: 2026,
        turma_nome: "3º Ano",
        ativo: false,
      },
      { school_id: CEC, sponte_aluno_id: "5", ano_letivo: 2027, turma_nome: "4º Ano", ativo: true },
      {
        school_id: BABY,
        sponte_aluno_id: "6",
        ano_letivo: 2026,
        turma_nome: "Berçário",
        ativo: true,
      },
    ];
    expect(turmasDoAnoPedagogico(rows, CEC, 2026)).toEqual(["1º Ano", "2º Ano"]);
  });
});

describe("atribuições do professor", () => {
  const atr: Atribuicao[] = [
    {
      id: "a",
      school_id: CEC,
      professor_id: "p1",
      turma_nome: "6º Ano",
      disciplina_id: "mat",
      ano_letivo: 2027,
    },
    {
      id: "b",
      school_id: CEC,
      professor_id: "p1",
      turma_nome: "6º Ano",
      disciplina_id: "fis",
      ano_letivo: 2027,
    },
    {
      id: "c",
      school_id: CEC,
      professor_id: "p1",
      turma_nome: "7º Ano",
      disciplina_id: "mat",
      ano_letivo: 2027,
    },
    {
      id: "d",
      school_id: CEC,
      professor_id: "p1",
      turma_nome: "5º Ano",
      disciplina_id: "mat",
      ano_letivo: 2026,
    },
    {
      id: "e",
      school_id: CEC,
      professor_id: "p2",
      turma_nome: "6º Ano",
      disciplina_id: "por",
      ano_letivo: 2027,
    },
    {
      id: "f",
      school_id: BABY,
      professor_id: "p1",
      turma_nome: "Maternal",
      disciplina_id: "mus",
      ano_letivo: 2027,
    },
  ];

  it("filtra por professor e ano, agrupando várias disciplinas por turma", () => {
    expect(atribuicoesDoProfessor(atr, "p1", 2027, CEC)).toEqual([
      { turmaNome: "6º Ano", disciplinaIds: ["fis", "mat"] },
      { turmaNome: "7º Ano", disciplinaIds: ["mat"] },
    ]);
    expect(atribuicoesDoProfessor(atr, "p2", 2027, CEC)).toEqual([
      { turmaNome: "6º Ano", disciplinaIds: ["por"] },
    ]);
    expect(atribuicoesDoProfessor(atr, "p1", 2025, CEC)).toEqual([]);
  });

  it("sem unidade, cruza todas as unidades em que o professor leciona", () => {
    expect(atribuicoesDoProfessor(atr, "p1", 2027).map((t) => t.turmaNome)).toEqual([
      "6º Ano",
      "7º Ano",
      "Maternal",
    ]);
  });

  it("professor só enxerga a turma vinculada (mesma regra da RLS)", () => {
    expect(professorLecionaTurma(atr, "p1", CEC, 2027, "6º Ano")).toBe(true);
    expect(professorLecionaTurma(atr, "p2", CEC, 2027, "7º Ano")).toBe(false);
    expect(professorLecionaTurma(atr, "p1", CEC, 2026, "6º Ano")).toBe(false);
    expect(professorLecionaTurma(atr, "p1", BABY, 2027, "6º Ano")).toBe(false);
  });

  it("detecta atribuição idêntica; mesma turma com outra disciplina ou ano é nova", () => {
    const base = { school_id: CEC, professor_id: "p1", turma_nome: "6º Ano", disciplina_id: "mat" };
    expect(atribuicaoDuplicada(atr, { ...base, ano_letivo: 2027 })).toBe(true);
    expect(atribuicaoDuplicada(atr, { ...base, disciplina_id: "qui", ano_letivo: 2027 })).toBe(
      false,
    );
    expect(atribuicaoDuplicada(atr, { ...base, ano_letivo: 2028 })).toBe(false);
  });

  it("reconhece cargos de professor", () => {
    expect(ehCargoDeProfessor("Professora")).toBe(true);
    expect(ehCargoDeProfessor("Prof. de Educação Física")).toBe(true);
    expect(ehCargoDeProfessor("PROFESSOR")).toBe(true);
    expect(ehCargoDeProfessor("Auxiliar de Limpeza")).toBe(false);
    expect(ehCargoDeProfessor(null)).toBe(false);
  });
});

describe("calendário letivo", () => {
  it("monta os 3 trimestres e valida a ordem", () => {
    const dias = [
      { data: "2027-02-01", tipo: "inicio_trimestre", trimestre: 1, descricao: "" },
      { data: "2027-05-10", tipo: "fim_trimestre", trimestre: 1, descricao: "" },
      { data: "2027-05-11", tipo: "inicio_trimestre", trimestre: 2, descricao: "" },
      { data: "2027-08-31", tipo: "fim_trimestre", trimestre: 2, descricao: "" },
      { data: "2027-09-01", tipo: "inicio_trimestre", trimestre: 3, descricao: "" },
      { data: "2027-12-10", tipo: "fim_trimestre", trimestre: 3, descricao: "" },
      { data: "2027-06-04", tipo: "feriado", trimestre: null, descricao: "Recesso da escola" },
    ] as const;
    expect(trimestresDoCalendario(dias)[1]).toEqual({
      numero: 2,
      inicio: "2027-05-11",
      fim: "2027-08-31",
    });
    expect(validarCalendario(dias)).toEqual([]);
  });

  it("acusa trimestre invertido, sobreposto e marco sem número", () => {
    const erros = validarCalendario([
      { data: "2027-05-10", tipo: "inicio_trimestre", trimestre: 1, descricao: "" },
      { data: "2027-02-01", tipo: "fim_trimestre", trimestre: 1, descricao: "" },
      { data: "2027-01-15", tipo: "inicio_trimestre", trimestre: 2, descricao: "" },
      { data: "2027-09-01", tipo: "fim_trimestre", trimestre: null, descricao: "" },
    ]);
    expect(erros).toHaveLength(3);
  });
});
