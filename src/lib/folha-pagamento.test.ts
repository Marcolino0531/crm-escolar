import { describe, expect, it } from "vitest";
import {
  aplicarAjuste,
  casarPorCpf,
  compararFolhas,
  divergenciasDoColaborador,
  exigirCompetenciaAberta,
  foiAjustada,
  inssDoMes,
  montarLoteFolha,
  pendentesParaFechar,
  planejarReimportacao,
  preSelecao,
  restituicoesDaCompetencia,
  totaisAjustados,
  totaisResumo,
  type ColaboradorComparavel,
  type LinhaResumo,
  type RubricaFolha,
} from "./folha-pagamento";

const colab = (over: Partial<ColaboradorComparavel> = {}): ColaboradorComparavel => ({
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
    expect(por("situacao")).toEqual([{ tipo: "situacao", antes: "Trabalhando", depois: "Férias", diferenca: null }]);
    expect(por("proventos")[0]).toMatchObject({ antes: 3000, depois: 3100.1, diferenca: 100.1 });
    expect(por("liquido")[0]).toMatchObject({ antes: 2670, depois: 2850.09, diferenca: 180.09 });
    expect(por("rubrica_nova")[0]).toMatchObject({ rubrica: "P 150 HORA EXTRA", antes: null, depois: 100.1, diferenca: 100.1 });
    expect(por("rubrica_valor")[0]).toMatchObject({ rubrica: "D 998 INSS", antes: 250, depois: 250.01, diferenca: 0.01 });
    expect(por("rubrica_removida")[0]).toMatchObject({ rubrica: "D 48 VALE TRANSPORTE", antes: 80, depois: null, diferenca: -80 });
  });

  it("um centavo de diferença conta (sem erro de ponto flutuante)", () => {
    const a = colab({ proventos: 0.1 + 0.2 });
    const b = colab({ proventos: 0.3 });
    expect(divergenciasDoColaborador(a, b)).toEqual([]);
    const c = colab({ proventos: 0.31 });
    expect(divergenciasDoColaborador(b, c)[0]).toMatchObject({ tipo: "proventos", diferenca: 0.01 });
  });

  it("ausentes, pré-seleção e primeira importação", () => {
    const anterior = [colab(), colab({ codigo: "2", cpf: "900.000.002-56", nome: "SAIU DA FOLHA" })];
    const atual = [colab(), colab({ codigo: "3", cpf: "900.000.003-37", nome: "ENTROU" })];
    const cmp = compararFolhas(anterior, atual);
    expect(cmp.primeiraImportacao).toBe(false);
    expect(cmp.ausentes.map((c) => c.nome)).toEqual(["SAIU DA FOLHA"]);
    expect([...preSelecao(cmp)]).toEqual(["1"]);
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
    expect(plano.substituidos.map((s) => [s.colaborador.codigo, s.perdeAjusteManual])).toEqual([["2", true]]);
    expect(plano.novos.map((c) => c.codigo)).toEqual(["3"]);
    expect(plano.retirados.map((c) => c.codigo)).toEqual(["4"]);
  });
});

describe("ajuste manual", () => {
  const base: RubricaFolha[] = [
    { tipo: "P", codigo: "1", descricao: "SALARIO", referencia: "30", valor: 3000, origem: "pdf", valorOriginal: 3000, removida: false },
    { tipo: "D", codigo: "998", descricao: "INSS", referencia: "", valor: 250, origem: "pdf", valorOriginal: 250, removida: false },
    { tipo: "D", codigo: "48", descricao: "VALE TRANSPORTE", referencia: "", valor: 80, origem: "pdf", valorOriginal: 80, removida: false },
  ];

  it("editar valor recalcula e preserva o original", () => {
    const r = aplicarAjuste(base, { op: "editar", indice: 0, valor: 3100.55 });
    expect(totaisAjustados(r)).toEqual({ proventos: 3100.55, descontos: 330, liquido: 2770.55 });
    expect(r[0].valorOriginal).toBe(3000);
    expect(foiAjustada(r)).toBe(true);
  });

  it("incluir rubrica manual recalcula", () => {
    const r = aplicarAjuste(base, { op: "incluir", tipo: "D", codigo: "", descricao: "ADIANTAMENTO", valor: 500.1 });
    expect(r.at(-1)).toMatchObject({ origem: "manual", valorOriginal: null });
    expect(totaisAjustados(r)).toEqual({ proventos: 3000, descontos: 830.1, liquido: 2169.9 });
  });

  it("remover rubrica do PDF a guarda fora dos totais; manual sai de vez", () => {
    const r = aplicarAjuste(base, { op: "remover", indice: 2 });
    expect(r).toHaveLength(3);
    expect(r[2].removida).toBe(true);
    expect(totaisAjustados(r)).toEqual({ proventos: 3000, descontos: 250, liquido: 2750 });
    const comManual = aplicarAjuste(base, { op: "incluir", tipo: "P", codigo: "", descricao: "BONUS", valor: 10 });
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
    expect(inssDoMes([rub("998", 100.1), rub("826", 50), rub("989", 30), rub("843", 20), rub("998", 9, "P")])).toBe(100.1);
    expect(inssDoMes([{ ...rub("998", 100), removida: true }])).toBe(0);
  });

  const colaboradores = [
    { id: "c1", funcionarioId: "f1", rubricas: [rub("998", 417.16), rub("826", 99)], restituicaoGravada: null },
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
    const gravadas = colaboradores.map((c) => ({ ...c, restituicaoGravada: c.id === "c1" ? 417.16 : c.id === "c2" ? 300.05 : 0 }));
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
    { chave: "1", funcionarioId: "f1", nome: "CONFIRMADA", status: "confirmado", bruto: 4754.6, liquido: 4052.17, restituicao: 417.16 },
    { chave: "2", funcionarioId: "f2", nome: "PENDENTE", status: "em_conferencia", bruto: 3000, liquido: 2670, restituicao: 0 },
    { chave: "3", funcionarioId: "f3", nome: "ESTAGIARIA", status: "manual", bruto: 1200, liquido: 1200.1, restituicao: 0 },
    { chave: "4", funcionarioId: null, nome: "SEM CADASTRO", status: "confirmado", bruto: 10, liquido: 10, restituicao: 0 },
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
