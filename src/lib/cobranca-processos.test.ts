import { describe, expect, it } from "vitest";

import {
  agregarPorUnidade,
  avisosPrazoPendentes,
  marcoDoPrazo,
  painelProcesso,
  saldoProcesso,
  sugestaoValorCausa,
  textoAvisoPrazo,
  totalDoNomeDemonstrativo,
  totalRecebido,
  type PrazoAndamento,
} from "@/lib/cobranca-processos";

describe("controle processual — valores", () => {
  it("total recebido soma recebimentos de vários tipos com 2 casas", () => {
    const total = totalRecebido([
      { valor: 100.1 },
      { valor: 250.25 },
      { valor: 33.333 },
      { valor: "0.007" as unknown as number },
    ]);
    expect(total).toBe(383.69);
  });

  it("saldo = valor da causa − recebido, inclusive negativo", () => {
    expect(saldoProcesso(1000, 400.5)).toBe(599.5);
    expect(saldoProcesso(1000, 1200.75)).toBe(-200.75);
    const painel = painelProcesso({ valor_causa: 1000 }, [{ valor: 700 }, { valor: 500 }]);
    expect(painel).toEqual({
      valorCausa: 1000,
      totalRecebido: 1200,
      saldo: -200,
      acimaDaCausa: true,
    });
  });

  it("sugestão do valor da causa usa o demonstrativo mais recente; senão valor_inicial", () => {
    const caso = { valor_inicial: 1500 };
    expect(sugestaoValorCausa(caso, [])).toBe(1500);
    expect(
      sugestaoValorCausa(caso, [
        { created_at: "2026-09-01T10:00:00Z", total: 1600.1 },
        { created_at: "2026-10-05T10:00:00Z", total: 1723.45 },
        { created_at: "2026-09-20T10:00:00Z", total: null },
      ]),
    ).toBe(1723.45);
    expect(totalDoNomeDemonstrativo("Demonstrativo em 05/10/2026 — total R$ 1.723,45")).toBe(
      1723.45,
    );
    expect(totalDoNomeDemonstrativo("Demonstrativo")).toBeNull();
  });

  it("agrega por unidade só os casos em processo, excluindo encerrados", () => {
    const agg = agregarPorUnidade([
      { unidade: "CEC", status: "processo", valor_causa: 1000, recebimentos: [{ valor: 100 }] },
      { unidade: "CEC", status: "processo", valor_causa: 2000.5, recebimentos: [{ valor: 50.25 }] },
      { unidade: "CEC", status: "encerrado", valor_causa: 9999, recebimentos: [{ valor: 9999 }] },
      { unidade: "CEC Baby", status: "processo", valor_causa: 300, recebimentos: [] },
      {
        unidade: "Núcleo Belvedere",
        status: "aguardando_prazo",
        valor_causa: 700,
        recebimentos: [],
      },
    ]);
    expect(agg).toEqual([
      { unidade: "CEC", casos: 2, valorCausa: 3000.5, totalRecebido: 150.25, saldo: 2850.25 },
      { unidade: "CEC Baby", casos: 1, valorCausa: 300, totalRecebido: 0, saldo: 300 },
    ]);
  });
});

describe("controle processual — avisos de prazo", () => {
  const base: PrazoAndamento = {
    andamentoId: "a1",
    casoId: "c1",
    unidade: "CEC",
    responsavelNome: "Maria",
    numeroProcesso: null,
    tipo: "audiencia",
    prazoData: "2026-10-10",
    prazoDescricao: "Audiência de conciliação",
    casoStatus: "processo",
  };

  it("marcos 5/3/1 por dias corridos", () => {
    expect(marcoDoPrazo("2026-10-10", "2026-10-05")).toBe(5);
    expect(marcoDoPrazo("2026-10-10", "2026-10-06")).toBe(5);
    expect(marcoDoPrazo("2026-10-10", "2026-10-07")).toBe(3);
    expect(marcoDoPrazo("2026-10-10", "2026-10-08")).toBe(3);
    expect(marcoDoPrazo("2026-10-10", "2026-10-09")).toBe(1);
    expect(marcoDoPrazo("2026-10-10", "2026-10-10")).toBe(1);
    expect(marcoDoPrazo("2026-10-10", "2026-10-04")).toBeNull();
    expect(marcoDoPrazo("2026-10-10", "2026-10-11")).toBeNull();
  });

  it("dispensa por marco e exclusão de casos encerrados; texto do aviso", () => {
    const avisos = avisosPrazoPendentes(
      [base, { ...base, andamentoId: "a2", casoStatus: "encerrado" }],
      [{ andamentoId: "a1", marco: 5 }],
      "2026-10-07",
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].marco).toBe(3);
    expect(textoAvisoPrazo(avisos[0])).toBe(
      "Audiência em 3 dias, 10/10: Maria, processo sem número, Audiência de conciliação",
    );
    expect(avisosPrazoPendentes([base], [{ andamentoId: "a1", marco: 3 }], "2026-10-07")).toEqual(
      [],
    );
    const hoje = avisosPrazoPendentes(
      [
        {
          ...base,
          tipo: "citacao",
          numeroProcesso: "0001234-56.2026.8.13.0024",
          prazoDescricao: null,
        },
      ],
      [],
      "2026-10-10",
    );
    expect(textoAvisoPrazo(hoje[0])).toBe(
      "Prazo hoje, 10/10: Maria, processo 0001234-56.2026.8.13.0024",
    );
  });
});
