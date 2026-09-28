import { describe, expect, it } from "vitest";
import {
  acompanharAcordo,
  avisosAcordoPendentes,
  chaveParcelaSponte,
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
    chave: id,
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

describe("chave da parcela do Sponte", () => {
  it("ContaReceberID + NumeroParcela; fallback NumeroBoleto; depois conta + vencimento + valor", () => {
    const b = { contaReceberID: "555", vencimento: "2026-10-05", valor: 1498.88 };
    expect(chaveParcelaSponte({ ...b, numeroParcela: "3", numeroBoleto: "9" })).toBe("555#3");
    expect(chaveParcelaSponte({ ...b, numeroParcela: "", numeroBoleto: "9" })).toBe("bol_9");
    expect(chaveParcelaSponte({ ...b, numeroParcela: "", numeroBoleto: "0" })).toBe(
      "555|2026-10-05|149888",
    );
  });
});

describe("caso real: Termo nº 18, 5 parcelas na mesma Conta a Receber (1.3)", () => {
  const termo18: ParcelaTermo[] = [
    { numero: 1, valor: 1498.88, vencimento: "2026-10-05" },
    { numero: 2, valor: 1498.88, vencimento: "2026-11-05" },
    { numero: 3, valor: 1498.88, vencimento: "2026-12-07" },
    { numero: 4, valor: 1498.88, vencimento: "2027-01-05" },
    { numero: 5, valor: 1498.88, vencimento: "2027-02-05" },
  ];
  const sponte18 = (quitadas: number) =>
    termo18.map((p) => {
      const q = p.numero <= quitadas;
      return {
        chave: chaveParcelaSponte({
          contaReceberID: "81234",
          numeroParcela: String(p.numero),
          vencimento: p.vencimento,
          valor: p.valor,
        }),
        contaReceberID: "81234",
        alunoId: "1001",
        vencimento: p.vencimento,
        valor: 1498.88,
        valorPago: q ? 1498.88 : 0,
        saldo: q ? 0 : 1498.88,
        quitada: q,
        dataPagamento: q ? p.vencimento : "",
      } satisfies ParcelaAcordoSponte;
    });

  it("nenhuma paga: as 5 pareadas, total 7.494,40, pago 0, saldo 7.494,40", () => {
    const a = acompanharAcordo(termo18, sponte18(0), "2026-09-28");
    expect(a.parcelas.map((p) => p.situacao)).toEqual(Array(5).fill("a_vencer"));
    expect(a.temNaoEncontrada).toBe(false);
    expect(a.totalAcordo).toBe(7494.4);
    expect(a.totalPago).toBe(0);
    expect(a.saldoRestante).toBe(7494.4);
    expect(a.quitado).toBe(false);
  });

  it("parcelas 1 e 2 quitadas: pago 2.997,76, saldo 4.496,64, não encerra", () => {
    const a = acompanharAcordo(termo18, sponte18(2), "2026-11-10");
    expect(a.temNaoEncontrada).toBe(false);
    expect(a.totalPago).toBe(2997.76);
    expect(a.saldoRestante).toBe(4496.64);
    expect(a.quitado).toBe(false);
    expect(a.proximaParcela?.numero).toBe(3);
  });

  it("as 5 quitadas: encerra (quitado) com motivo 'pago'", () => {
    const a = acompanharAcordo(termo18, sponte18(5), "2027-02-10");
    expect(a.quitado).toBe(true);
    expect(a.saldoRestante).toBe(0);
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
