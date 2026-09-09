import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchedulePlan } from "@/lib/diario";
import { avaliarRegistro } from "@/lib/diario-hora-extra";
import {
  dataInicialDoModal,
  diaDaSemana,
  ehHoje,
  horaSugerida,
  horaValida,
  instanteDaPonta,
  podeExcluirRegistro,
  instanteDaRefeicao,
  instanteEm,
  intervaloDoDia,
  ymdLocal,
} from "@/lib/diario-registro-retroativo";

// "Hoje" fixo: quinta-feira 2026-09-10, 15h20.
const AGORA = new Date(2026, 8, 10, 15, 20, 0, 0);
const HOJE = "2026-09-10";
// Segunda-feira anterior.
const SEGUNDA = "2026-09-07";

afterEach(() => vi.useRealTimers());

describe("data do registro — padrão hoje", () => {
  it("dataInicialDoModal devolve a data local de hoje (padrão ao abrir/trocar de aluno)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    expect(dataInicialDoModal()).toBe(HOJE);
    expect(ehHoje(HOJE, AGORA)).toBe(true);
    expect(ehHoje(SEGUNDA, AGORA)).toBe(false);
  });

  it("reabrir o modal em outro dia volta para o novo hoje, não para a data antes escolhida", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    const primeiraAbertura = dataInicialDoModal();
    vi.setSystemTime(new Date(2026, 8, 11, 8, 0));
    expect(dataInicialDoModal()).toBe("2026-09-11");
    expect(primeiraAbertura).toBe(HOJE);
  });

  it("ymdLocal não sofre deslocamento de fuso perto da meia-noite", () => {
    expect(ymdLocal(new Date(2026, 8, 10, 23, 59))).toBe(HOJE);
    expect(ymdLocal(new Date(2026, 8, 10, 0, 0))).toBe(HOJE);
  });
});

describe("dia da semana da data selecionada", () => {
  it("usa o fuso local (2026-09-07 é segunda, não domingo por UTC)", () => {
    expect(diaDaSemana(SEGUNDA)).toBe(1);
    expect(diaDaSemana("2026-09-06")).toBe(0);
    expect(diaDaSemana(HOJE)).toBe(4);
  });
});

describe("refeição retroativa", () => {
  it("em data passada grava ao meio-dia da data selecionada, não hoje", () => {
    const em = instanteDaRefeicao(SEGUNDA, AGORA);
    expect(ymdLocal(em)).toBe(SEGUNDA);
    expect(em.getHours()).toBe(12);
    expect(em.getMinutes()).toBe(0);
  });

  it("em hoje grava o momento atual", () => {
    expect(instanteDaRefeicao(HOJE, AGORA).getTime()).toBe(AGORA.getTime());
  });
});

describe("entrada/saída retroativa", () => {
  const DIA_SEG = { entry: "13:00", exit: "17:30" };
  const DIA_QUI = { entry: "08:00", exit: "12:00" };
  const plano: SchedulePlan = {
    0: null,
    1: DIA_SEG,
    2: null,
    3: null,
    4: DIA_QUI,
    5: null,
    6: null,
  };

  it("hoje sem hora informada usa o momento atual", () => {
    expect(instanteDaPonta(HOJE, null, AGORA)?.getTime()).toBe(AGORA.getTime());
  });

  it("data passada sem hora não permite registrar", () => {
    expect(instanteDaPonta(SEGUNDA, null, AGORA)).toBeNull();
    expect(instanteDaPonta(SEGUNDA, "25:00", AGORA)).toBeNull();
    expect(instanteDaPonta(SEGUNDA, "9h", AGORA)).toBeNull();
  });

  it("data passada com hora combina data + hora no fuso local", () => {
    const em = instanteDaPonta(SEGUNDA, "18:15", AGORA)!;
    expect(ymdLocal(em)).toBe(SEGUNDA);
    expect(em.getHours()).toBe(18);
    expect(em.getMinutes()).toBe(15);
    expect(instanteEm(SEGUNDA, "07:05").getHours()).toBe(7);
  });

  it("hora extra usa o horário contratado do dia da semana da data escolhida, não o de hoje", () => {
    // Saída 18h15 na segunda (contratado 17:30 + 30 min) => 15 min.
    const seg = avaliarRegistro(plano, "saida", instanteDaPonta(SEGUNDA, "18:15", AGORA)!);
    expect(seg).toMatchObject({ temHorario: true, minutos: 15, cobra: true });
    // A mesma hora em hoje (quinta, contratado até 12:00) => 5h45 de excedente.
    const qui = avaliarRegistro(plano, "saida", instanteDaPonta(HOJE, "18:15", AGORA)!);
    expect(qui.minutos).toBe(6 * 60 + 15 - 30);
    // Entrada 12h30 na segunda (13:00 − 15 min) => 15 min; em terça (sem horário) => conferência manual.
    expect(avaliarRegistro(plano, "entrada", instanteEm(SEGUNDA, "12:30")).minutos).toBe(15);
    expect(avaliarRegistro(plano, "entrada", instanteEm("2026-09-08", "12:30"))).toMatchObject({
      temHorario: false,
      minutos: null,
      cobra: true,
    });
  });

  it("horaValida aceita só HH:MM dentro do relógio", () => {
    expect(horaValida("00:00")).toBe(true);
    expect(horaValida("23:59")).toBe(true);
    expect(horaValida("24:00")).toBe(false);
    expect(horaValida("12:60")).toBe(false);
    expect(horaValida("")).toBe(false);
  });
});

describe("histórico do dia selecionado", () => {
  it("intervaloDoDia cobre do início ao fim da data escolhida no fuso local", () => {
    const { inicio, fim } = intervaloDoDia(SEGUNDA);
    const i = new Date(inicio);
    const f = new Date(fim);
    expect(ymdLocal(i)).toBe(SEGUNDA);
    expect(ymdLocal(f)).toBe(SEGUNDA);
    expect(i.getHours()).toBe(0);
    expect(f.getHours()).toBe(23);
    expect(f.getMinutes()).toBe(59);
    // Um registro ao meio-dia da segunda cai dentro; o de terça 00:00 fica fora.
    const meioDia = instanteEm(SEGUNDA, "12:00").toISOString();
    expect(meioDia >= inicio && meioDia <= fim).toBe(true);
    expect(instanteEm("2026-09-08", "00:00").toISOString() > fim).toBe(true);
  });
});

describe("hora manual também hoje", () => {
  it("horaSugerida é o agora em HH:MM (só sugestão, editável)", () => {
    expect(horaSugerida(AGORA)).toBe("15:20");
    expect(horaSugerida(new Date(2026, 8, 10, 7, 5))).toBe("07:05");
  });

  it("Entrada hoje com hora editada grava a hora digitada, não a do clique", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA); // clique às 15:20
    const em = instanteDaPonta(HOJE, "07:50");
    expect(em).not.toBeNull();
    expect(em!.getHours()).toBe(7);
    expect(em!.getMinutes()).toBe(50);
    expect(ymdLocal(em!)).toBe(HOJE);
    // Hora extra calculada pelo horário digitado (contratada 08:00, 15 min de tolerância → 0).
    const schedule: SchedulePlan = {
      0: null,
      1: null,
      2: null,
      3: null,
      4: { entry: "08:00", exit: "17:30" },
      5: null,
      6: null,
    };
    expect(avaliarRegistro(schedule, "entrada", em!).minutos).toBe(0);
    expect(avaliarRegistro(schedule, "entrada", instanteDaPonta(HOJE, "07:20")!).minutos).toBe(25);
  });
});

describe("excluir registro do histórico do dia", () => {
  it("evento já faturado (ou em faturamento) é bloqueado", () => {
    const r = podeExcluirRegistro({ faturamento_id: "fat-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/faturamento/i);
  });

  it("evento pendente pode ser excluído e some do histórico", () => {
    expect(podeExcluirRegistro({ faturamento_id: null })).toEqual({ ok: true });
    const historico = [
      { id: "a", faturamento_id: null },
      { id: "b", faturamento_id: "fat-1" },
    ];
    const excluiveis = historico.filter((ev) => podeExcluirRegistro(ev).ok);
    expect(excluiveis.map((e) => e.id)).toEqual(["a"]);
    const depois = historico.filter((ev) => ev.id !== "a");
    expect(depois.map((e) => e.id)).toEqual(["b"]);
  });
});
