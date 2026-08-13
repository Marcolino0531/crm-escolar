import { describe, expect, it } from "vitest";
import {
  calcularRepasse,
  mesmaCategoria,
  modalidadesVisiveis,
  pagamentoDoAluno,
  parcelasDaModalidade,
  podeVerModalidade,
  restritoPorModalidade,
  totalArrecadado,
  type ParcelaSponte,
} from "./esportes-repasse";

function parcela(over: Partial<ParcelaSponte> = {}): ParcelaSponte {
  return {
    vencimento: "2026-08-10",
    categoria: "Teatro",
    valorPago: 200,
    quitada: true,
    dataPagamento: "2026-08-08",
    ...over,
  };
}

describe("identificação da categoria da modalidade no boleto", () => {
  it("casa a categoria ignorando acento, caixa e espaço", () => {
    expect(mesmaCategoria("Jiu Jitsu", "jiujitsu")).toBe(true);
    expect(mesmaCategoria("JIU-JÍTSU", "Jiu Jitsu")).toBe(true);
    expect(mesmaCategoria("Teatro", "Jazz")).toBe(false);
    expect(mesmaCategoria("", "Teatro")).toBe(false);
  });

  it("separa as parcelas da modalidade das outras categorias e dos outros meses", () => {
    const parcelas = [
      parcela({ categoria: "Mensalidade", valorPago: 1500 }),
      parcela({ categoria: "Teatro", valorPago: 200 }),
      parcela({ categoria: "Teatro", valorPago: 200, vencimento: "2026-09-10" }),
      parcela({ categoria: "Material Pedagógico", valorPago: 90 }),
    ];
    const doMes = parcelasDaModalidade(parcelas, "Teatro", "2026-08");
    expect(doMes).toHaveLength(1);
    expect(doMes[0].valorPago).toBe(200);
  });
});

describe("valor pago por aluno na modalidade", () => {
  const aluno = { alunoId: "862", alunoNome: "Luísa Mascarenhas Batista" };

  it("soma apenas parcelas quitadas da categoria no mês", () => {
    const pago = pagamentoDoAluno(
      aluno,
      [
        parcela({ valorPago: 200 }),
        parcela({ valorPago: 50, dataPagamento: "2026-08-20" }),
        parcela({ valorPago: 0, quitada: false, dataPagamento: "" }),
      ],
      "Teatro",
      "2026-08",
    );
    expect(pago.valorPago).toBe(250);
    // Data exibida é a do último pagamento identificado no mês.
    expect(pago.dataPagamento).toBe("2026-08-20");
  });

  it("aluno com a parcela da modalidade em aberto não arrecada nada", () => {
    const pago = pagamentoDoAluno(
      aluno,
      [parcela({ valorPago: 0, quitada: false, dataPagamento: "" })],
      "Teatro",
      "2026-08",
    );
    expect(pago.valorPago).toBe(0);
    expect(pago.dataPagamento).toBe("");
  });

  it("pagamento atrasado continua no mês do vencimento", () => {
    const pago = pagamentoDoAluno(
      aluno,
      [parcela({ vencimento: "2026-08-10", dataPagamento: "2026-09-03" })],
      "Teatro",
      "2026-08",
    );
    expect(pago.valorPago).toBe(200);
    expect(pago.dataPagamento).toBe("2026-09-03");
  });
});

describe("arrecadação e repasse da modalidade", () => {
  it("soma o arrecadado de todos os alunos matriculados", () => {
    const pagamentos = [
      { alunoId: "1", alunoNome: "A", valorPago: 200, dataPagamento: "2026-08-05" },
      { alunoId: "2", alunoNome: "B", valorPago: 200, dataPagamento: "2026-08-07" },
      { alunoId: "3", alunoNome: "C", valorPago: 0, dataPagamento: "" },
    ];
    expect(totalArrecadado(pagamentos)).toBe(400);
  });

  it("aplica o percentual contratual do parceiro", () => {
    expect(calcularRepasse(1000, 70)).toEqual({
      valorArrecadado: 1000,
      percentualParceiro: 70,
      valorRepasse: 700,
      valorRetido: 300,
    });
  });

  it("percentuais diferentes por parceiro sobre a mesma arrecadação", () => {
    expect(calcularRepasse(2400, 60).valorRepasse).toBe(1440);
    expect(calcularRepasse(2400, 85).valorRepasse).toBe(2040);
    expect(calcularRepasse(2400, 85).valorRetido).toBe(360);
  });

  it("repasse + retido fecham exatamente com o arrecadado em valor quebrado", () => {
    const r = calcularRepasse(333.33, 33.33);
    expect(r.valorRepasse).toBe(111.1);
    expect(r.valorRetido).toBe(222.23);
    expect(r.valorRepasse + r.valorRetido).toBeCloseTo(333.33, 2);
  });

  it("sem arrecadação não há repasse", () => {
    expect(calcularRepasse(0, 70)).toEqual({
      valorArrecadado: 0,
      percentualParceiro: 70,
      valorRepasse: 0,
      valorRetido: 0,
    });
  });

  it("percentual fora da faixa é limitado a 0–100", () => {
    expect(calcularRepasse(100, 150).valorRepasse).toBe(100);
    expect(calcularRepasse(100, -10).valorRepasse).toBe(0);
  });

  it("arrecadação de ponta a ponta: parcelas do Sponte → repasse", () => {
    const alunos = [
      { alunoId: "862", alunoNome: "Luísa" },
      { alunoId: "895", alunoNome: "Lais" },
    ];
    const parcelasPorAluno: Record<string, ParcelaSponte[]> = {
      "862": [parcela({ categoria: "Mensalidade", valorPago: 1500 }), parcela({ valorPago: 180 })],
      "895": [parcela({ valorPago: 180, quitada: false, dataPagamento: "" })],
    };
    const pagamentos = alunos.map((a) =>
      pagamentoDoAluno(a, parcelasPorAluno[a.alunoId], "Teatro", "2026-08"),
    );
    const total = totalArrecadado(pagamentos);
    expect(total).toBe(180);
    expect(calcularRepasse(total, 50)).toMatchObject({ valorRepasse: 90, valorRetido: 90 });
  });
});

describe("restrição de visualização por modalidade entre parceiros", () => {
  const modalidades = [{ id: "m-teatro" }, { id: "m-jiujitsu" }, { id: "m-jazz" }];

  it("parceiro vê apenas a própria modalidade", () => {
    expect(modalidadesVisiveis(modalidades, ["m-teatro"], false)).toEqual([{ id: "m-teatro" }]);
    expect(podeVerModalidade("m-jazz", ["m-teatro"], false)).toBe(false);
    expect(podeVerModalidade("m-teatro", ["m-teatro"], false)).toBe(true);
  });

  it("parceiros diferentes não enxergam a modalidade um do outro", () => {
    const teatro = modalidadesVisiveis(modalidades, ["m-teatro"], false).map((m) => m.id);
    const jazz = modalidadesVisiveis(modalidades, ["m-jazz"], false).map((m) => m.id);
    expect(teatro).toEqual(["m-teatro"]);
    expect(jazz).toEqual(["m-jazz"]);
    expect(teatro.some((id) => jazz.includes(id))).toBe(false);
  });

  it("parceiro com mais de uma modalidade vê todas as dele", () => {
    expect(
      modalidadesVisiveis(modalidades, ["m-teatro", "m-jazz"], false).map((m) => m.id),
    ).toEqual(["m-teatro", "m-jazz"]);
  });

  it("usuário interno sem vínculo de modalidade vê todas", () => {
    expect(restritoPorModalidade([], false)).toBe(false);
    expect(modalidadesVisiveis(modalidades, [], false)).toEqual(modalidades);
  });

  it("admin vê todas mesmo com modalidades vinculadas", () => {
    expect(restritoPorModalidade(["m-teatro"], true)).toBe(false);
    expect(modalidadesVisiveis(modalidades, ["m-teatro"], true)).toEqual(modalidades);
    expect(podeVerModalidade("m-jazz", ["m-teatro"], true)).toBe(true);
  });
});
