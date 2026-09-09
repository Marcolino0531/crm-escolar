import { describe, expect, it } from "vitest";
import {
  consolidarAluno,
  descreverItem,
  faturandoInterrompido,
  listarDatas,
  observacaoFaturamentoSponte,
  pendenciasPorAluno,
  podeAbrirFaturamento,
  podeCancelar,
  podeFaturar,
  podeIsentar,
  proximoVencimentoExtrasDiario,
  registroCancelamento,
  statusConsumoExtra,
  ROTULO_STATUS_CONSUMO,
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
      {
        categoria: "lunch",
        rotulo: "Almoço",
        quantidade: 2,
        precoUnitario: 25,
        valor: 50,
        datas: ["01/09/2026", "02/09/2026"],
      },
      {
        categoria: "snack",
        rotulo: "Lanche da Tarde",
        quantidade: 1,
        precoUnitario: 12.5,
        valor: 12.5,
        datas: ["01/09/2026"],
      },
      {
        categoria: "hora_extra",
        rotulo: "Hora Extra",
        quantidade: 75,
        precoUnitario: 40,
        valor: 50,
        datas: ["01/09/2026", "03/09/2026"],
        minutosPorRegistro: [45, 30],
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

describe("observação do título no Sponte — datas exatas, não período", () => {
  it("lista todas as datas da mesma categoria, na ordem em que aconteceram", () => {
    const precos: TabelaPrecos = { dinner: 25.5 };
    const p = consolidarAluno(
      [
        refeicao("a", "dinner", "2026-09-08"),
        refeicao("a", "dinner", "2026-09-03"),
        refeicao("a", "dinner", "2026-09-04"),
      ],
      precos,
    );
    expect(p.itens[0]?.datas).toEqual(["03/09/2026", "04/09/2026", "08/09/2026"]);
    expect(observacaoFaturamentoSponte(p.itens, p.total)).toBe(
      "Extras do Diário: Jantar em 03/09, 04/09 e 08/09/2026 — R$ 76,50",
    );
  });

  it("hora extra mostra a data e a duração de cada registro, não só o total", () => {
    const p = consolidarAluno(
      [horaExtra("a", 45, "2026-09-02"), horaExtra("a", 90, "2026-09-10"), refeicao("a", "lunch")],
      PRECOS_2026,
    );
    expect(observacaoFaturamentoSponte(p.itens, p.total)).toBe(
      "Extras do Diário: Almoço em 01/09/2026 — R$ 25,00; Hora Extra em 02/09 (45 min) e 10/09/2026 (1h30) = 2h15 — R$ 90,00. Total R$ 115,00",
    );
  });

  it("data no fuso da escola: registro às 23h BRT não vira o dia seguinte", () => {
    const [i] = consolidarAluno(
      [{ ...refeicao("a", "lunch"), createdAt: "2026-09-02T02:00:00.000Z" }],
      PRECOS_2026,
    ).itens;
    expect(i?.datas).toEqual(["01/09/2026"]);
  });

  it("datas em anos diferentes saem completas", () => {
    expect(listarDatas(["30/12/2026", "05/01/2027"])).toBe("30/12/2026 e 05/01/2027");
    expect(listarDatas(["03/09/2026"])).toBe("03/09/2026");
  });

  it("faturamento antigo (jsonb sem `datas`) continua descrito sem quebrar", () => {
    const antigoRefeicao = {
      categoria: "dinner" as const,
      rotulo: "Jantar",
      quantidade: 3,
      precoUnitario: 25.5,
      valor: 76.5,
    };
    const antigoHora = {
      categoria: "hora_extra" as const,
      rotulo: "Hora Extra",
      quantidade: 90,
      precoUnitario: 40,
      valor: 60,
    };
    expect(descreverItem(antigoRefeicao)).toBe("Jantar ×3");
    expect(descreverItem(antigoHora)).toBe("Hora Extra 1h30");
    expect(observacaoFaturamentoSponte([antigoRefeicao, antigoHora], 136.5)).toBe(
      "Extras do Diário: Jantar ×3 — R$ 76,50; Hora Extra 1h30 — R$ 60,00. Total R$ 136,50",
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

  it("cancelado não relança nem aceita marcação manual", () => {
    expect(transicaoFaturamento("cancelado", "lancar", true).ok).toBe(false);
    expect(transicaoFaturamento("cancelado", "marcar_manual", false).ok).toBe(false);
  });

  it("faturando antigo é considerado interrompido", () => {
    expect(faturandoInterrompido("2026-09-01T10:00:00Z", "2026-09-01T10:05:00Z")).toBe(false);
    expect(faturandoInterrompido("2026-09-01T10:00:00Z", "2026-09-01T10:11:00Z")).toBe(true);
  });
});

describe("isenção de consumo extra", () => {
  const precos = new Map([[2026, PRECOS_2026]]);

  it("evento isento nunca entra nas pendências de faturamento", () => {
    const isento = { ...refeicao("a1", "lunch"), isento: true };
    const cobravel = refeicao("a1", "lunch");
    const [p] = pendenciasPorAluno([isento, cobravel], precos);
    expect(p?.eventIds).toEqual([cobravel.id]);
    expect(p?.total).toBe(25);
  });

  it("aluno só com eventos isentos não gera pendência", () => {
    const so = { ...horaExtra("a2", 60), isento: true };
    expect(pendenciasPorAluno([so], precos)).toEqual([]);
  });

  it("não é possível isentar consumo que já tem faturamento_id", () => {
    for (const st of ["faturando", "erro", "lancado"] as const) {
      const t = podeIsentar({ isento: false, faturamentoId: "f1", faturamentoStatus: st });
      expect(t.ok).toBe(false);
      expect(t.erro).toMatch(/já entrou em um faturamento/);
    }
    expect(podeIsentar({ isento: false, faturamentoId: "f1", faturamentoStatus: null }).ok).toBe(
      false,
    );
  });

  it("consumo pendente pode ser isentado; já isento não repete", () => {
    expect(podeIsentar({ isento: false, faturamentoId: null, faturamentoStatus: null })).toEqual({
      ok: true,
    });
    expect(podeIsentar({ isento: true, faturamentoId: null, faturamentoStatus: null }).ok).toBe(
      false,
    );
  });

  it("status da aba Consumos Extras para cada combinação", () => {
    expect(
      statusConsumoExtra({ isento: false, faturamentoId: null, faturamentoStatus: null }),
    ).toBe("pendente");
    expect(
      statusConsumoExtra({ isento: false, faturamentoId: "f", faturamentoStatus: "faturando" }),
    ).toBe("faturando");
    expect(
      statusConsumoExtra({ isento: false, faturamentoId: "f", faturamentoStatus: "lancado" }),
    ).toBe("lancado");
    expect(
      statusConsumoExtra({ isento: false, faturamentoId: "f", faturamentoStatus: "erro" }),
    ).toBe("erro");
    expect(statusConsumoExtra({ isento: true, faturamentoId: null, faturamentoStatus: null })).toBe(
      "isento",
    );
    expect(ROTULO_STATUS_CONSUMO).toEqual({
      pendente: "Pendente",
      isento: "Isento",
      faturando: "Faturando",
      lancado: "Lançado",
      erro: "Erro no lançamento",
      cancelado: "Cancelado",
    });
  });
});

describe("cancelar faturamento lançado — volta para pendente sem apagar o histórico", () => {
  type Fat = {
    id: string;
    status: ReturnType<typeof registroCancelamento>["status"] | "lancado" | "erro" | "faturando";
  };
  type Ev = EventoExtra & { faturamentoId: string | null };
  const pendentes = (evs: readonly Ev[]) =>
    pendenciasPorAluno(
      evs.filter((e) => e.faturamentoId === null),
      new Map([[2026, PRECOS_2026]]),
    );

  it("só faturamento lançado pode ser cancelado; faturando/erro não mostram a ação", () => {
    expect(podeCancelar("lancado")).toEqual({ ok: true });
    expect(podeCancelar("faturando").ok).toBe(false);
    expect(podeCancelar("erro").ok).toBe(false);
    expect(podeCancelar("cancelado")).toEqual({
      ok: false,
      erro: "Este faturamento já foi cancelado.",
    });
  });

  it("cancelar libera os eventos para 'Pendentes de faturar' e permite faturar o aluno de novo", () => {
    const eventos: Ev[] = [
      { ...refeicao("a", "lunch"), faturamentoId: "f1" },
      { ...refeicao("a", "lunch", "2026-09-02"), faturamentoId: "f1" },
    ];
    const historico: Fat[] = [{ id: "f1", status: "lancado" }];
    expect(pendentes(eventos)).toEqual([]);

    // cancelamento: linha vira 'cancelado', eventos desvinculados
    const t = podeCancelar(historico[0].status);
    expect(t.ok).toBe(true);
    const registro = registroCancelamento("u1", "Diretor", "2026-09-10T12:00:00.000Z");
    historico[0] = { ...historico[0], ...registro };
    for (const e of eventos) if (e.faturamentoId === "f1") e.faturamentoId = null;

    const pend = pendentes(eventos);
    expect(pend).toHaveLength(1);
    expect(pend[0].eventIds).toEqual(eventos.map((e) => e.id));
    expect(pend[0].total).toBe(50);
    expect(podeFaturar(pend[0])).toBe(true);

    // linha cancelada não ocupa a vaga do índice único (status NOT IN lancado/cancelado)
    expect(historico).toHaveLength(1);
    expect(podeAbrirFaturamento(historico.map((h) => h.status))).toBe(true);
    expect(podeAbrirFaturamento(["lancado", "cancelado", "erro"])).toBe(false);
    expect(podeAbrirFaturamento(["lancado", "faturando"])).toBe(false);
  });

  it("histórico registra quem cancelou e quando", () => {
    expect(registroCancelamento("u1", "Diretor", "2026-09-10T12:00:00.000Z")).toEqual({
      status: "cancelado",
      cancelado_em: "2026-09-10T12:00:00.000Z",
      cancelado_por: "u1",
      cancelado_por_nome: "Diretor",
    });
    expect(ROTULO_STATUS_CONSUMO.cancelado).toBe("Cancelado");
  });
});

describe("vencimento do título dos Extras — sempre mês vigente + 1", () => {
  const parcela = (
    vencimento: string,
    quitada = false,
    categoria = "Mensalidade",
    saldo = 1200,
  ) => ({
    contaReceberID: `c-${vencimento}`,
    numeroBoleto: "1",
    numeroParcela: "1",
    vencimento,
    categoria,
    saldo,
    quitada,
  });

  it("mensalidade do mês corrente em aberto: mesmo assim cai no mês seguinte (Stella)", () => {
    const r = proximoVencimentoExtrasDiario(
      [parcela("2026-08-10", true), parcela("2026-09-10"), parcela("2026-10-10")],
      "2026-09-08",
    );
    expect(r).toEqual({ vencimento: "2026-10-13", origem: "dia_habitual" }); // 10/10/2026 é sábado
  });

  it("mensalidade do mês corrente já quitada: cai no mês seguinte (Tom, não regride)", () => {
    const r = proximoVencimentoExtrasDiario(
      [parcela("2026-08-05", true), parcela("2026-09-05", true), parcela("2026-10-05")],
      "2026-09-08",
    );
    expect(r).toEqual({ vencimento: "2026-10-05", origem: "dia_habitual" });
  });

  it("ignora a mensalidade futura mais próxima como referência (só o dia habitual conta)", () => {
    // Próxima em aberto é 20/09 (ainda neste mês) — não pode ser o vencimento.
    const r = proximoVencimentoExtrasDiario([parcela("2026-09-20")], "2026-09-08");
    expect(r.vencimento.startsWith("2026-10-")).toBe(true);
  });

  it("dezembro vira janeiro do ano seguinte", () => {
    const r = proximoVencimentoExtrasDiario([parcela("2026-12-10")], "2026-12-15");
    expect(r.vencimento).toBe("2027-01-11"); // 10/01/2027 é domingo
  });

  it("sem mensalidade de referência usa o dia padrão no mês seguinte", () => {
    const r = proximoVencimentoExtrasDiario([], "2026-09-08");
    expect(r.origem).toBe("padrao");
    expect(r.vencimento).toBe("2026-10-05");
    // Recarga de cantina não serve de referência de dia.
    expect(
      proximoVencimentoExtrasDiario([parcela("2026-09-22", false, "Cantina")], "2026-09-08").origem,
    ).toBe("padrao");
  });
});
