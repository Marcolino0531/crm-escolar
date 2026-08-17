import { describe, expect, it } from "vitest";
import {
  calcularRepasse,
  calcularRepasseModalidade,
  dataPrevistaRepasse,
  geraRepasseNoMes,
  mesmaCategoria,
  modalidadesVisiveis,
  pagamentoDoAluno,
  parcelasAlunoNaModalidade,
  parcelasDaModalidade,
  podeVerModalidade,
  resumoParcelas,
  situacaoParcela,
  restritoPorModalidade,
  somaPercentuais,
  somaValoresFixos,
  frequenciaPorDias,
  normalizarDias,
  rotuloDias,
  statusMesModalidade,
  totalArrecadado,
  totalEsperado,
  vezesPorSemana,
  type FrequenciaModalidade,
  type ParceiroModalidade,
  type ParcelaCategoriaSponte,
  type ParcelaSponte,
  type PagamentoAlunoModalidade,
} from "./esportes-repasse";

function pagamento(over: Partial<PagamentoAlunoModalidade> = {}): PagamentoAlunoModalidade {
  return {
    alunoId: "1",
    alunoNome: "A",
    valorPago: 0,
    dataPagamento: "",
    frequenciaNome: "",
    valorEsperado: 0,
    ...over,
  };
}

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
      pagamento({ alunoId: "1", alunoNome: "A", valorPago: 200, dataPagamento: "2026-08-05" }),
      pagamento({ alunoId: "2", alunoNome: "B", valorPago: 200, dataPagamento: "2026-08-07" }),
      pagamento({ alunoId: "3", alunoNome: "C", valorPago: 0, dataPagamento: "" }),
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

describe("frequência do aluno e valor esperado", () => {
  const duasVezes = {
    id: "f-2x",
    nome: "2x semana (seg e qua)",
    valorMensal: 230,
    vezesSemana: 2,
  };
  const umaVez = {
    id: "f-1x-seg",
    nome: "1x semana (segunda)",
    valorMensal: 210,
    vezesSemana: 1,
  };

  it("o esperado do aluno vem da frequência escolhida, não do que ele pagou", () => {
    const pago = pagamentoDoAluno(
      { alunoId: "862", alunoNome: "Luísa", frequencia: umaVez },
      [parcela({ valorPago: 0, quitada: false, dataPagamento: "" })],
      "Teatro",
      "2026-08",
    );
    expect(pago.frequenciaNome).toBe("1x semana (segunda)");
    expect(pago.valorEsperado).toBe(210);
    expect(pago.valorPago).toBe(0);
  });

  it("aluno sem frequência definida não soma esperado", () => {
    const pago = pagamentoDoAluno(
      { alunoId: "895", alunoNome: "Lais" },
      [parcela({ valorPago: 230 })],
      "Teatro",
      "2026-08",
    );
    expect(pago.frequenciaNome).toBe("");
    expect(pago.valorEsperado).toBe(0);
  });

  it("o esperado da modalidade soma as frequências de cada aluno", () => {
    const alunos = [
      { alunoId: "1", alunoNome: "A", frequencia: duasVezes },
      { alunoId: "2", alunoNome: "B", frequencia: umaVez },
      { alunoId: "3", alunoNome: "C", frequencia: null },
    ];
    const pagamentos = alunos.map((a) => pagamentoDoAluno(a, [], "Teatro", "2026-08"));
    expect(totalEsperado(pagamentos)).toBe(440);
    // O esperado não vira arrecadação: sem parcela paga, o repasse continua zero.
    expect(totalArrecadado(pagamentos)).toBe(0);
  });

  it("trocar de frequência troca o esperado sem mexer no arrecadado", () => {
    const parcelas = [parcela({ valorPago: 210 })];
    const antes = pagamentoDoAluno(
      { alunoId: "1", alunoNome: "A", frequencia: umaVez },
      parcelas,
      "Teatro",
      "2026-08",
    );
    const depois = pagamentoDoAluno(
      { alunoId: "1", alunoNome: "A", frequencia: duasVezes },
      parcelas,
      "Teatro",
      "2026-08",
    );
    expect(antes.valorEsperado).toBe(210);
    expect(depois.valorEsperado).toBe(230);
    expect(depois.valorPago).toBe(antes.valorPago);
  });
});

describe("repasse com múltiplos parceiros", () => {
  const jazz: ParceiroModalidade[] = [
    { id: "p-jazz", nome: "Professora de Jazz", percentualParceiro: 70, valorFixoMensal: null },
  ];
  const jiujitsu: ParceiroModalidade[] = [
    { id: "p-prof", nome: "Professor", percentualParceiro: null, valorFixoMensal: 1200 },
    { id: "p-aux", nome: "Auxiliar", percentualParceiro: null, valorFixoMensal: 800 },
  ];

  it("um parceiro percentual: repasse sobre o arrecadado e o resto retido", () => {
    const r = calcularRepasseModalidade("percentual", jazz, 3000);
    expect(r.parceiros).toEqual([
      {
        parceiroId: "p-jazz",
        parceiroNome: "Professora de Jazz",
        percentualParceiro: 70,
        valorPadrao: 2100,
        valorRepasse: 2100,
        ajustadoManualmente: false,
      },
    ]);
    expect(r.totalRepasse).toBe(2100);
    expect(r.saldoColegio).toBe(900);
  });

  it("percentual: a soma dos percentuais não pode passar de 100", () => {
    const dois: ParceiroModalidade[] = [
      { id: "a", nome: "A", percentualParceiro: 60, valorFixoMensal: null },
      { id: "b", nome: "B", percentualParceiro: 30, valorFixoMensal: null },
    ];
    expect(somaPercentuais(dois)).toBe(90);
    const r = calcularRepasseModalidade("percentual", dois, 1000);
    expect(r.parceiros.map((p) => p.valorRepasse)).toEqual([600, 300]);
    expect(r.saldoColegio).toBe(100);
  });

  it("múltiplos parceiros fixos: cada um recebe o valor contratado", () => {
    const r = calcularRepasseModalidade("fixo", jiujitsu, 2600);
    expect(r.parceiros.map((p) => [p.parceiroNome, p.valorRepasse])).toEqual([
      ["Professor", 1200],
      ["Auxiliar", 800],
    ]);
    expect(r.parceiros.every((p) => p.percentualParceiro === null)).toBe(true);
    expect(somaValoresFixos(jiujitsu)).toBe(2000);
    expect(r.totalRepasse).toBe(2000);
  });

  it("valor fixo não muda quando entra ou sai aluno", () => {
    const cheio = calcularRepasseModalidade("fixo", jiujitsu, 3400);
    const vazio = calcularRepasseModalidade("fixo", jiujitsu, 0);
    expect(cheio.totalRepasse).toBe(2000);
    expect(vazio.totalRepasse).toBe(2000);
  });

  it("saldo do colégio positivo quando arrecadou mais que os fixos", () => {
    expect(calcularRepasseModalidade("fixo", jiujitsu, 2600).saldoColegio).toBe(600);
  });

  it("saldo do colégio negativo quando arrecadou menos que os fixos", () => {
    const r = calcularRepasseModalidade("fixo", jiujitsu, 1450.5);
    expect(r.totalRepasse).toBe(2000);
    expect(r.saldoColegio).toBe(-549.5);
  });

  it("modalidade sem parceiro não gera repasse e o arrecadado fica todo com o colégio", () => {
    const r = calcularRepasseModalidade("fixo", [], 500);
    expect(r.totalRepasse).toBe(0);
    expect(r.saldoColegio).toBe(500);
  });
});

describe("calendário do repasse fixo", () => {
  const jiujitsu: ParceiroModalidade[] = [
    { id: "p-prof", nome: "Professor", percentualParceiro: null, valorFixoMensal: 1200 },
    { id: "p-aux", nome: "Auxiliar", percentualParceiro: null, valorFixoMensal: 800 },
  ];

  it("mês anterior ao início da modalidade não gera repasse", () => {
    expect(statusMesModalidade("2026-07", "2026-08")).toBe("antes_do_inicio");
    expect(geraRepasseNoMes("2026-07", "2026-08")).toBe(false);
    expect(geraRepasseNoMes("2026-08", "2026-08")).toBe(true);
    expect(geraRepasseNoMes("2026-09", "2026-08")).toBe(true);
  });

  it("sem mês de início configurado, todo mês (fora de janeiro) gera repasse", () => {
    expect(geraRepasseNoMes("2026-03", null)).toBe(true);
    expect(geraRepasseNoMes("2026-03", "")).toBe(true);
  });

  it("janeiro é sempre pulado, inclusive quando é o próprio mês de início", () => {
    expect(statusMesModalidade("2027-01", "2026-08")).toBe("janeiro");
    expect(statusMesModalidade("2026-01", "2026-01")).toBe("janeiro");
    expect(geraRepasseNoMes("2027-01", null)).toBe(false);
    expect(geraRepasseNoMes("2026-12", "2026-08")).toBe(true);
    expect(geraRepasseNoMes("2027-02", "2026-08")).toBe(true);
  });

  it("data prevista do repasse cai no dia configurado, sem estourar o mês", () => {
    expect(dataPrevistaRepasse("2026-08", 10)).toBe("2026-08-10");
    expect(dataPrevistaRepasse("2027-02", 31)).toBe("2027-02-28");
    expect(dataPrevistaRepasse("2028-02", 31)).toBe("2028-02-29");
    expect(dataPrevistaRepasse("2026-08", null)).toBe(null);
    expect(dataPrevistaRepasse("2026-08", 0)).toBe(null);
  });

  it("ajuste manual do mês prevalece sobre o valor fixo do cadastro", () => {
    const r = calcularRepasseModalidade("fixo", jiujitsu, 1000, { "p-prof": 600 });
    expect(r.parceiros[0]).toMatchObject({
      parceiroNome: "Professor",
      valorPadrao: 1200,
      valorRepasse: 600,
      ajustadoManualmente: true,
    });
    // O outro parceiro segue no valor do cadastro.
    expect(r.parceiros[1]).toMatchObject({ valorRepasse: 800, ajustadoManualmente: false });
    expect(r.totalRepasse).toBe(1400);
    expect(r.saldoColegio).toBe(-400);
  });

  it("ajuste vale só para o mês ajustado: o cadastro continua valendo nos outros", () => {
    const comAjuste = calcularRepasseModalidade("fixo", jiujitsu, 2000, { "p-prof": 600 });
    const mesSeguinte = calcularRepasseModalidade("fixo", jiujitsu, 2000);
    expect(comAjuste.parceiros[0].valorRepasse).toBe(600);
    expect(mesSeguinte.parceiros[0].valorRepasse).toBe(1200);
    expect(mesSeguinte.parceiros[0].ajustadoManualmente).toBe(false);
  });

  it("ajuste de zero é um ajuste válido (mês sem pagamento ao parceiro)", () => {
    const r = calcularRepasseModalidade("fixo", jiujitsu, 2000, { "p-aux": 0 });
    expect(r.parceiros[1]).toMatchObject({ valorRepasse: 0, ajustadoManualmente: true });
    expect(r.totalRepasse).toBe(1200);
  });

  it("ajuste igual ao valor padrão não é sinalizado como exceção do mês", () => {
    const r = calcularRepasseModalidade("fixo", jiujitsu, 2000, { "p-prof": 1200 });
    expect(r.parceiros[0]).toMatchObject({ valorRepasse: 1200, ajustadoManualmente: false });
  });
});

describe("frequência derivada dos dias da semana marcados no aluno", () => {
  const frequencias: FrequenciaModalidade[] = [
    { id: "f-2x", nome: "2x semana (seg e qua)", valorMensal: 230, vezesSemana: 2 },
    { id: "f-1x", nome: "1x semana", valorMensal: 210, vezesSemana: 1 },
  ];

  it("um dia marcado é 1x/semana e dois dias são 2x/semana", () => {
    expect(vezesPorSemana([1])).toBe(1);
    expect(vezesPorSemana([3])).toBe(1);
    expect(vezesPorSemana([1, 3])).toBe(2);
    expect(vezesPorSemana([])).toBe(0);
  });

  it("dia repetido ou inválido não infla a frequência", () => {
    expect(normalizarDias([3, 1, 3])).toEqual([1, 3]);
    expect(vezesPorSemana([3, 3])).toBe(1);
    expect(vezesPorSemana([0, 8, 2])).toBe(1);
  });

  it("o valor esperado vem da frequência que casa com o número de dias", () => {
    expect(frequenciaPorDias(frequencias, [1, 3])?.valorMensal).toBe(230);
    expect(frequenciaPorDias(frequencias, [1])?.valorMensal).toBe(210);
    // Segunda ou quarta custam o mesmo: o preço depende de quantos dias, não de quais.
    expect(frequenciaPorDias(frequencias, [3])?.valorMensal).toBe(210);
  });

  it("aluno sem dia marcado não tem frequência nem valor derivado", () => {
    expect(frequenciaPorDias(frequencias, [])).toBe(null);
    expect(frequenciaPorDias(frequencias, null)).toBe(null);
  });

  it("nº de dias sem frequência cadastrada não chuta preço", () => {
    expect(frequenciaPorDias(frequencias, [1, 3, 5])).toBe(null);
    expect(frequenciaPorDias([], [1])).toBe(null);
  });

  it("frequência sem dias/semana definidos nunca é derivada dos dias", () => {
    const soNome: FrequenciaModalidade[] = [
      { id: "f-x", nome: "turma avançada", valorMensal: 300, vezesSemana: null },
    ];
    expect(frequenciaPorDias(soNome, [1])).toBe(null);
  });

  it("trocar os dias troca o valor esperado do aluno", () => {
    const antes = frequenciaPorDias(frequencias, [1]);
    const depois = frequenciaPorDias(frequencias, [1, 3]);
    expect(antes?.valorMensal).toBe(210);
    expect(depois?.valorMensal).toBe(230);
  });

  it("o esperado do aluno usa a frequência derivada dos dias", () => {
    const pago = pagamentoDoAluno(
      { alunoId: "862", alunoNome: "Luísa", frequencia: frequenciaPorDias(frequencias, [1, 3]) },
      [parcela({ valorPago: 0, quitada: false, dataPagamento: "" })],
      "Teatro",
      "2026-08",
    );
    expect(pago.frequenciaNome).toBe("2x semana (seg e qua)");
    expect(pago.valorEsperado).toBe(230);
    expect(pago.valorPago).toBe(0);
  });

  it("o esperado da modalidade soma o derivado de cada aluno", () => {
    const pagamentos = [
      { alunoId: "1", alunoNome: "A", dias: [1, 3] },
      { alunoId: "2", alunoNome: "B", dias: [3] },
      { alunoId: "3", alunoNome: "C", dias: [] },
    ].map((a) =>
      pagamentoDoAluno(
        {
          alunoId: a.alunoId,
          alunoNome: a.alunoNome,
          frequencia: frequenciaPorDias(frequencias, a.dias),
        },
        [],
        "Teatro",
        "2026-08",
      ),
    );
    expect(totalEsperado(pagamentos)).toBe(440);
    expect(totalArrecadado(pagamentos)).toBe(0);
  });

  it("rótulo dos dias sai na ordem da semana", () => {
    expect(rotuloDias([3, 1])).toBe("Seg · Qua");
    expect(rotuloDias([])).toBe("");
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

// A relação de valores mostra a parcela REAL do Sponte: a proporcional do mês em
// que o aluno entrou não pode ser sobrescrita pela mensalidade da frequência.
describe("relação de valores (parcelas reais do Sponte)", () => {
  const parcela = (over: Partial<ParcelaCategoriaSponte> = {}): ParcelaCategoriaSponte => ({
    vencimento: "2026-09-07",
    categoria: "Jazz",
    valor: 230,
    valorPago: 0,
    quitada: false,
    dataPagamento: "",
    numeroParcela: "2",
    ...over,
  });

  const ana = { alunoId: "290", alunoNome: "Ana Clara Miranda Ramos" };

  it("situação vem da baixa e da data: quitado, vencido ou a vencer", () => {
    expect(situacaoParcela({ quitada: true, vencimento: "2026-07-05" }, "2026-08-17")).toBe(
      "quitado",
    );
    expect(situacaoParcela({ quitada: false, vencimento: "2026-07-05" }, "2026-08-17")).toBe(
      "vencido",
    );
    expect(situacaoParcela({ quitada: false, vencimento: "2026-08-20" }, "2026-08-17")).toBe(
      "a_vencer",
    );
    // Vence hoje ainda não está vencida.
    expect(situacaoParcela({ quitada: false, vencimento: "2026-08-17" }, "2026-08-17")).toBe(
      "a_vencer",
    );
  });

  it("lista as parcelas da categoria em ordem de vencimento, mês a mês", () => {
    const lista = parcelasAlunoNaModalidade(
      ana,
      [
        parcela({ numeroParcela: "3", vencimento: "2026-10-05" }),
        parcela({ numeroParcela: "1", vencimento: "2026-08-20", valor: 115 }),
        parcela({ numeroParcela: "2", vencimento: "2026-09-07" }),
        parcela({ categoria: "Mensalidade", numeroParcela: "9", vencimento: "2026-09-07" }),
      ],
      "Jazz",
      "2026-08-17",
    );
    expect(lista.map((p) => [p.numeroParcela, p.mesReferencia, p.valor])).toEqual([
      ["1", "2026-08", 115],
      ["2", "2026-09", 230],
      ["3", "2026-10", 230],
    ]);
    expect(lista.every((p) => p.alunoId === "290")).toBe(true);
  });

  it("mantém a primeira parcela proporcional sem recalcular pela mensalidade", () => {
    const [primeira] = parcelasAlunoNaModalidade(
      ana,
      [parcela({ numeroParcela: "1", vencimento: "2026-08-20", valor: 115 })],
      "Jazz",
      "2026-08-17",
    );
    expect(primeira.valor).toBe(115);
    expect(primeira.situacao).toBe("a_vencer");
  });

  it("resumo soma por situação sem misturar o que ainda vai vencer", () => {
    const lista = parcelasAlunoNaModalidade(
      ana,
      [
        parcela({ numeroParcela: "1", vencimento: "2026-08-20", valor: 115 }),
        parcela({ numeroParcela: "2", vencimento: "2026-09-07" }),
        parcela({
          numeroParcela: "0",
          vencimento: "2026-07-05",
          valor: 230,
          valorPago: 230,
          quitada: true,
          dataPagamento: "2026-07-03",
        }),
        parcela({ numeroParcela: "-1", vencimento: "2026-06-05", valor: 210 }),
      ],
      "Jazz",
      "2026-08-17",
    );
    expect(resumoParcelas(lista)).toEqual({
      quitado: 230,
      vencido: 210,
      aVencer: 345,
      total: 785,
    });
  });
});
