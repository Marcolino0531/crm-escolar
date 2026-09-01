import { describe, expect, it } from "vitest";
import {
  cobrancaPermitida,
  ehMensalidade,
  envioLiberado,
  filtrarPorRegraDeCobranca,
  menorDataBaseCobranca,
  regraCobrancaDaUnidade,
  unidadeAtendida,
  unidadesAtendidas,
} from "./billing-unidades";
import { parcelasCobraveis, type ParcelaCobranca } from "./billing-recurrence";
import { vencimentosLembreteHoje } from "./billing-reminders";

const MENSALIDADE = ["Mensalidade"];

describe("corte de setembro/2026 na cobrança de Belvedere e Vale do Sereno", () => {
  it("rejeita vencimento anterior ao corte no Núcleo Belvedere", () => {
    expect(
      cobrancaPermitida({
        unidade: "Núcleo Belvedere",
        vencimento: "2026-08-31",
        categorias: MENSALIDADE,
      }),
    ).toBe(false);
  });

  it("aceita mensalidade a partir do corte no Núcleo Belvedere", () => {
    expect(
      cobrancaPermitida({
        unidade: "Núcleo Belvedere",
        vencimento: "2026-09-01",
        categorias: MENSALIDADE,
      }),
    ).toBe(true);
  });

  it("aplica o mesmo corte ao Núcleo Vale do Sereno", () => {
    expect(
      cobrancaPermitida({
        unidade: "Núcleo Vale do Sereno",
        vencimento: "2026-08-15",
        categorias: MENSALIDADE,
      }),
    ).toBe(false);
    expect(
      cobrancaPermitida({
        unidade: "Núcleo Vale do Sereno",
        vencimento: "2026-10-05",
        categorias: MENSALIDADE,
      }),
    ).toBe(true);
  });

  it("exclui parcela que não é mensalidade, mesmo depois do corte", () => {
    expect(
      cobrancaPermitida({
        unidade: "Núcleo Belvedere",
        vencimento: "2026-09-10",
        categorias: ["Material Didático"],
      }),
    ).toBe(false);
    expect(cobrancaPermitida({ unidade: "Núcleo Belvedere", vencimento: "2026-09-10" })).toBe(
      false,
    );
  });

  it("mantém o boleto que reúne mensalidade e outros itens", () => {
    expect(
      cobrancaPermitida({
        unidade: "Núcleo Vale do Sereno",
        vencimento: "2026-09-10",
        categorias: ["Almoço", "Mensalidade"],
      }),
    ).toBe(true);
  });

  it("reconhece a categoria sem acento e em caixa diferente", () => {
    expect(ehMensalidade(["MENSALIDADE ESCOLAR"])).toBe(true);
    expect(ehMensalidade(["Acordo"])).toBe(false);
    expect(ehMensalidade([])).toBe(false);
  });
});

describe("política de produção do CEC e CEC Baby", () => {
  it("segue cobrando a partir de 01/08/2026, em qualquer categoria", () => {
    expect(regraCobrancaDaUnidade("CEC")).toEqual({
      dataBase: "2026-08-01",
      somenteMensalidade: false,
    });
    expect(
      cobrancaPermitida({ unidade: "CEC", vencimento: "2026-08-01", categorias: ["Material"] }),
    ).toBe(true);
    expect(
      cobrancaPermitida({ unidade: "CEC Baby", vencimento: "2026-08-20", categorias: ["Almoço"] }),
    ).toBe(true);
    expect(cobrancaPermitida({ unidade: "CEC", vencimento: "2026-07-31" })).toBe(false);
  });

  it("não cobra unidade fora dos dois números", () => {
    expect(cobrancaPermitida({ unidade: "Outra Escola", vencimento: "2026-12-01" })).toBe(false);
  });
});

describe("seleção de parcelas cobráveis com as duas políticas juntas", () => {
  const base = { alunoNome: "Aluno", telefone: "31999990000", responsavelNome: "Responsável" };
  const parcelas: ParcelaCobranca[] = [
    {
      ...base,
      alunoId: "1",
      unidade: "Núcleo Belvedere",
      vencimento: "2026-08-31",
      saldo: 1000,
      categorias: MENSALIDADE,
    },
    {
      ...base,
      alunoId: "2",
      unidade: "Núcleo Belvedere",
      vencimento: "2026-09-01",
      saldo: 1000,
      categorias: MENSALIDADE,
    },
    {
      ...base,
      alunoId: "3",
      unidade: "Núcleo Vale do Sereno",
      vencimento: "2026-09-02",
      saldo: 1000,
      categorias: ["Material"],
    },
    {
      ...base,
      alunoId: "4",
      unidade: "CEC",
      vencimento: "2026-08-05",
      saldo: 1000,
      categorias: ["Material"],
    },
  ];

  it("mantém só o que cada unidade autoriza", () => {
    expect(filtrarPorRegraDeCobranca(parcelas).map((p) => p.alunoId)).toEqual(["2", "4"]);
  });

  it("continua exigindo a tolerância de dias úteis depois do filtro por unidade", () => {
    // 01/09/2026 é terça; a tolerância de 2 dias úteis só vence em 03/09.
    expect(
      parcelasCobraveis(filtrarPorRegraDeCobranca(parcelas), "2026-09-02").map((p) => p.alunoId),
    ).toEqual(["4"]);
    expect(
      parcelasCobraveis(filtrarPorRegraDeCobranca(parcelas), "2026-09-03").map((p) => p.alunoId),
    ).toEqual(["2", "4"]);
  });
});

describe("régua preventiva de lembrete", () => {
  it("não usa o corte de cobrança: lembra vencimentos anteriores a setembro", () => {
    // Os prazos D-5/D-3/D-0 saem só do dia corrente — nenhuma data base entra na conta.
    expect(
      vencimentosLembreteHoje("2026-08-20")
        .map((p) => p.venc)
        .sort(),
    ).toEqual(["2026-08-20", "2026-08-23", "2026-08-25"]);
  });
});

describe("escopo de unidades e liberação de envio", () => {
  it("resolve as unidades de cada número", () => {
    expect([...unidadesAtendidas(["belvedere"])]).toEqual([
      "Núcleo Belvedere",
      "Núcleo Vale do Sereno",
    ]);
    expect(unidadeAtendida("CEC Baby", ["cec"])).toBe(true);
    expect(unidadeAtendida("CEC Baby", ["belvedere"])).toBe(false);
  });

  it("mantém o envio real de Belvedere bloqueado até a liberação explícita", () => {
    expect(envioLiberado("cec")).toBe(true);
    expect(envioLiberado("belvedere")).toBe(false);
  });

  it("usa a data base mais antiga entre os grupos avaliados", () => {
    expect(menorDataBaseCobranca(["belvedere"])).toBe("2026-09-01");
    expect(menorDataBaseCobranca(["cec", "belvedere"])).toBe("2026-08-01");
  });
});
