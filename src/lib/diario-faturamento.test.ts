import { describe, expect, it } from "vitest";
import {
  consolidarAluno,
  faturandoInterrompido,
  observacaoFaturamentoSponte,
  pendenciasPorAluno,
  podeFaturar,
  transicaoFaturamento,
  type EventoExtra,
} from "@/lib/diario-faturamento";
import type { TabelaPrecos } from "@/lib/diario-precos";

const PRECOS_2026: TabelaPrecos = { lunch: 25, snack: 12.5, hora_extra: 40 };

let seq = 0;
function refeicao(studentId: string, meal: EventoExtra["meal"], dia = "2026-09-01"): EventoExtra {
  seq += 1;
  return {
    id: `e${seq}`,
    studentId,
    eventType: "meal",
    meal,
    extraMinutes: null,
    createdAt: `${dia}T12:00:00.000Z`,
  };
}
function horaExtra(studentId: string, minutos: number | null, dia = "2026-09-01"): EventoExtra {
  seq += 1;
  return {
    id: `e${seq}`,
    studentId,
    eventType: "checkinout",
    meal: null,
    extraMinutes: minutos,
    createdAt: `${dia}T21:00:00.000Z`,
  };
}

describe("consolidarAluno — soma refeições + hora extra pela Tabela de Preços", () => {
  it("refeições por ocorrência e hora extra proporcional aos minutos", () => {
    const p = consolidarAluno(
      [
        refeicao("a", "lunch"),
        refeicao("a", "lunch", "2026-09-02"),
        refeicao("a", "snack"),
        horaExtra("a", 45),
        horaExtra("a", 30, "2026-09-03"),
      ],
      PRECOS_2026,
    );
    expect(p.itens).toEqual([
      { categoria: "lunch", rotulo: "Almoço", quantidade: 2, precoUnitario: 25, valor: 50 },
      {
        categoria: "snack",
        rotulo: "Lanche da Tarde",
        quantidade: 1,
        precoUnitario: 12.5,
        valor: 12.5,
      },
      {
        categoria: "hora_extra",
        rotulo: "Hora Extra",
        quantidade: 75,
        precoUnitario: 40,
        valor: 50,
      },
    ]);
    expect(p.total).toBe(112.5);
    expect(p.bloqueios).toEqual([]);
    expect(podeFaturar(p)).toBe(true);
    expect(p.periodoInicio).toBe("2026-09-01T12:00:00.000Z");
    expect(p.periodoFim).toBe("2026-09-03T21:00:00.000Z");
    expect(p.eventIds).toHaveLength(5);
  });

  it("hora extra com zero minutos não gera item", () => {
    const p = consolidarAluno([horaExtra("a", 0), refeicao("a", "lunch")], PRECOS_2026);
    expect(p.itens.map((i) => i.categoria)).toEqual(["lunch"]);
    expect(p.total).toBe(25);
  });

  it("categoria consumida sem preço cadastrado bloqueia o faturamento", () => {
    const p = consolidarAluno([refeicao("a", "dinner"), refeicao("a", "lunch")], PRECOS_2026);
    expect(p.bloqueios).toEqual(["Sem preço de Jantar na Tabela de Preços"]);
    expect(podeFaturar(p)).toBe(false);
    expect(p.itens.find((i) => i.categoria === "dinner")).toMatchObject({
      precoUnitario: null,
      valor: 0,
    });
  });

  it("hora extra sem duração (dia sem horário contratado) bloqueia e aponta os registros", () => {
    const semDuracao = horaExtra("a", null);
    const p = consolidarAluno([semDuracao, horaExtra("a", 60)], PRECOS_2026);
    expect(p.bloqueios).toEqual([
      "1 registro(s) de Entrada/Saída sem duração — informe os minutos antes de faturar",
    ]);
    expect(p.eventosSemDuracao).toEqual([{ id: semDuracao.id, createdAt: semDuracao.createdAt }]);
    expect(podeFaturar(p)).toBe(false);
  });

  it("sem valor nenhum (só hora extra zerada) não fatura", () => {
    const p = consolidarAluno([horaExtra("a", 0)], PRECOS_2026);
    expect(p.total).toBe(0);
    expect(p.bloqueios).toEqual(["Nenhum valor a faturar"]);
  });
});

describe("pendenciasPorAluno — agrupa por aluno e usa o preço do ano do evento", () => {
  it("separa alunos e anos letivos, cada um com a sua tabela", () => {
    const precos = new Map<number, TabelaPrecos>([
      [2026, { lunch: 25 }],
      [2027, { lunch: 30 }],
    ]);
    const pend = pendenciasPorAluno(
      [
        refeicao("a", "lunch", "2026-12-15"),
        refeicao("a", "lunch", "2027-02-03"),
        refeicao("b", "lunch", "2027-02-03"),
      ],
      precos,
    );
    expect(pend.map((p) => [p.studentId, p.total])).toEqual([
      ["a", 25],
      ["a", 30],
      ["b", 30],
    ]);
  });

  it("ano sem tabela de preços bloqueia", () => {
    const [p] = pendenciasPorAluno([refeicao("a", "lunch", "2028-03-01")], new Map());
    expect(p.bloqueios).toEqual(["Sem preço de Almoço na Tabela de Preços"]);
  });
});

describe("observação do título no Sponte", () => {
  it("descreve o período e a composição", () => {
    const p = consolidarAluno(
      [refeicao("a", "lunch"), horaExtra("a", 90, "2026-09-10")],
      PRECOS_2026,
    );
    expect(observacaoFaturamentoSponte(p.itens, p.periodoInicio, p.periodoFim)).toBe(
      "Extras do Diário 01/09/2026 a 10/09/2026: Almoço ×1, Hora Extra 1h30",
    );
  });
});

describe("ciclo de vida — nunca duplica cobrança", () => {
  it("já lançado não relança nem aceita marcação manual", () => {
    expect(transicaoFaturamento("lancado", "lancar", true).ok).toBe(false);
    expect(transicaoFaturamento("lancado", "marcar_manual", true).ok).toBe(false);
  });

  it("com título já criado no Sponte não relança, mesmo em erro", () => {
    expect(transicaoFaturamento("erro", "lancar", true)).toEqual({
      ok: false,
      erro: "Este faturamento já tem cobrança criada no Sponte.",
    });
  });

  it("em andamento não aceita segunda tentativa concorrente", () => {
    expect(transicaoFaturamento("faturando", "lancar", false).ok).toBe(false);
  });

  it("erro sem título permite relançar ou marcar manual", () => {
    expect(transicaoFaturamento("erro", "lancar", false)).toEqual({ ok: true });
    expect(transicaoFaturamento("erro", "marcar_manual", false)).toEqual({ ok: true });
  });

  it("marcado manual (lancado) não dispara nova tentativa automática", () => {
    expect(transicaoFaturamento("lancado", "lancar", false).ok).toBe(false);
  });

  it("faturando antigo é considerado interrompido", () => {
    expect(faturandoInterrompido("2026-09-01T10:00:00Z", "2026-09-01T10:05:00Z")).toBe(false);
    expect(faturandoInterrompido("2026-09-01T10:00:00Z", "2026-09-01T10:11:00Z")).toBe(true);
  });
});
