import { describe, expect, it } from "vitest";
import {
  conferirFalta,
  dataComDiaSemana,
  diaSemanaDaISO,
  rotuloDiaSemana,
  turnosDaGradeNaData,
  gradeVazia,
} from "./terceirizados-datas";
import type { GradeTurnos } from "./types";

// Grade do exemplo do pedido: segunda de manhã e quinta à tarde.
function grade(): GradeTurnos {
  const g = gradeVazia();
  g.seg.manha = true;
  g.qui.tarde = true;
  return g;
}

// Sexta em que o terceirizado trabalha o dia inteiro.
function gradeDiaCheio(): GradeTurnos {
  const g = gradeVazia();
  g.sex.manha = true;
  g.sex.tarde = true;
  return g;
}

describe("dia da semana a partir da data", () => {
  it("deriva o dia útil da data informada", () => {
    expect(diaSemanaDaISO("2026-08-17")).toBe("seg");
    expect(diaSemanaDaISO("2026-08-19")).toBe("qua");
    expect(diaSemanaDaISO("2026-08-21")).toBe("sex");
  });

  it("não devolve dia de grade no fim de semana nem em data inválida", () => {
    expect(diaSemanaDaISO("2026-08-22")).toBe(null);
    expect(diaSemanaDaISO("2026-08-23")).toBe(null);
    expect(diaSemanaDaISO("")).toBe(null);
    expect(diaSemanaDaISO("17/08/2026")).toBe(null);
  });

  it("nomeia também sábado e domingo", () => {
    expect(rotuloDiaSemana("2026-08-22")).toBe("Sábado");
    expect(rotuloDiaSemana("2026-08-23")).toBe("Domingo");
    expect(rotuloDiaSemana("2026-08-17")).toBe("Segunda");
  });

  it("lê a data como local, sem cair no dia anterior pelo fuso", () => {
    // Em UTC, 2026-08-17T00:00Z é 16/08 21h no Brasil — o dia não pode mudar.
    expect(dataComDiaSemana("2026-08-17")).toBe("17/08/2026, Segunda");
    expect(dataComDiaSemana("2026-01-01")).toBe("01/01/2026, Quinta");
    expect(dataComDiaSemana("")).toBe("");
  });
});

describe("turnos previstos na grade", () => {
  it("lista só os turnos marcados naquele dia da semana", () => {
    expect(turnosDaGradeNaData(grade(), "2026-08-17")).toEqual(["manha"]);
    expect(turnosDaGradeNaData(grade(), "2026-08-20")).toEqual(["tarde"]);
    expect(turnosDaGradeNaData(grade(), "2026-08-19")).toEqual([]);
  });

  it("oferece dia completo só quando os dois turnos estão marcados", () => {
    expect(turnosDaGradeNaData(gradeDiaCheio(), "2026-08-21")).toEqual(["manha", "tarde", "dia"]);
  });
});

describe("conferência da falta contra a grade", () => {
  it("aceita a falta no dia e turno escalados", () => {
    expect(conferirFalta(grade(), "2026-08-17", "manha")).toEqual({ ok: true });
    expect(conferirFalta(grade(), "2026-08-20", "tarde")).toEqual({ ok: true });
    expect(conferirFalta(gradeDiaCheio(), "2026-08-21", "dia")).toEqual({ ok: true });
  });

  it("recusa falta em dia da semana sem nenhum turno na grade", () => {
    const r = conferirFalta(grade(), "2026-08-19", "manha");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("dia_sem_turno");
      expect(r.mensagem).toContain("quarta");
    }
  });

  it("recusa o turno errado num dia escalado", () => {
    const r = conferirFalta(grade(), "2026-08-17", "tarde");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("turno_fora_da_grade");
      expect(r.mensagem).toContain("manhã");
    }
  });

  it("recusa dia completo quando a grade tem só um turno", () => {
    const r = conferirFalta(grade(), "2026-08-17", "dia");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("turno_fora_da_grade");
  });

  it("recusa fim de semana e data inválida", () => {
    const sabado = conferirFalta(grade(), "2026-08-22", "manha");
    expect(sabado.ok).toBe(false);
    if (!sabado.ok) expect(sabado.motivo).toBe("fim_de_semana");

    const invalida = conferirFalta(grade(), "", "manha");
    expect(invalida.ok).toBe(false);
    if (!invalida.ok) expect(invalida.motivo).toBe("data_invalida");
  });

  it("recusa qualquer falta quando a grade está vazia", () => {
    const r = conferirFalta(gradeVazia(), "2026-08-17", "manha");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("dia_sem_turno");
  });
});
