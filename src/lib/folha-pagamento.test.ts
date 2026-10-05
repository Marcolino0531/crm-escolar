import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agruparPorPessoa,
  aplicarAjuste,
  casarPorCpf,
  chaveColaborador,
  compararFolhas,
  conferirValorNoLote,
  divergenciasDoColaborador,
  emOrdemAlfabetica,
  exigirCompetenciaAberta,
  foiAjustada,
  inssDoMes,
  liquidoManualDoAjuste,
  montarLoteFolha,
  pendentesParaFechar,
  planejarReimportacao,
  preSelecao,
  registrosPorCpf,
  restituicoesDaCompetencia,
  restituicoesPorPessoa,
  resumoDaFolha,
  salariosDaFolha,
  totaisDasEmpresas,
  totaisAjustados,
  totaisResumo,
  type ColaboradorComparavel,
  type LinhaResumo,
  type RubricaFolha,
} from "./folha-pagamento";

const colab = (over: Partial<ColaboradorComparavel> = {}): ColaboradorComparavel => ({
  tipo: "empregado",
  codigo: "1",
  nome: "FULANA DE TESTE",
  cpf: "900.000.001-75",
  situacao: "Trabalhando",
  proventos: 3000,
  descontos: 330,
  liquido: 2670,
  rubricas: [
    { tipo: "P", codigo: "1", descricao: "SALARIO", valor: 3000 },
    { tipo: "D", codigo: "998", descricao: "INSS", valor: 250 },
    { tipo: "D", codigo: "48", descricao: "VALE TRANSPORTE", valor: 80 },
  ],
  ...over,
});

describe("comparação entre competências", () => {
  it("colaborador idêntico não gera divergência", () => {
    expect(divergenciasDoColaborador(colab(), colab())).toEqual([]);
  });

  it("novo na folha", () => {
    const d = divergenciasDoColaborador(null, colab());
    expect(d).toEqual([{ tipo: "novo", antes: null, depois: "FULANA DE TESTE", diferenca: null }]);
  });

  it("situação, bruto, líquido e rubricas nova/sumiu/valor com diferença em R$", () => {
    const antes = colab();
    const depois = colab({
      situacao: "Férias",
      proventos: 3100.1,
      descontos: 250.01,
      liquido: 2850.09,
      rubricas: [
        { tipo: "P", codigo: "1", descricao: "SALARIO", valor: 3000 },
        { tipo: "P", codigo: "150", descricao: "HORA EXTRA", valor: 100.1 },
        { tipo: "D", codigo: "998", descricao: "INSS", valor: 250.01 },
      ],
    });
    const d = divergenciasDoColaborador(antes, depois);
    const por = (t: string) => d.filter((x) => x.tipo === t);
    expect(por("situacao")).toEqual([
      { tipo: "situacao", antes: "Trabalhando", depois: "Férias", diferenca: null },
    ]);
    expect(por("proventos")[0]).toMatchObject({ antes: 3000, depois: 3100.1, diferenca: 100.1 });
    expect(por("liquido")[0]).toMatchObject({ antes: 2670, depois: 2850.09, diferenca: 180.09 });
    expect(por("rubrica_nova")[0]).toMatchObject({
      rubrica: "P 150 HORA EXTRA",
      antes: null,
      depois: 100.1,
      diferenca: 100.1,
    });
    expect(por("rubrica_valor")[0]).toMatchObject({
      rubrica: "D 998 INSS",
      antes: 250,
      depois: 250.01,
      diferenca: 0.01,
    });
    expect(por("rubrica_removida")[0]).toMatchObject({
      rubrica: "D 48 VALE TRANSPORTE",
      antes: 80,
      depois: null,
      diferenca: -80,
    });
  });

  it("um centavo de diferença conta (sem erro de ponto flutuante)", () => {
    const a = colab({ proventos: 0.1 + 0.2 });
    const b = colab({ proventos: 0.3 });
    expect(divergenciasDoColaborador(a, b)).toEqual([]);
    const c = colab({ proventos: 0.31 });
    expect(divergenciasDoColaborador(b, c)[0]).toMatchObject({
      tipo: "proventos",
      diferenca: 0.01,
    });
  });

  it("ausentes, pré-seleção e primeira importação", () => {
    const anterior = [
      colab(),
      colab({ codigo: "2", cpf: "900.000.002-56", nome: "SAIU DA FOLHA" }),
    ];
    const atual = [colab(), colab({ codigo: "3", cpf: "900.000.003-37", nome: "ENTROU" })];
    const cmp = compararFolhas(anterior, atual);
    expect(cmp.primeiraImportacao).toBe(false);
    expect(cmp.ausentes.map((c) => c.nome)).toEqual(["SAIU DA FOLHA"]);
    expect([...preSelecao(cmp)]).toEqual(["empregado:1"]);
    const primeira = compararFolhas(null, atual);
    expect(primeira.primeiraImportacao).toBe(true);
    expect(preSelecao(primeira).size).toBe(0);
  });

  it("casa pelo CPF só com dígitos (inclui desligados)", () => {
    const funcs = [
      { id: "a", cpf: "90000000175", status: "desligado" },
      { id: "b", cpf: null },
    ];
    expect(casarPorCpf(funcs, "900.000.001-75")?.id).toBe("a");
    expect(casarPorCpf(funcs, "")).toBeNull();
  });
});

describe("reimportação da mesma competência", () => {
  it("igual não muda; diferente é substituído e avisa ajuste manual perdido", () => {
    const gravados = [
      { ...colab(), ajustadoManualmente: false },
      { ...colab({ codigo: "2", cpf: "900.000.002-56" }), ajustadoManualmente: true },
      { ...colab({ codigo: "4", cpf: "900.000.004-18" }), ajustadoManualmente: false },
    ];
    const novo = [
      colab(),
      colab({ codigo: "2", cpf: "900.000.002-56", proventos: 3000.01, liquido: 2670.01 }),
      colab({ codigo: "3", cpf: "900.000.003-37" }),
    ];
    const plano = planejarReimportacao(gravados, novo);
    expect(plano.iguais.map((c) => c.codigo)).toEqual(["1"]);
    expect(plano.substituidos.map((s) => [s.colaborador.codigo, s.perdeAjusteManual])).toEqual([
      ["2", true],
    ]);
    expect(plano.novos.map((c) => c.codigo)).toEqual(["3"]);
    expect(plano.retirados.map((c) => c.codigo)).toEqual(["4"]);
  });
});

describe("ajuste manual", () => {
  const base: RubricaFolha[] = [
    {
      tipo: "P",
      codigo: "1",
      descricao: "SALARIO",
      referencia: "30",
      valor: 3000,
      origem: "pdf",
      valorOriginal: 3000,
      removida: false,
    },
    {
      tipo: "D",
      codigo: "998",
      descricao: "INSS",
      referencia: "",
      valor: 250,
      origem: "pdf",
      valorOriginal: 250,
      removida: false,
    },
    {
      tipo: "D",
      codigo: "48",
      descricao: "VALE TRANSPORTE",
      referencia: "",
      valor: 80,
      origem: "pdf",
      valorOriginal: 80,
      removida: false,
    },
  ];

  it("editar valor recalcula e preserva o original", () => {
    const r = aplicarAjuste(base, { op: "editar", indice: 0, valor: 3100.55 });
    expect(totaisAjustados(r)).toEqual({ proventos: 3100.55, descontos: 330, liquido: 2770.55 });
    expect(r[0].valorOriginal).toBe(3000);
    expect(foiAjustada(r)).toBe(true);
  });

  it("incluir rubrica manual recalcula", () => {
    const r = aplicarAjuste(base, {
      op: "incluir",
      tipo: "D",
      codigo: "",
      descricao: "ADIANTAMENTO",
      valor: 500.1,
    });
    expect(r.at(-1)).toMatchObject({ origem: "manual", valorOriginal: null });
    expect(totaisAjustados(r)).toEqual({ proventos: 3000, descontos: 830.1, liquido: 2169.9 });
  });

  it("remover rubrica do PDF a guarda fora dos totais; manual sai de vez", () => {
    const r = aplicarAjuste(base, { op: "remover", indice: 2 });
    expect(r).toHaveLength(3);
    expect(r[2].removida).toBe(true);
    expect(totaisAjustados(r)).toEqual({ proventos: 3000, descontos: 250, liquido: 2750 });
    const comManual = aplicarAjuste(base, {
      op: "incluir",
      tipo: "P",
      codigo: "",
      descricao: "BONUS",
      valor: 10,
    });
    expect(aplicarAjuste(comManual, { op: "remover", indice: 3 })).toHaveLength(3);
  });

  it("sem ajuste não fica marcado", () => {
    expect(foiAjustada(base)).toBe(false);
    expect(totaisAjustados(base)).toEqual({ proventos: 3000, descontos: 330, liquido: 2670 });
  });
});

describe("restituição do INSS", () => {
  const rub = (codigo: string, valor: number, tipo: "P" | "D" = "D") => ({ tipo, codigo, valor });

  it("só rubrica D 998 (não 826, 989, 843 nem P 998)", () => {
    expect(
      inssDoMes([
        rub("998", 100.1),
        rub("826", 50),
        rub("989", 30),
        rub("843", 20),
        rub("998", 9, "P"),
      ]),
    ).toBe(100.1);
    expect(inssDoMes([{ ...rub("998", 100), removida: true }])).toBe(0);
  });

  const colaboradores = [
    {
      id: "c1",
      funcionarioId: "f1",
      rubricas: [rub("998", 417.16), rub("826", 99)],
      restituicaoGravada: null,
    },
    { id: "c2", funcionarioId: "f2", rubricas: [rub("998", 300.05)], restituicaoGravada: null },
    { id: "c3", funcionarioId: null, rubricas: [rub("998", 200)], restituicaoGravada: null },
    { id: "c4", funcionarioId: "f4", rubricas: [rub("843", 500)], restituicaoGravada: null },
  ];

  it("total só dos marcados", () => {
    const r = restituicoesDaCompetencia(colaboradores, new Set(["f1", "f4"]), false);
    expect(r.linhas.map((l) => l.restituicao)).toEqual([417.16, 0, 0, 0]);
    expect(r.total).toBe(417.16);
  });

  it("mês fechado usa o valor gravado e não muda ao desmarcar", () => {
    const gravadas = colaboradores.map((c) => ({
      ...c,
      restituicaoGravada: c.id === "c1" ? 417.16 : c.id === "c2" ? 300.05 : 0,
    }));
    const r = restituicoesDaCompetencia(gravadas, new Set(), true);
    expect(r.total).toBe(717.21);
    expect(restituicoesDaCompetencia(gravadas, new Set(["f4"]), true).total).toBe(717.21);
  });

  it("competência fechada é somente leitura; fechar exige ninguém em conferência", () => {
    expect(() => exigirCompetenciaAberta("fechada")).toThrow(/somente leitura/);
    expect(() => exigirCompetenciaAberta("aberta")).not.toThrow();
    expect(
      pendentesParaFechar([
        { nome: "A", status: "confirmado" },
        { nome: "B", status: "em_conferencia" },
      ]),
    ).toEqual(["B"]);
  });
});

describe("resumo e lote de pagamento", () => {
  const linhas: LinhaResumo[] = [
    {
      chave: "1",
      funcionarioId: "f1",
      nome: "CONFIRMADA",
      status: "confirmado",
      bruto: 4754.6,
      liquido: 4052.17,
      restituicao: 417.16,
    },
    {
      chave: "2",
      funcionarioId: "f2",
      nome: "PENDENTE",
      status: "em_conferencia",
      bruto: 3000,
      liquido: 2670,
      restituicao: 0,
    },
    {
      chave: "3",
      funcionarioId: "f3",
      nome: "ESTAGIARIA",
      status: "manual",
      bruto: 1200,
      liquido: 1200.1,
      restituicao: 0,
    },
    {
      chave: "4",
      funcionarioId: null,
      nome: "SEM CADASTRO",
      status: "confirmado",
      bruto: 10,
      liquido: 10,
      restituicao: 0,
    },
  ];

  it("lote soma só Confirmados e Manuais pelo líquido; Em conferência fora; restituição não entra", () => {
    const lote = montarLoteFolha(linhas);
    expect(lote.itens.map((i) => [i.employee_id, i.total_amount])).toEqual([
      ["f1", 4052.17],
      ["f3", 1200.1],
    ]);
    expect(lote.total).toBe(5252.27);
    expect(lote.emConferencia).toEqual(["PENDENTE"]);
    expect(lote.semCadastro).toEqual(["SEM CADASTRO"]);
  });

  it("totais do resumo", () => {
    expect(totaisResumo(linhas)).toEqual({ bruto: 8964.6, liquido: 7932.27, restituicao: 417.16 });
  });
});

describe("pessoa com mais de um contrato (mesmo CPF)", () => {
  const CPF = "900.000.001-75";
  const contrato1 = colab({ codigo: "22", cpf: CPF, proventos: 3000, liquido: 2670 });
  const contrato2 = colab({ codigo: "57", cpf: CPF, proventos: 1500.1, liquido: 1300.05 });

  it("chave é tipo + código, não CPF", () => {
    expect(chaveColaborador(contrato1)).toBe("empregado:22");
    expect(chaveColaborador({ ...contrato1, tipo: "contribuinte" })).toBe("contribuinte:22");
    expect(chaveColaborador(contrato1)).not.toBe(chaveColaborador(contrato2));
  });

  it("comparação mensal e pré-seleção separam os contratos", () => {
    const anterior = [contrato1, contrato2];
    const atual = [contrato1, { ...contrato2, proventos: 1600.1, liquido: 1400.05 }];
    const cmp = compararFolhas(anterior, atual);
    expect(cmp.ausentes).toEqual([]);
    expect(cmp.porColaborador.map((p) => p.divergencias.length > 0)).toEqual([false, true]);
    expect([...preSelecao(cmp)]).toEqual(["empregado:22"]);
  });

  it("reimportação substitui só o contrato alterado e nunca retira o outro por ter o mesmo CPF", () => {
    const gravados = [
      { ...contrato1, ajustadoManualmente: false },
      { ...contrato2, ajustadoManualmente: false },
    ];
    const novo = [contrato1, { ...contrato2, proventos: 1600.1, liquido: 1400.05 }];
    const plano = planejarReimportacao(gravados, novo);
    expect(plano.iguais.map((c) => c.codigo)).toEqual(["22"]);
    expect(plano.substituidos.map((s) => s.colaborador.codigo)).toEqual(["57"]);
    expect(plano.novos).toEqual([]);
    expect(plano.retirados).toEqual([]);
    const semUm = planejarReimportacao(gravados, [contrato1]);
    expect(semUm.retirados.map((c) => c.codigo)).toEqual(["57"]);
  });

  it("mesmo código com outro tipo é outro registro", () => {
    const plano = planejarReimportacao(
      [{ ...colab({ codigo: "5" }), ajustadoManualmente: false }],
      [colab({ codigo: "5", tipo: "contribuinte" })],
    );
    expect(plano.novos.map(chaveColaborador)).toEqual(["contribuinte:5"]);
    expect(plano.retirados.map(chaveColaborador)).toEqual(["empregado:5"]);
  });

  const reg = (
    id: string,
    funcionarioId: string | null,
    status: "confirmado" | "em_conferencia",
    proventos: number,
    liquido: number,
    nome = "FULANA DE TESTE",
  ) => ({ id, funcionarioId, status, proventos, liquido, nome, cpf: CPF });

  it("salário: soma dos dois contratos confirmados numa linha só", () => {
    const s = salariosDaFolha([
      reg("a", "f1", "confirmado", 3000, 2670),
      reg("b", "f1", "confirmado", 1500.1, 1300.05),
      reg("c", "f2", "confirmado", 100, 90),
      reg("d", null, "confirmado", 50, 40),
    ]);
    expect(s).toEqual([
      { funcionarioId: "f1", valor: 4500.1, valorLiquido: 3970.05 },
      { funcionarioId: "f2", valor: 100, valorLiquido: 90 },
    ]);
  });

  it("salário: com um contrato em conferência a pessoa não é gravada", () => {
    expect(
      salariosDaFolha([
        reg("a", "f1", "confirmado", 3000, 2670),
        reg("b", "f1", "em_conferencia", 1500.1, 1300.05),
      ]),
    ).toEqual([]);
  });

  it("resumo: uma linha por pessoa, valores somados e status de todos", () => {
    const registros = [
      reg("a", "f1", "confirmado", 3000, 2670),
      reg("b", "f1", "em_conferencia", 1500.1, 1300.05),
      reg("c", "f2", "confirmado", 100, 90, "OUTRA"),
      reg("d", null, "confirmado", 50, 40, "SEM CADASTRO"),
      reg("e", null, "confirmado", 60, 50, "SEM CADASTRO 2"),
    ];
    const r = resumoDaFolha(
      registros,
      new Map([
        ["a", 10.1],
        ["b", 5.05],
      ]),
    );
    expect(
      r.map((l) => [l.nome, l.status, l.bruto, l.liquido, l.restituicao, l.contratos]),
    ).toEqual([
      ["FULANA DE TESTE", "em_conferencia", 4500.1, 3970.05, 15.15, 2],
      ["OUTRA", "confirmado", 100, 90, 0, 1],
      ["SEM CADASTRO", "confirmado", 50, 40, 0, 1],
      ["SEM CADASTRO 2", "confirmado", 60, 50, 0, 1],
    ]);
    const confirmados = resumoDaFolha(
      registros.map((x) => ({ ...x, status: "confirmado" as const })),
      new Map(),
    );
    expect(confirmados[0].status).toBe("confirmado");
    expect(registrosPorCpf(registros).get("90000000175")).toBe(5);
    expect(agruparPorPessoa(registros)).toHaveLength(4);
  });

  it("lote: soma os líquidos por pessoa e exclui quem tem contrato em conferência", () => {
    const registros = [
      reg("a", "f1", "confirmado", 3000, 2670),
      reg("b", "f1", "confirmado", 1500.1, 1300.05),
      reg("c", "f2", "confirmado", 100, 90, "PENDENTE"),
      reg("d", "f2", "em_conferencia", 100, 90, "PENDENTE"),
    ];
    const lote = montarLoteFolha(resumoDaFolha(registros, new Map()));
    expect(lote.itens.map((i) => [i.employee_id, i.total_amount])).toEqual([["f1", 3970.05]]);
    expect(lote.emConferencia).toEqual(["PENDENTE"]);
  });

  it("restituição: INSS 998 somado por pessoa", () => {
    const rub = (valor: number) => [{ tipo: "D" as const, codigo: "998", valor }];
    const cols = [
      {
        id: "a",
        funcionarioId: "f1",
        nome: "FULANA",
        rubricas: rub(250.1),
        restituicaoGravada: null,
      },
      {
        id: "b",
        funcionarioId: "f1",
        nome: "FULANA",
        rubricas: rub(120.05),
        restituicaoGravada: null,
      },
      { id: "c", funcionarioId: "f2", nome: "OUTRA", rubricas: rub(80), restituicaoGravada: null },
    ];
    const r = restituicoesDaCompetencia(cols, new Set(["f1"]), false);
    const porPessoa = restituicoesPorPessoa(cols, r.linhas);
    expect(porPessoa.map((p) => [p.nome, p.contratos, p.inss, p.restituicao])).toEqual([
      ["FULANA", 2, 370.15, 370.15],
      ["OUTRA", 1, 80, 0],
    ]);
    expect(r.total).toBe(370.15);
    // no fechamento o valor segue gravado por registro
    expect(r.linhas.map((l) => [l.id, l.restituicao])).toEqual([
      ["a", 250.1],
      ["b", 120.05],
      ["c", 0],
    ]);
  });
});

describe("Resumo em ordem alfabética (folha + salário manual)", () => {
  const comparar = new Intl.Collator("pt-BR", { sensitivity: "base" }).compare;
  const linha = (over: Partial<LinhaResumo> & { chave: string; nome: string }): LinhaResumo => ({
    funcionarioId: `f${over.chave}`,
    status: "confirmado",
    bruto: 0,
    liquido: 0,
    restituicao: 0,
    ...over,
  });
  const daFolha: LinhaResumo[] = [
    linha({
      chave: "1",
      nome: "MARIA DA SILVA TESTE",
      bruto: 3200.45,
      liquido: 2810.33,
      restituicao: 120.1,
    }),
    linha({
      chave: "2",
      nome: "BRUNO DOS SANTOS FICTICIO",
      bruto: 1999.99,
      liquido: 1700.01,
      restituicao: 0.07,
    }),
    linha({ chave: "3", nome: "ÁGATA DE TESTE", bruto: 0.1, liquido: 0.2, restituicao: 0 }),
  ];
  const manuais: LinhaResumo[] = [
    linha({
      chave: "4",
      nome: "Carla Exemplo dos Anjos",
      status: "manual",
      bruto: 1500,
      liquido: 1320.55,
    }),
    linha({
      chave: "5",
      nome: "alberto e souza exemplo",
      status: "manual",
      bruto: 980.3,
      liquido: 980.3,
    }),
  ];
  const antes = [...daFolha, ...manuais];
  const ordenadas = emOrdemAlfabetica(antes, comparar);

  it("folha e manuais numa única lista, em ordem alfabética pelo nome padronizado", () => {
    expect(ordenadas.map((l) => l.nome)).toEqual([
      "Ágata de Teste",
      "Alberto e Souza Exemplo",
      "Bruno dos Santos Ficticio",
      "Carla Exemplo dos Anjos",
      "Maria da Silva Teste",
    ]);
    expect(ordenadas.map((l) => l.status)).toEqual([
      "confirmado",
      "manual",
      "confirmado",
      "manual",
      "confirmado",
    ]);
  });

  it("não altera os registros de origem (nome do banco continua como no PDF)", () => {
    expect(daFolha[0].nome).toBe("MARIA DA SILVA TESTE");
  });

  it("totais de Bruto, Líquido e Restituição iguais aos de antes da ordenação", () => {
    expect(totaisResumo(ordenadas)).toEqual(totaisResumo(antes));
    expect(totaisResumo(ordenadas)).toEqual({
      bruto: 7680.84,
      liquido: 6811.39,
      restituicao: 120.17,
    });
  });

  it("total do lote não muda com a ordenação; lote segue a ordem do Resumo com nome padronizado", () => {
    const loteAntes = montarLoteFolha(antes);
    const lote = montarLoteFolha(ordenadas);
    expect(lote.total).toBe(loteAntes.total);
    expect(lote.total).toBe(6811.39);
    expect(lote.itens.map((i) => i.employee_name)).toEqual(ordenadas.map((l) => l.nome));
    expect(loteAntes.itens.map((i) => i.employee_name)[0]).toBe("Maria da Silva Teste");
  });
});

describe("líquido a pagar manual (Ajustar)", () => {
  const reg = (
    id: string,
    funcionarioId: string | null,
    proventos: number,
    descontos: number,
    liquido: number,
    liquidoManual: number | null = null,
    nome = "FULANA DE TESTE",
  ) => ({
    id,
    funcionarioId,
    status: "confirmado" as const,
    proventos,
    descontos,
    liquido,
    liquidoManual,
    nome,
  });
  const semManual = [
    reg("a", "f1", 3000, 330, 2670),
    reg("b", "f2", 1000, 100, 900, null, "OUTRA"),
  ];
  const comManual = [reg("a", "f1", 3000, 330, 2670, 2500.5), semManual[1]];

  it("salário, Resumo e lote usam o valor pago; proventos, descontos e líquido da folha não mudam", () => {
    expect(salariosDaFolha(comManual)).toEqual([
      { funcionarioId: "f1", valor: 3000, valorLiquido: 2500.5 },
      { funcionarioId: "f2", valor: 1000, valorLiquido: 900 },
    ]);
    const resumo = resumoDaFolha(comManual, new Map());
    expect(resumo.map((l) => [l.bruto, l.liquido, l.liquidoManual])).toEqual([
      [3000, 2500.5, true],
      [1000, 900, false],
    ]);
    const lote = montarLoteFolha(resumo);
    expect(lote.itens.map((i) => i.total_amount)).toEqual([2500.5, 900]);
    expect(comManual[0]).toMatchObject({ proventos: 3000, descontos: 330, liquido: 2670 });
  });

  it("totais da aba Folha iguais com e sem líquido manual; Resumo e lote somam o pago", () => {
    expect(totaisDasEmpresas(comManual)).toEqual(totaisDasEmpresas(semManual));
    expect(totaisDasEmpresas(comManual).liquido).toBe(3570);
    const resumo = resumoDaFolha(comManual, new Map());
    expect(totaisResumo(resumo).liquido).toBe(3400.5);
    expect(montarLoteFolha(resumo).total).toBe(3400.5);
  });

  it("pessoa com dois registros: manual de um + calculado do outro", () => {
    const registros = [
      reg("a", "f1", 3000, 330, 2670, 2500.5),
      reg("b", "f1", 1500.1, 200.05, 1300.05),
    ];
    expect(salariosDaFolha(registros)).toEqual([
      { funcionarioId: "f1", valor: 4500.1, valorLiquido: 3800.55 },
    ]);
    const [linha] = resumoDaFolha(registros, new Map());
    expect([linha.liquido, linha.liquidoManual, linha.contratos]).toEqual([3800.55, true, 2]);
    expect(montarLoteFolha([linha]).total).toBe(3800.55);
  });

  it("conferência do lote aceita o valor pago e recusa o líquido da folha", () => {
    const registros = [
      reg("a", "f1", 3000, 330, 2670, 2500.5),
      reg("b", "f1", 1500.1, 200.05, 1300.05),
    ];
    expect(() => conferirValorNoLote(registros, 3800.55)).not.toThrow();
    expect(() => conferirValorNoLote(registros, 3970.05)).toThrow(/difere do líquido/);
    expect(() =>
      conferirValorNoLote([{ ...registros[0], status: "em_conferencia" }], 2500.5),
    ).toThrow(/Em conferência/);
  });

  it("restituição do INSS e comparação com o mês anterior ignoram o líquido manual", () => {
    const rub = [{ tipo: "D" as const, codigo: "998", valor: 300.05 }];
    const cols = [{ id: "a", funcionarioId: "f1", rubricas: rub, restituicaoGravada: null }];
    const manual = cols.map((c) => Object.assign({}, c, { liquidoManual: 1 }));
    expect(restituicoesDaCompetencia(manual, new Set(["f1"]), false)).toEqual(
      restituicoesDaCompetencia(cols, new Set(["f1"]), false),
    );
    const anterior = colab();
    const atual = Object.assign(colab(), { liquidoManual: 1 });
    expect(divergenciasDoColaborador(anterior, atual)).toEqual([]);
    expect(compararFolhas([anterior], [atual]).porColaborador[0].divergencias).toEqual([]);
  });

  it("reimportação: igual não é tocado (mantém); substituído perde o líquido manual", () => {
    const gravados = [
      { ...colab(), ajustadoManualmente: true },
      { ...colab({ codigo: "2" }), ajustadoManualmente: true },
    ];
    const plano = planejarReimportacao(gravados, [colab(), colab({ codigo: "2", liquido: 2600 })]);
    expect(plano.iguais.map((c) => c.codigo)).toEqual(["1"]);
    expect(plano.substituidos.map((x) => [x.colaborador.codigo, x.perdeAjusteManual])).toEqual([
      ["2", true],
    ]);
    const sql = readFileSync(
      "supabase/migrations/20261129090000_rh_folha_liquido_manual.sql",
      "utf8",
    );
    const gravar = sql.slice(
      sql.indexOf("FUNCTION public.rh_folha_gravar_importacao"),
      sql.indexOf("FUNCTION public.rh_folha_ajustar_colaborador"),
    );
    expect(gravar).toMatch(/ajuste_observacao = NULL,\s*liquido_manual = NULL,/);
    expect(sql).toMatch(/liquido_manual >= 0/);
    const fonte = readFileSync("src/lib/rh-folha.functions.ts", "utf8");
    expect(fonte).not.toMatch(/liquido_manual: g\b|g\?\.liquidoManual/);
    const retrato = readFileSync(
      "supabase/migrations/20261128090000_rh_folha_exclusao_retrato.sql",
      "utf8",
    );
    expect(retrato).toMatch(/'colaborador', to_jsonb\(c\.\*\)/);
    expect(retrato).toMatch(/jsonb_populate_record\(NULL::public\.rh_folha_colaboradores/);
  });

  it("igual ao calculado grava nulo; diferente grava; negativo é recusado", () => {
    expect(liquidoManualDoAjuste(2670, 2670)).toBeNull();
    expect(liquidoManualDoAjuste(2670.004, 2670)).toBeNull();
    expect(liquidoManualDoAjuste(2500.5, 2670)).toBe(2500.5);
    expect(liquidoManualDoAjuste(2800, 2670)).toBe(2800);
    expect(liquidoManualDoAjuste(0, 2670)).toBe(0);
    expect(() => liquidoManualDoAjuste(-0.01, 2670)).toThrow(/negativo/);
  });
});
