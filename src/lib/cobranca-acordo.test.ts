import { describe, expect, it } from "vitest";
import {
  acompanharAcordo,
  avisosAcordoPendentes,
  parearParcelasAcordo,
  valorCausaAcordo,
  type ParcelaAcordoSponte,
} from "./cobranca-acordo";
import type { ParcelaTermo } from "./confissao-divida";

const termo: ParcelaTermo[] = [
  { numero: 1, valor: 1000, vencimento: "2026-10-01" },
  { numero: 2, valor: 1000, vencimento: "2026-11-01" },
  { numero: 3, valor: 1000, vencimento: "2026-12-01" },
];

function sp(
  id: string,
  vencimento: string,
  o: Partial<ParcelaAcordoSponte> = {},
): ParcelaAcordoSponte {
  return {
    contaReceberID: id,
    alunoId: "707",
    vencimento,
    valor: 1000,
    valorPago: 0,
    saldo: 1000,
    quitada: false,
    dataPagamento: "",
    ...o,
  };
}

describe("pareamento termo × Sponte", () => {
  it("casa por valor em centavos e vencimento a até 5 dias, sem reutilizar título", () => {
    const sponte = [
      sp("a", "2026-10-02"),
      sp("b", "2026-11-03"),
      sp("c", "2026-12-08"), // 7 dias: fora da tolerância
      sp("d", "2026-11-01", { valor: 999.99, saldo: 999.99 }),
    ];
    const pares = parearParcelasAcordo(termo, sponte);
    expect(pares.get(1)?.contaReceberID).toBe("a");
    expect(pares.get(2)?.contaReceberID).toBe("b");
    expect(pares.has(3)).toBe(false);
  });

  it("escolhe o candidato mais próximo e cada título só uma vez", () => {
    const t = [
      { numero: 1, valor: 500, vencimento: "2026-10-05" },
      { numero: 2, valor: 500, vencimento: "2026-10-07" },
    ];
    const sponte = [
      sp("x", "2026-10-07", { valor: 500, saldo: 500 }),
      sp("y", "2026-10-04", { valor: 500, saldo: 500 }),
    ];
    const pares = parearParcelasAcordo(t, sponte);
    expect(pares.get(1)?.contaReceberID).toBe("y");
    expect(pares.get(2)?.contaReceberID).toBe("x");
  });
});

describe("acompanhamento do acordo (6.1 / 6.2)", () => {
  it("1 de 3 quitada: pago 1.000, saldo 2.000, não encerra", () => {
    const a = acompanharAcordo(
      termo,
      [
        sp("a", "2026-10-01", {
          quitada: true,
          valorPago: 1000,
          saldo: 0,
          dataPagamento: "2026-09-30",
        }),
        sp("b", "2026-11-03"),
        sp("c", "2026-12-01"),
      ],
      "2026-10-15",
    );
    expect(a.totalAcordo).toBe(3000);
    expect(a.totalPago).toBe(1000);
    expect(a.saldoRestante).toBe(2000);
    expect(a.quitado).toBe(false);
    expect(a.parcelas.map((p) => p.situacao)).toEqual(["paga", "a_vencer", "a_vencer"]);
    expect(a.proximaParcela?.numero).toBe(2);
  });

  it("todas quitadas: encerra (quitado)", () => {
    const a = acompanharAcordo(
      termo,
      ["a", "b", "c"].map((id, i) =>
        sp(id, termo[i].vencimento, {
          quitada: true,
          valorPago: 1000,
          saldo: 0,
          dataPagamento: termo[i].vencimento,
        }),
      ),
      "2027-01-10",
    );
    expect(a.quitado).toBe(true);
    expect(a.saldoRestante).toBe(0);
    expect(a.proximaParcela).toBeNull();
  });

  it("uma paga parcialmente (600 de 1.000): saldo 400 naquela parcela e não encerra", () => {
    const a = acompanharAcordo(
      termo,
      [
        sp("a", "2026-10-01", {
          quitada: true,
          valorPago: 1000,
          saldo: 0,
          dataPagamento: "2026-10-01",
        }),
        sp("b", "2026-11-01", {
          quitada: true,
          valorPago: 1000,
          saldo: 0,
          dataPagamento: "2026-11-01",
        }),
        sp("c", "2026-12-01", { valorPago: 600, saldo: 400 }),
      ],
      "2026-12-05",
    );
    expect(a.quitado).toBe(false);
    expect(a.parcelas[2].situacao).toBe("paga_parcialmente");
    expect(a.parcelas[2].saldo).toBe(400);
    expect(a.saldoRestante).toBe(400);
    expect(a.totalPago).toBe(2600);
    expect(a.parcelas[2].diasAtraso).toBe(4);
  });

  it("marca atraso em dias e parcela não encontrada", () => {
    const a = acompanharAcordo(termo, [sp("a", "2026-10-01")], "2026-10-21");
    expect(a.parcelas[0].situacao).toBe("em_atraso");
    expect(a.parcelas[0].diasAtraso).toBe(20);
    expect(a.parcelas[1].situacao).toBe("nao_encontrada");
    expect(a.temNaoEncontrada).toBe(true);
    expect(a.maiorAtrasoDias).toBe(20);
  });
});

describe("valor da causa do acordo quebrado (6.3 / 6.4)", () => {
  const sponte = [sp("a", "2026-10-01"), sp("b", "2026-11-01"), sp("c", "2026-12-01")];

  it("2026-10-21: 1.026,67 + 2.000,00 + 600,00 = 3.626,67", () => {
    const v = valorCausaAcordo(acompanharAcordo(termo, sponte, "2026-10-21"), "2026-10-21");
    expect(v.vencidasAtualizadas).toBe(1026.67);
    expect(v.vincendas).toBe(2000);
    expect(v.clausulaPenal).toBe(600);
    expect(v.total).toBe(3626.67);
    expect(v.nota).toBe("sem correção monetária");
  });

  it("2026-10-11: 1.023,33 + 2.000,00 + 0 = 3.023,33", () => {
    const v = valorCausaAcordo(acompanharAcordo(termo, sponte, "2026-10-11"), "2026-10-11");
    expect(v.vencidasAtualizadas).toBe(1023.33);
    expect(v.vincendas).toBe(2000);
    expect(v.clausulaPenal).toBe(0);
    expect(v.total).toBe(3023.33);
  });
});

describe("avisos de atraso no sino", () => {
  it("marco 1 no 1º dia, marco 15 depois de 15 dias, respeitando dispensados", () => {
    const base = { casoId: "c1", unidade: "CEC", responsavelNome: "Fulano", numeroTermo: 7 };
    const a1 = acompanharAcordo(termo, [sp("a", "2026-10-01")], "2026-10-02");
    expect(avisosAcordoPendentes([{ ...base, acompanhamento: a1 }], [])).toMatchObject([
      { parcelaNumero: 1, marco: 1, diasAtraso: 1 },
    ]);
    const a16 = acompanharAcordo(termo, [sp("a", "2026-10-01")], "2026-10-17");
    expect(avisosAcordoPendentes([{ ...base, acompanhamento: a16 }], [])).toMatchObject([
      { parcelaNumero: 1, marco: 15, diasAtraso: 16 },
    ]);
    expect(
      avisosAcordoPendentes(
        [{ ...base, acompanhamento: a16 }],
        [{ casoId: "c1", parcelaNumero: 1, marco: 15 }],
      ),
    ).toEqual([]);
  });
});
