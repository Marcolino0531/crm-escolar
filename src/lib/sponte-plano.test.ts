import { describe, expect, it } from "vitest";
import { CATEGORIA_CANTINA_SPONTE, observacaoRecargaSponte, vencimentoRecarga } from "./cantina";
import { contaReceberCriada, montarParametrosInsertPlano } from "./sponte-plano";

function tag(xml: string, nome: string): string {
  return xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? "";
}

describe("conta a receber da recarga da cantina (InsertPlano)", () => {
  const hoje = "2026-08-18";

  const parcelaMensalidade = {
    contaReceberID: "9",
    numeroBoleto: "9",
    numeroParcela: "1",
    vencimento: "2026-09-10",
    categoria: "Mensalidade",
    saldo: 1200,
    quitada: false,
  };

  // Categoria/forma já resolvidas pelo Sponte (GetCategorias/GetFormasCobrancas);
  // os IDs padrão do Sponte são negativos.
  const params = (valor: number, vencimento: string) =>
    montarParametrosInsertPlano({
      sponteAlunoId: "12345",
      valor,
      vencimento,
      formaCobrancaId: -4,
      categoriaId: 777,
      observacao: observacaoRecargaSponte(hoje),
    });

  it("cobra o valor solicitado, em uma única parcela", () => {
    const xml = params(50, "2026-09-10");
    expect(tag(xml, "nValorParcelas")).toBe("50.00");
    expect(tag(xml, "nNumeroParcelas")).toBe("1");
  });

  it("mantém os centavos do valor pedido", () => {
    expect(tag(params(37.9, "2026-09-10"), "nValorParcelas")).toBe("37.90");
    expect(tag(params(150.55, "2026-09-10"), "nValorParcelas")).toBe("150.55");
  });

  it("usa a categoria resolvida no Sponte e o aluno da solicitação", () => {
    const xml = params(50, "2026-09-10");
    expect(tag(xml, "nCategoriaID")).toBe("777");
    expect(tag(xml, "nAlunoID")).toBe("12345");
    expect(tag(xml, "nFormaCobrancaID")).toBe("-4");
    expect(CATEGORIA_CANTINA_SPONTE).toBe("Cantina");
  });

  it("vence no dia da próxima mensalidade em aberto do aluno", () => {
    const { vencimento } = vencimentoRecarga([parcelaMensalidade], hoje);
    expect(tag(params(50, vencimento), "dDataPrimeiroVencimento")).toBe("2026-09-10T00:00:00");
  });

  it("sem mensalidade em aberto, vence no dia 5 do mês seguinte", () => {
    const { vencimento } = vencimentoRecarga([], hoje);
    expect(tag(params(50, vencimento), "dDataPrimeiroVencimento")).toBe("2026-09-05T00:00:00");
  });

  it("identifica a recarga na observação do título", () => {
    expect(tag(params(50, "2026-09-10"), "sObservacao")).toContain("18/08/2026");
  });

  it("não vincula a contrato, bolsa ou conta existente (título próprio)", () => {
    const xml = params(50, "2026-09-10");
    expect(tag(xml, "nContratoID")).toBe("0");
    expect(tag(xml, "nBolsaID")).toBe("0");
    expect(tag(xml, "nContaID")).toBe("0");
    expect(tag(xml, "nTipoPlano")).toBe("1");
  });
});

describe("confirmação do Sponte antes de reportar lançamento", () => {
  it("aceita conta a receber com ID positivo", () => {
    expect(contaReceberCriada("", "88123")).toBe(true);
  });

  it("aceita retorno explícito de sucesso", () => {
    expect(contaReceberCriada("Operação realizada com sucesso", "0")).toBe(true);
  });

  it("recusa resposta sem confirmação (não há falso sucesso)", () => {
    expect(contaReceberCriada("", "")).toBe(false);
    expect(contaReceberCriada("", "0")).toBe(false);
    expect(contaReceberCriada("", "-1")).toBe(false);
    expect(contaReceberCriada("Aluno não encontrado", "0")).toBe(false);
  });
});
