import { describe, expect, it } from "vitest";
import { alunosVigentesDoAno, type ContratoSponte } from "@/lib/diario-sync";
import {
  atribuicaoDuplicada,
  atribuicoesDoProfessor,
  aulasDoDia,
  diaSemanaISO,
  ehCargoDeProfessor,
  filtrarPorAtribuicao,
  horarioConflita,
  montarChamada,
  professorLecionaDisciplina,
  resumoChamada,
  validarHorario,
  validarLancamento,
  planejarSincronizacaoPedagogico,
  professorLecionaTurma,
  trimestresDoCalendario,
  turmasDoAnoPedagogico,
  validarCalendario,
  type Atribuicao,
  type FrequenciaRow,
  type Horario,
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

describe("Fase 1 — só o professor da atribuição lança conteúdo e frequência", () => {
  // Ana (p1) leciona Matemática no 6º Ano; Bruno (p2) leciona História no
  // 6º Ano e Matemática no 7º Ano. Nenhum dos dois pode lançar na aula do outro.
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
      professor_id: "p2",
      turma_nome: "6º Ano",
      disciplina_id: "his",
      ano_letivo: 2027,
    },
    {
      id: "c",
      school_id: CEC,
      professor_id: "p2",
      turma_nome: "7º Ano",
      disciplina_id: "mat",
      ano_letivo: 2027,
    },
  ];
  const aula = {
    schoolId: CEC,
    anoLetivo: 2027,
    turmaNome: "6º Ano",
    disciplinaId: "mat",
    data: "2027-03-10",
  };

  it("professor responsável pela turma+disciplina é autorizado", () => {
    expect(professorLecionaDisciplina(atr, "p1", CEC, 2027, "6º Ano", "mat")).toBe(true);
    expect(validarLancamento(atr, { ...aula, professorId: "p1" })).toBeNull();
  });

  it("professor da mesma turma em OUTRA disciplina, ou da mesma disciplina em OUTRA turma, é barrado", () => {
    // Bruno dá aula no 6º Ano (História) e dá Matemática (7º Ano) — mas não Matemática no 6º.
    expect(professorLecionaDisciplina(atr, "p2", CEC, 2027, "6º Ano", "mat")).toBe(false);
    expect(validarLancamento(atr, { ...aula, professorId: "p2" })).toMatch(/não leciona/);
    // Outra unidade e outro ano também barram.
    expect(professorLecionaDisciplina(atr, "p1", BABY, 2027, "6º Ano", "mat")).toBe(false);
    expect(professorLecionaDisciplina(atr, "p1", CEC, 2026, "6º Ano", "mat")).toBe(false);
  });

  it("data fora do ano letivo é rejeitada mesmo para o professor certo", () => {
    expect(validarLancamento(atr, { ...aula, professorId: "p1", data: "2026-12-10" })).toMatch(
      /ano letivo/,
    );
  });

  it("filtrarPorAtribuicao devolve só as linhas das aulas do professor", () => {
    const linhas: FrequenciaRow[] = [
      {
        school_id: CEC,
        ano_letivo: 2027,
        turma_nome: "6º Ano",
        disciplina_id: "mat",
        data: "2027-03-10",
        sponte_aluno_id: "1",
        presente: true,
      },
      {
        school_id: CEC,
        ano_letivo: 2027,
        turma_nome: "6º Ano",
        disciplina_id: "his",
        data: "2027-03-10",
        sponte_aluno_id: "1",
        presente: false,
      },
      {
        school_id: CEC,
        ano_letivo: 2027,
        turma_nome: "7º Ano",
        disciplina_id: "mat",
        data: "2027-03-10",
        sponte_aluno_id: "9",
        presente: true,
      },
    ];
    expect(filtrarPorAtribuicao(linhas, atr, "p1").map((l) => l.disciplina_id)).toEqual(["mat"]);
    expect(filtrarPorAtribuicao(linhas, atr, "p2").map((l) => l.turma_nome)).toEqual([
      "6º Ano",
      "7º Ano",
    ]);
    expect(filtrarPorAtribuicao(linhas, atr, "p3")).toEqual([]);
  });
});

describe("Fase 1 — grade de horários e aulas do dia", () => {
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
      turma_nome: "Maternal 2",
      disciplina_id: "infantil",
      ano_letivo: 2027,
    },
    {
      id: "c",
      school_id: CEC,
      professor_id: "p2",
      turma_nome: "6º Ano",
      disciplina_id: "his",
      ano_letivo: 2027,
    },
  ];
  const h = (p: Partial<Horario>): Horario => ({
    id: "h",
    school_id: CEC,
    ano_letivo: 2027,
    turma_nome: "6º Ano",
    disciplina_id: "mat",
    dia_semana: 3,
    horario_inicio: "07:00:00",
    horario_fim: "07:50:00",
    ...p,
  });
  const grade: Horario[] = [
    h({ id: "1", dia_semana: 3, horario_inicio: "07:00:00", horario_fim: "07:50:00" }),
    h({ id: "2", dia_semana: 3, horario_inicio: "10:00:00", horario_fim: "10:50:00" }),
    h({ id: "3", dia_semana: 5, horario_inicio: "08:00:00", horario_fim: "08:50:00" }),
    h({
      id: "4",
      disciplina_id: "his",
      dia_semana: 3,
      horario_inicio: "08:00:00",
      horario_fim: "08:50:00",
    }),
  ];

  it("dia da semana ISO (10/03/2027 é quarta-feira; 14/03/2027 é domingo)", () => {
    expect(diaSemanaISO("2027-03-10")).toBe(3);
    expect(diaSemanaISO("2027-03-14")).toBe(7);
  });

  it("aulas do dia: só as da grade do professor no dia; atribuição sem grade entra sem horário", () => {
    const aulas = aulasDoDia(grade, atr, "p1", "2027-03-10");
    expect(aulas.map((a) => [a.turmaNome, a.horarioInicio])).toEqual([
      ["6º Ano", "07:00"],
      ["6º Ano", "10:00"],
      ["Maternal 2", null], // Infantil sem grade: lançável mesmo assim
    ]);
    // História do 6º Ano (p2) não aparece para p1.
    expect(aulas.some((a) => a.disciplinaId === "his")).toBe(false);
    // Sexta: só a aula das 08:00 (e a do Infantil sem grade).
    expect(aulasDoDia(grade, atr, "p1", "2027-03-12").map((a) => a.horarioInicio)).toEqual([
      "08:00",
      null,
    ]);
    // Turma com grade cadastrada mas sem aula no dia não aparece.
    expect(aulasDoDia(grade, atr, "p2", "2027-03-12")).toEqual([]);
  });

  it("valida horário e detecta sobreposição na mesma turma/dia", () => {
    expect(validarHorario("07:00", "07:50")).toBeNull();
    expect(validarHorario("07:50", "07:00")).toMatch(/depois do início/);
    expect(validarHorario("7:00", "07:50")).toMatch(/HH:MM/);
    const novo = h({
      disciplina_id: "por",
      dia_semana: 3,
      horario_inicio: "07:30",
      horario_fim: "08:20",
    });
    expect(horarioConflita(grade, novo)?.id).toBe("1");
    expect(
      horarioConflita(grade, h({ dia_semana: 3, horario_inicio: "07:50", horario_fim: "08:00" })),
    ).toBeNull();
    expect(
      horarioConflita(
        grade,
        h({ turma_nome: "7º Ano", dia_semana: 3, horario_inicio: "07:00", horario_fim: "07:50" }),
      ),
    ).toBeNull();
  });
});

describe("Fase 1 — chamada", () => {
  const alunos: (MatriculaAnoRow & { aluno_nome: string })[] = [
    {
      school_id: CEC,
      sponte_aluno_id: "1",
      aluno_nome: "Maria",
      ano_letivo: 2027,
      turma_nome: "6º Ano",
      ativo: true,
    },
    {
      school_id: CEC,
      sponte_aluno_id: "2",
      aluno_nome: "João",
      ano_letivo: 2027,
      turma_nome: "6º Ano",
      ativo: true,
    },
    {
      school_id: CEC,
      sponte_aluno_id: "3",
      aluno_nome: "Ana",
      ano_letivo: 2027,
      turma_nome: "6º Ano",
      ativo: false,
    },
    {
      school_id: CEC,
      sponte_aluno_id: "4",
      aluno_nome: "Pedro",
      ano_letivo: 2027,
      turma_nome: "7º Ano",
      ativo: true,
    },
    {
      school_id: CEC,
      sponte_aluno_id: "5",
      aluno_nome: "Lia",
      ano_letivo: 2026,
      turma_nome: "6º Ano",
      ativo: true,
    },
  ];

  it("lista só ativos da turma/ano, ordenados por nome, presença padrão true e faltas já lançadas", () => {
    const lancadas: FrequenciaRow[] = [
      {
        school_id: CEC,
        ano_letivo: 2027,
        turma_nome: "6º Ano",
        disciplina_id: "mat",
        data: "2027-03-10",
        sponte_aluno_id: "2",
        presente: false,
      },
    ];
    const chamada = montarChamada(alunos, CEC, 2027, "6º Ano", lancadas);
    expect(chamada).toEqual([
      { sponteAlunoId: "2", nome: "João", presente: false },
      { sponteAlunoId: "1", nome: "Maria", presente: true },
    ]);
    expect(resumoChamada(chamada)).toEqual({ total: 2, presentes: 1, faltas: 1 });
  });
});
