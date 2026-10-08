import { describe, expect, it } from "vitest";
import {
  ROTINA_FORM_VAZIA,
  ajustarHorarioCurricular,
  mensagemSemTurnoCoberto,
  preencherHorarioCurricular,
  turnosCobertos,
  validarRotinaForm,
  type HorariosRotina,
  type RotinaForm,
} from "@/lib/matricula-form";
import { escolherTurma, serieBercario, type TurmaSponte } from "@/lib/matricula-turma";
import type { Weekday } from "@/lib/diario";

const INFANTIL = "1º Período";

function todos(entrada: string, saida: string, dias: Weekday[] = [1, 2, 3, 4, 5]): HorariosRotina {
  return Object.fromEntries(dias.map((d) => [d, { entrada, saida }]));
}

function estendido(horarios: HorariosRotina, patch: Partial<RotinaForm> = {}): RotinaForm {
  return {
    ...ROTINA_FORM_VAZIA,
    dataInicio: "2027-02-01",
    horarioEstendido: true,
    horarios,
    semRefeicoes: true,
    ...patch,
  };
}

const erroTurno = (r: RotinaForm, serie = INFANTIL) =>
  validarRotinaForm(r, serie, { exigirHorarioCurricular: true, anoLetivo: 2027 })[
    "rotina.horarioCurricular"
  ];

describe("turno coberto no Horário Estendido", () => {
  it("cobre o turno só com entrada até o início e saída a partir do fim, sem tolerância", () => {
    expect(turnosCobertos(estendido(todos("07:20", "11:50")), INFANTIL)).toEqual(["M"]);
    expect(turnosCobertos(estendido(todos("07:21", "17:30")), INFANTIL)).toEqual(["T"]);
    expect(turnosCobertos(estendido(todos("07:00", "18:00")), INFANTIL)).toEqual(["M", "T"]);
    expect(turnosCobertos(estendido(todos("08:00", "17:29")), INFANTIL)).toEqual([]);
    expect(turnosCobertos(estendido(todos("07:20", "")), INFANTIL)).toBeNull();
  });

  it("um turno coberto: preenchido sozinho; escolha não coberta é limpa na tela", () => {
    const r = estendido(todos("08:00", "17:30"));
    expect(preencherHorarioCurricular(r, INFANTIL).horarioCurricular).toBe("T");
    expect(
      ajustarHorarioCurricular({ ...r, horarioCurricular: "M" }, INFANTIL).horarioCurricular,
    ).toBe("T");
    expect(erroTurno(r)).toBeUndefined();
    const dois = estendido(todos("07:00", "18:00"), { horarioCurricular: "M" });
    expect(ajustarHorarioCurricular(dois, INFANTIL).horarioCurricular).toBe("M");
    expect(
      preencherHorarioCurricular({ ...dois, horarioCurricular: "" }, INFANTIL).horarioCurricular,
    ).toBe("");
    expect(erroTurno({ ...dois, horarioCurricular: "" })).toBeDefined();
  });

  it("servidor recusa turno não coberto e bloqueia quando nenhum é coberto", () => {
    expect(erroTurno(estendido(todos("08:00", "17:30"), { horarioCurricular: "M" }))).toBe(
      "O turno escolhido não é cumprido inteiro pelos horários informados.",
    );
    const nenhum = estendido(todos("08:00", "17:00"));
    expect(erroTurno(nenhum)).toBe(mensagemSemTurnoCoberto(nenhum, INFANTIL));
    expect(mensagemSemTurnoCoberto(nenhum, INFANTIL)).toMatch(
      /^Com esses horários, .*manhã \(07:20 às 11:50\) nem da tarde \(13:00 às 17:30\)/,
    );
    const parcial = estendido(
      { ...todos("07:20", "11:50", [1]), ...todos("08:00", "17:00", [3]) },
      { frequenciaParcial: true, diasSelecionados: [1, 3] },
    );
    expect(mensagemSemTurnoCoberto(parcial, INFANTIL)).toMatch(/^Na quarta, o aluno não fica/);
  });

  it("Berçário: sem verificação de cobertura e turma sem filtro de turno", () => {
    expect(serieBercario("Berçário II")).toBe(true);
    expect(serieBercario("BERCARIO")).toBe(true);
    const r = estendido(todos("09:00", "14:00"));
    expect(erroTurno(r, "Berçário")).toBe(
      "Escolha o turno das aulas curriculares (manhã ou tarde).",
    );
    expect(erroTurno({ ...r, horarioCurricular: "T" }, "Berçário")).toBeUndefined();
    expect(preencherHorarioCurricular(r, "Berçário").horarioCurricular).toBe("");
    const turma = (turmaId: number, nome: string): TurmaSponte => ({
      turmaId,
      nome,
      cursoId: 1,
      curso: "Berçário",
      anoLetivo: 2027,
      situacao: "Aberta",
      horario: "",
      maxAlunos: null,
      vagasOcupadas: null,
    });
    const turmas = [turma(20, "Berçário M"), turma(10, "Berçário M")];
    const alvo = { cursoId: 1, turno: "T" as const, anoLetivo: 2027 };
    expect(escolherTurma(turmas, alvo)).toBeNull();
    expect(escolherTurma(turmas, { ...alvo, ignorarTurno: true })?.turmaId).toBe(10);
  });
});
