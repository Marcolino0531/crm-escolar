import { describe, expect, it } from "vitest";

import {
  CATEGORIA_ALIMENTACAO_SPONTE,
  CATEGORIA_HORA_EXTRA_SPONTE,
  CATEGORIA_MATRICULA_SPONTE,
  CATEGORIA_MENSALIDADE_SPONTE,
  ITEM_PLANO_VAZIO,
  anoDoPlanoCurso,
  contarRefeicoesNoPeriodo,
  escolherPlanoDoAnoLetivo,
  maxParcelasMaterial,
  montarPlanoFaturamento,
  opcoesParcelasMaterial,
  parcelasComAjuste,
  problemaMensalidadeDoPlano,
  statusGeralFaturamento,
  vencimentosAPartirDe,
  vencimentosMensalidade,
  type EntradaFaturamentoMatricula,
  type PlanoCursoSponte,
} from "@/lib/matricula-faturamento";
import { refeicoesVazias } from "@/lib/matricula-form";
import { CATEGORIA_MATERIAL_SPONTE } from "@/lib/rematricula";
import {
  parcelamentoMatriculaDisponivel,
  segmentoMatricula,
  valorMatricula,
  type ValoresMatricula,
} from "@/lib/rematricula-matricula";
import {
  contaReceberCriada,
  montarParametrosInsertPlano,
  montarParametrosUpdateParcela,
} from "@/lib/sponte-plano";

// Plano padrão 2026 do 1º Ano (valores reais lidos do GetPlanosCursos na Fase 0).
function planoBase(over: Partial<PlanoCursoSponte> = {}): PlanoCursoSponte {
  return {
    cursoId: 10,
    planoCursoId: 77,
    descricaoPlano: "2026",
    ativo: true,
    padrao: true,
    matricula: {
      ...ITEM_PLANO_VAZIO,
      parcelas: 1,
      valorParcela: 1847.25,
      dataInicial: "2026-01-05",
      planoContaId: 5,
      descricaoPlanoConta: "Matrícula",
    },
    mensalidade: {
      ...ITEM_PLANO_VAZIO,
      parcelas: 11,
      valorParcela: 1775.95,
      dataInicial: "2026-02-05",
      planoContaId: 1,
      descricaoPlanoConta: "Mensalidade",
    },
    material: {
      ...ITEM_PLANO_VAZIO,
      parcelas: 3,
      valorParcela: 736.5,
      dataInicial: "2026-02-05",
      planoContaId: 33,
    },
    outros: { ...ITEM_PLANO_VAZIO },
    ...over,
  };
}

// Preenchido em 10/09/2025 para o ano letivo 2026 (janela de parcelamento da
// Matrícula aberta: até 5x; 11 mensalidades de 05/02 a 05/12).
function entrada(over: Partial<EntradaFaturamentoMatricula> = {}): EntradaFaturamentoMatricula {
  return {
    plano: planoBase(),
    anoLetivo: 2026,
    dataMatricula: "2025-09-10",
    serie: "1º Ano",
    matriculaValor: 2057.1,
    matriculaParcelas: 3,
    matriculaPrimeiroVencimento: "2025-09-20",
    materialValorAnual: 2209.5,
    materialParcelas: 4,
    refeicoes: refeicoesVazias(),
    semRefeicoes: true,
    valorRefeicao: null,
    horarioEstendido: false,
    valorHoraExtraMensal: null,
    ...over,
  };
}

function tipos(plano: ReturnType<typeof montarPlanoFaturamento>): string[] {
  return plano.lancamentos.map((l) => l.tipo).sort();
}

function tiposPendentes(plano: ReturnType<typeof montarPlanoFaturamento>): string[] {
  return plano.pendencias.map((p) => p.tipo).sort();
}

function soma(l: { parcelas: number; valorParcela: number; valorPrimeiraParcela: number }): number {
  return Math.round((l.valorPrimeiraParcela + l.valorParcela * (l.parcelas - 1)) * 100) / 100;
}

describe("plano do curso lido do Sponte", () => {
  it("lê o ano letivo da descrição do plano", () => {
    expect(anoDoPlanoCurso("2026")).toBe(2026);
    expect(anoDoPlanoCurso("Plano 2027 integral")).toBe(2027);
    expect(anoDoPlanoCurso("Plano antigo")).toBeNull();
  });

  it("nunca escolhe plano de outro ano letivo", () => {
    const planos = [
      planoBase({ planoCursoId: 60, descricaoPlano: "2025" }),
      planoBase({ planoCursoId: 61, descricaoPlano: "Sem ano" }),
    ];
    expect(escolherPlanoDoAnoLetivo(planos, 2026)).toBeNull();
  });

  it("prioriza o plano ativo e padrão do ano", () => {
    const inativoPadrao = planoBase({ planoCursoId: 90, ativo: false, padrao: true });
    const ativoNaoPadrao = planoBase({ planoCursoId: 80, ativo: true, padrao: false });
    const ativoPadrao = planoBase({ planoCursoId: 70, ativo: true, padrao: true });
    const escolhido = escolherPlanoDoAnoLetivo([inativoPadrao, ativoNaoPadrao, ativoPadrao], 2026);
    expect(escolhido?.planoCursoId).toBe(70);
  });

  it("desempata pelo cadastro mais recente entre planos equivalentes", () => {
    const escolhido = escolherPlanoDoAnoLetivo(
      [planoBase({ planoCursoId: 70 }), planoBase({ planoCursoId: 99 })],
      2026,
    );
    expect(escolhido?.planoCursoId).toBe(99);
  });

  it("só a mensalidade depende do plano: matrícula ausente no plano não é problema", () => {
    expect(problemaMensalidadeDoPlano(planoBase(), 2026)).toBeNull();
    expect(
      problemaMensalidadeDoPlano(planoBase({ matricula: { ...ITEM_PLANO_VAZIO } }), 2026),
    ).toBeNull();
    expect(problemaMensalidadeDoPlano(null, 2026)).toMatch(/Nenhum plano/);
    expect(problemaMensalidadeDoPlano(planoBase({ ativo: false }), 2026)).toMatch(/inativo/);
    expect(problemaMensalidadeDoPlano(planoBase(), 2027)).toMatch(/não é do ano letivo 2027/);
    expect(
      problemaMensalidadeDoPlano(planoBase({ mensalidade: { ...ITEM_PLANO_VAZIO } }), 2026),
    ).toMatch(/valor de mensalidade/);
  });
});

describe("calendário das mensalidades (dia 05, fev–dez, Brasília)", () => {
  it("preenchido em setembro do ano anterior: 11 mensalidades de 05/02 a 05/12", () => {
    const datas = vencimentosMensalidade(2027, "2026-09-10");
    expect(datas).toHaveLength(11);
    expect(datas[0]).toBe("2027-02-05");
    expect(datas[10]).toBe("2027-12-06"); // 05/12/2027 é domingo → segunda 06/12
    expect(datas.map((d) => d.slice(5, 7))).toEqual([
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ]);
  });

  it("preenchido em janeiro do ano letivo também dá 11 (05/02 a 05/12)", () => {
    expect(vencimentosMensalidade(2027, "2027-01-20")).toHaveLength(11);
    expect(vencimentosMensalidade(2027, "2027-01-20")[0]).toBe("2027-02-05");
  });

  it("preenchido em 03/03: 10 mensalidades a partir de 05/03", () => {
    const datas = vencimentosMensalidade(2027, "2027-03-03");
    expect(datas).toHaveLength(10);
    expect(datas[0]).toBe("2027-03-05");
    expect(datas[1]).toBe("2027-04-05");
  });

  it("preenchido em 20/03: 10 mensalidades, a de março no próximo dia útil", () => {
    const datas = vencimentosMensalidade(2027, "2027-03-20"); // sábado
    expect(datas).toHaveLength(10);
    expect(datas[0]).toBe("2027-03-22"); // segunda
    expect(datas[1]).toBe("2027-04-05");
    expect(datas[9]).toBe("2027-12-06");
  });

  it("preenchido em 20/12: 1 mensalidade com vencimento imediato (dia útil seguinte)", () => {
    const datas = vencimentosMensalidade(2027, "2027-12-20"); // segunda
    expect(datas).toEqual(["2027-12-21"]);
  });

  it("depois do ano letivo não há mensalidade", () => {
    expect(vencimentosMensalidade(2026, "2027-01-05")).toEqual([]);
  });

  it("dia 05 em fim de semana ou feriado rola para o próximo dia útil", () => {
    expect(vencimentosMensalidade(2026, "2026-04-01")[0]).toBe("2026-04-06"); // 05/04/2026 domingo
    expect(vencimentosMensalidade(2026, "2026-09-01")[0]).toBe("2026-09-08"); // 05/09 sáb, 07/09 feriado
  });

  it("título que segue a 1ª mensalidade: demais parcelas no dia 05 dos meses seguintes", () => {
    expect(vencimentosAPartirDe("2027-03-22", 3)).toEqual([
      "2027-03-22",
      "2027-04-05",
      "2027-05-05",
    ]);
    expect(vencimentosAPartirDe("2026-11-20", 3)).toEqual([
      "2026-11-20",
      "2026-12-07",
      "2027-01-05",
    ]);
  });

  it("conta as refeições marcadas dentro do período", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3, 4, 5];
    refeicoes.snack = [1];
    // 02/02/2026 (segunda) a 13/02/2026 (sexta): 10 dias úteis, 2 segundas.
    expect(contarRefeicoesNoPeriodo(refeicoes, "2026-02-02", "2026-02-13")).toBe(12);
    expect(contarRefeicoesNoPeriodo(refeicoes, "2026-02-13", "2026-02-02")).toBe(0);
  });
});

describe("parcelas do material limitadas às mensalidades restantes", () => {
  it("oferece de 1 até o mínimo entre 8 e as mensalidades restantes", () => {
    expect(opcoesParcelasMaterial(2027, "2026-09-10")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(opcoesParcelasMaterial(2027, "2027-06-01")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(opcoesParcelasMaterial(2027, "2027-12-20")).toEqual([1]);
    expect(opcoesParcelasMaterial(2026, "2027-01-05")).toEqual([1]);
  });

  it("8x pedidas com 7 mensalidades restantes vira 7x e a soma continua igual ao valor anual", () => {
    expect(maxParcelasMaterial(7)).toBe(7);
    const plano = montarPlanoFaturamento(
      entrada({ dataMatricula: "2026-06-01", materialParcelas: 8, materialValorAnual: 2209.5 }),
    );
    const material = plano.lancamentos.find((l) => l.tipo === "material");
    expect(material?.parcelas).toBe(7);
    expect(material?.vencimentos).toEqual([
      "2026-06-05",
      "2026-07-06",
      "2026-08-05",
      "2026-09-08",
      "2026-10-05",
      "2026-11-05",
      "2026-12-07",
    ]);
    expect(soma(material!)).toBe(2209.5);
  });

  it("1ª parcela do material na mesma data da 1ª mensalidade da regra", () => {
    const plano = montarPlanoFaturamento(
      entrada({ dataMatricula: "2026-03-20", materialParcelas: 3 }),
    );
    const material = plano.lancamentos.find((l) => l.tipo === "material");
    const mensalidade = plano.lancamentos.find((l) => l.tipo === "mensalidade");
    expect(material?.primeiroVencimento).toBe(mensalidade?.primeiroVencimento);
    expect(material?.primeiroVencimento).toBe("2026-03-23");
  });
});

describe("cobranças independentes", () => {
  it("plano sem matrícula e com mensalidade lança mensalidade, material, alimentação e hora extra", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3, 4, 5];
    const plano = montarPlanoFaturamento(
      entrada({
        plano: planoBase({ matricula: { ...ITEM_PLANO_VAZIO } }),
        refeicoes,
        semRefeicoes: false,
        valorRefeicao: 25,
        horarioEstendido: true,
        valorHoraExtraMensal: 400,
      }),
    );
    expect(tipos(plano)).toEqual([
      "alimentacao",
      "hora_extra",
      "material",
      "matricula",
      "mensalidade",
    ]);
    expect(plano.pendencias).toEqual([]);
    const mensalidade = plano.lancamentos.find((l) => l.tipo === "mensalidade")!;
    expect(mensalidade.categoria).toBe(CATEGORIA_MENSALIDADE_SPONTE);
    expect(mensalidade.parcelas).toBe(11);
    expect(mensalidade.valorParcela).toBe(1775.95);
    expect(mensalidade.vencimentos[0]).toBe("2026-02-05");
    expect(plano.lancamentos.find((l) => l.tipo === "hora_extra")?.categoria).toBe(
      CATEGORIA_HORA_EXTRA_SPONTE,
    );
    expect(plano.lancamentos.find((l) => l.tipo === "alimentacao")?.categoria).toBe(
      CATEGORIA_ALIMENTACAO_SPONTE,
    );
  });

  it("plano ausente lança Matrícula (School Hub) e material, com pendência só da mensalidade", () => {
    const plano = montarPlanoFaturamento(entrada({ plano: null }));
    expect(tipos(plano)).toEqual(["material", "matricula"]);
    expect(tiposPendentes(plano)).toEqual(["mensalidade"]);
    expect(plano.pendencias[0].motivo).toMatch(/Nenhum plano/);
  });

  it("caso Belvedere/707: plano só com mensalidade e Matrícula do School Hub → tudo lançado", () => {
    const plano = montarPlanoFaturamento(
      entrada({
        plano: planoBase({ descricaoPlano: "2027", matricula: { ...ITEM_PLANO_VAZIO } }),
        anoLetivo: 2027,
        dataMatricula: "2026-09-24",
        serie: "Maternal 3",
        matriculaParcelas: 1,
        matriculaPrimeiroVencimento: "2026-09-30",
        materialParcelas: 6,
        materialValorAnual: 2152.06,
      }),
    );
    expect(tipos(plano)).toEqual(["material", "matricula", "mensalidade"]);
    expect(plano.pendencias).toEqual([]);
    expect(plano.lancamentos.find((l) => l.tipo === "mensalidade")?.parcelas).toBe(11);
  });

  it("sem valor de Matrícula no colégio: pendência só da matrícula, o resto é lançado", () => {
    const plano = montarPlanoFaturamento(entrada({ matriculaValor: null }));
    expect(tipos(plano)).toEqual(["material", "mensalidade"]);
    expect(tiposPendentes(plano)).toEqual(["matricula"]);
  });

  it("sem material configurado: pendência só do material", () => {
    const plano = montarPlanoFaturamento(entrada({ materialValorAnual: null }));
    expect(tipos(plano)).toEqual(["matricula", "mensalidade"]);
    expect(tiposPendentes(plano)).toEqual(["material"]);
  });

  it("alimentação/hora extra sem valor na unidade: pendência própria, sem travar os demais", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1];
    const plano = montarPlanoFaturamento(
      entrada({ refeicoes, semRefeicoes: false, valorRefeicao: null, horarioEstendido: true }),
    );
    expect(tipos(plano)).toEqual(["material", "matricula", "mensalidade"]);
    expect(tiposPendentes(plano)).toEqual(["alimentacao", "hora_extra"]);
  });

  it("nunca gera proporcional e produz no máximo um título por tipo", () => {
    const plano = montarPlanoFaturamento(entrada({ dataMatricula: "2026-03-20" }));
    expect(plano.lancamentos.some((l) => l.tipo === "proporcional")).toBe(false);
    const vistos = new Set(plano.lancamentos.map((l) => l.tipo));
    expect(vistos.size).toBe(plano.lancamentos.length);
  });

  it("status geral: lancado (todos), parcial (algum problema), sem_lancamento (nenhum)", () => {
    expect(statusGeralFaturamento(3, 0)).toBe("lancado");
    expect(statusGeralFaturamento(2, 1)).toBe("parcial");
    expect(statusGeralFaturamento(0, 2)).toBe("sem_lancamento");
  });
});

describe("Matrícula pelo valor do School Hub (colégio × segmento)", () => {
  const valores: ValoresMatricula = {
    infantil: 2057.1,
    fundamental_1: 2057.1,
    fundamental_2: 2234.25,
  };

  it("segmenta pela série", () => {
    expect(segmentoMatricula("2º Período")).toBe("infantil");
    expect(segmentoMatricula("1º Ano")).toBe("fundamental_1");
    expect(segmentoMatricula("5º Ano")).toBe("fundamental_1");
    expect(segmentoMatricula("6º Ano")).toBe("fundamental_2");
    expect(segmentoMatricula("Série X")).toBeNull();
  });

  it("valores diferentes por colégio devolvem o valor de cada um", () => {
    const belvedere: ValoresMatricula = { ...valores, infantil: 1800 };
    expect(valorMatricula(valores, "Maternal 3")).toBe(2057.1);
    expect(valorMatricula(belvedere, "Maternal 3")).toBe(1800);
  });

  it("segmento sem valor devolve null e o plano não gera parcelas da Matrícula", () => {
    const semFundamental: ValoresMatricula = {
      infantil: valores.infantil,
      fundamental_1: valores.fundamental_1,
    };
    expect(valorMatricula(semFundamental, "7º Ano")).toBeNull();
    const plano = montarPlanoFaturamento(
      entrada({ serie: "7º Ano", matriculaValor: valorMatricula(semFundamental, "7º Ano") }),
    );
    expect(plano.lancamentos.some((l) => l.tipo === "matricula")).toBe(false);
    expect(tiposPendentes(plano)).toEqual(["matricula"]);
  });

  it("opções até janeiro: set 5x … dez 2x, jan só à vista", () => {
    expect(parcelamentoMatriculaDisponivel(2057.1, "2026-09-10").maxParcelas).toBe(5);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2026-12-10").maxParcelas).toBe(2);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2027-01-10").somenteAVista).toBe(true);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2027-03-10").somenteAVista).toBe(true);
  });

  it("1ª na data escolhida, demais no dia 05 dos meses seguintes; soma igual ao valor", () => {
    const plano = montarPlanoFaturamento(
      entrada({ matriculaParcelas: 3, matriculaPrimeiroVencimento: "2025-09-20" }),
    );
    const matricula = plano.lancamentos.find((l) => l.tipo === "matricula")!;
    expect(matricula.categoria).toBe(CATEGORIA_MATRICULA_SPONTE);
    expect(matricula.vencimentos).toEqual(["2025-09-20", "2025-10-06", "2025-11-05"]);
    expect(soma(matricula)).toBe(2057.1);
    expect(matricula.valorParcela).toBe(685.7);
    expect(matricula.valorPrimeiraParcela).toBe(685.7);
  });

  it("parcelas fora da janela ou 1º vencimento fora do mês viram pendência da matrícula", () => {
    expect(
      tiposPendentes(
        montarPlanoFaturamento(entrada({ dataMatricula: "2026-01-10", matriculaParcelas: 2 })),
      ),
    ).toContain("matricula");
    expect(
      tiposPendentes(
        montarPlanoFaturamento(entrada({ matriculaPrimeiroVencimento: "2025-10-02" })),
      ),
    ).toContain("matricula");
    expect(
      tiposPendentes(
        montarPlanoFaturamento(entrada({ matriculaPrimeiroVencimento: "2025-09-05" })),
      ),
    ).toContain("matricula");
  });
});

describe("ajustes parcela a parcela no Sponte", () => {
  it("corrige só o que difere do que o Sponte gera a partir do 1º vencimento", () => {
    const plano = montarPlanoFaturamento(
      entrada({ dataMatricula: "2026-03-20", materialParcelas: 3 }),
    );
    const material = plano.lancamentos.find((l) => l.tipo === "material")!;
    // 1ª em 23/03 (2210 - 2*736.50 = 736.50 → sem sobra), demais 05/04 e 05/05 ≠ 23/04 e 23/05.
    const ajustes = parcelasComAjuste(material);
    expect(ajustes.map((a) => a.numero)).toEqual([2, 3]);
    expect(ajustes.map((a) => a.vencimento)).toEqual(["2026-04-06", "2026-05-05"]);
  });

  it("título com centavos na 1ª parcela ajusta a parcela 1", () => {
    const plano = montarPlanoFaturamento(
      entrada({ materialParcelas: 4, materialValorAnual: 2209.51 }),
    );
    const material = plano.lancamentos.find((l) => l.tipo === "material")!;
    expect(material.categoria).toBe(CATEGORIA_MATERIAL_SPONTE);
    expect(parcelasComAjuste(material).some((a) => a.numero === 1)).toBe(true);
  });
});

describe("payload enviado ao Sponte", () => {
  it("envia parcelas e valor de parcela no InsertPlano", () => {
    const xml = montarParametrosInsertPlano({
      sponteAlunoId: "694",
      valor: 552.37,
      vencimento: "2026-02-05",
      formaCobrancaId: -2,
      categoriaId: 33,
      observacao: "Material pedagógico 2026 — matrícula em 4x",
      parcelas: 4,
    });
    expect(xml).toContain("<nAlunoID>694</nAlunoID>");
    expect(xml).toContain("<nNumeroParcelas>4</nNumeroParcelas>");
    expect(xml).toContain("<nValorParcelas>552.37</nValorParcelas>");
    expect(xml).toContain("<dDataPrimeiroVencimento>2026-02-05T00:00:00</dDataPrimeiroVencimento>");
    expect(xml).toContain("<nCategoriaID>33</nCategoriaID>");
  });

  it("ajusta a 1ª parcela com a parcela inteira no UpdateParcela", () => {
    const xml = montarParametrosUpdateParcela({
      contaReceberId: "12345",
      numeroParcela: 1,
      valor: 552.39,
      vencimento: "2026-02-05",
      formaCobrancaId: -2,
      categoriaId: 33,
      observacao: "Material pedagógico 2026",
    });
    expect(xml).toContain("<nContaReceberID>12345</nContaReceberID>");
    expect(xml).toContain("<nNumeroParcela>1</nNumeroParcela>");
    expect(xml).toContain("<nValor>552.39</nValor>");
  });

  it("só considera a cobrança criada com ContaReceberID ou sucesso explícito", () => {
    expect(contaReceberCriada("", "12345")).toBe(true);
    expect(contaReceberCriada("01 - Operação Realizada com Sucesso.", "0")).toBe(true);
    expect(contaReceberCriada("29 - CPF já cadastrado", "0")).toBe(false);
    expect(contaReceberCriada("", "")).toBe(false);
  });
});
