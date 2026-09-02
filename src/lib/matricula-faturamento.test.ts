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
  mensalidadeProporcional,
  mensalidadesAVencer,
  montarPlanoFaturamento,
  problemasDoPlano,
  vencimentosMensais,
  type EntradaFaturamentoMatricula,
  type PlanoCursoSponte,
} from "@/lib/matricula-faturamento";
import { refeicoesVazias } from "@/lib/matricula-form";
import {
  CATEGORIA_MATERIAL_SPONTE,
  opcoesParcelamentoMaterialPrimeira,
  parcelamentoMaterialPrimeira,
  parcelasMaterialValida,
} from "@/lib/rematricula";
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

function entrada(over: Partial<EntradaFaturamentoMatricula> = {}): EntradaFaturamentoMatricula {
  return {
    plano: planoBase(),
    anoLetivo: 2026,
    dataMatricula: "2026-01-10",
    serie: "1º Ano",
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

  it("rejeita plano inativo, de outro ano ou sem valores", () => {
    expect(problemasDoPlano(planoBase(), 2026)).toEqual([]);
    expect(problemasDoPlano(planoBase({ ativo: false }), 2026)).toHaveLength(1);
    expect(problemasDoPlano(planoBase(), 2027)).toHaveLength(1);
    expect(problemasDoPlano(planoBase({ matricula: { ...ITEM_PLANO_VAZIO } }), 2026)).toHaveLength(
      1,
    );
    expect(
      problemasDoPlano(planoBase({ mensalidade: { ...ITEM_PLANO_VAZIO } }), 2026),
    ).toHaveLength(1);
  });
});

describe("cronograma", () => {
  it("gera um vencimento por parcela, mês a mês", () => {
    expect(vencimentosMensais("2026-02-05", 3)).toEqual(["2026-02-05", "2026-03-05", "2026-04-06"]);
  });

  it("separa as mensalidades já vencidas das que ainda vencem", () => {
    const { vencimentos, puladas } = mensalidadesAVencer(planoBase(), "2026-04-20");
    expect(puladas).toEqual(["2026-02-05", "2026-03-05", "2026-04-06"]);
    expect(vencimentos[0]).toBe("2026-05-05");
    expect(vencimentos).toHaveLength(8);
  });

  it("calcula o proporcional pelos dias restantes do mês de entrada", () => {
    // 22 dias restantes de 31 (dia 10 inclusive).
    expect(mensalidadeProporcional(1000, "2026-03-10")).toBe(709.68);
    expect(mensalidadeProporcional(1000, "2026-03-01")).toBe(1000);
  });

  it("conta as refeições marcadas dentro do período", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 3];
    refeicoes.snack = [1];
    // 05/01/2026 é segunda; até 14/01 há 2 segundas-almoço? (05 e 12), 2 quartas
    // (07 e 14) e 2 segundas-lanche.
    expect(contarRefeicoesNoPeriodo(refeicoes, "2026-01-05", "2026-01-14")).toBe(6);
    expect(contarRefeicoesNoPeriodo(refeicoes, "2026-01-14", "2026-01-05")).toBe(0);
    expect(contarRefeicoesNoPeriodo(refeicoesVazias(), "2026-01-05", "2026-12-31")).toBe(0);
  });
});

describe("parcelamento do material escolhido pelo responsável", () => {
  it("aceita só de 1 a 8 parcelas", () => {
    expect(parcelasMaterialValida(1)).toBe(true);
    expect(parcelasMaterialValida(8)).toBe(true);
    expect(parcelasMaterialValida(0)).toBe(false);
    expect(parcelasMaterialValida(9)).toBe(false);
    expect(parcelasMaterialValida(2.5)).toBe(false);
  });

  it("oferece as oito opções sem perder centavos", () => {
    const opcoes = opcoesParcelamentoMaterialPrimeira(1000.03);
    expect(opcoes).toHaveLength(8);
    for (const op of opcoes) {
      const soma = op.valorPrimeiraParcela + op.valorParcela * (op.parcelas - 1);
      expect(Math.round(soma * 100)).toBe(100003);
    }
  });

  it("joga a sobra de centavos na primeira parcela", () => {
    const op = parcelamentoMaterialPrimeira(1000, 3);
    expect(op.valorParcela).toBe(333.33);
    expect(op.valorPrimeiraParcela).toBe(333.34);
  });
});

describe("montagem do plano de faturamento", () => {
  it("não lança nada quando o plano do Sponte não serve", () => {
    const r = montarPlanoFaturamento(entrada({ plano: planoBase({ ativo: false }) }));
    expect(r.lancamentos).toEqual([]);
    expect(r.pendencias.length).toBeGreaterThan(0);
  });

  it("lança matrícula, mensalidades e material com as parcelas escolhidas", () => {
    const r = montarPlanoFaturamento(entrada());
    const tipos = r.lancamentos.map((l) => l.tipo);
    expect(tipos).toEqual(["matricula", "mensalidade", "material"]);

    const matricula = r.lancamentos[0];
    expect(matricula.categoria).toBe(CATEGORIA_MATRICULA_SPONTE);
    expect(matricula.parcelas).toBe(1);
    expect(matricula.total).toBe(1847.25);

    const mensalidade = r.lancamentos[1];
    expect(mensalidade.categoria).toBe(CATEGORIA_MENSALIDADE_SPONTE);
    expect(mensalidade.parcelas).toBe(11);
    expect(mensalidade.primeiroVencimento).toBe("2026-02-05");

    const material = r.lancamentos[2];
    expect(material.categoria).toBe(CATEGORIA_MATERIAL_SPONTE);
    expect(material.parcelas).toBe(4);
    expect(material.total).toBe(2209.5);
    expect(material.primeiroVencimento).toBe("2026-02-05");
  });

  it("gera proporcional quando a mensalidade do mês de entrada já venceu", () => {
    const r = montarPlanoFaturamento(entrada({ dataMatricula: "2026-02-20" }));
    const proporcional = r.lancamentos.find((l) => l.tipo === "proporcional");
    expect(proporcional?.parcelas).toBe(1);
    expect(proporcional?.total).toBe(mensalidadeProporcional(1775.95, "2026-02-20"));
    expect(r.lancamentos.find((l) => l.tipo === "mensalidade")?.parcelas).toBe(10);
  });

  it("vira pendência (não cobrança) quando falta configuração do material", () => {
    const r = montarPlanoFaturamento(entrada({ materialValorAnual: null }));
    expect(r.lancamentos.some((l) => l.tipo === "material")).toBe(false);
    expect(r.pendencias.join(" ")).toContain("Material pedagógico");

    const semEscolha = montarPlanoFaturamento(entrada({ materialParcelas: null }));
    expect(semEscolha.lancamentos.some((l) => l.tipo === "material")).toBe(false);
    expect(semEscolha.pendencias.join(" ")).toContain("parcelas do material");
  });

  it("cobra alimentação pelas refeições reais e hora extra por mês a vencer", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3, 4, 5];
    const r = montarPlanoFaturamento(
      entrada({
        refeicoes,
        semRefeicoes: false,
        valorRefeicao: 30,
        horarioEstendido: true,
        valorHoraExtraMensal: 500,
      }),
    );

    const alimentacao = r.lancamentos.find((l) => l.tipo === "alimentacao");
    const almocos = contarRefeicoesNoPeriodo(refeicoes, "2026-01-10", "2026-12-31");
    expect(alimentacao?.categoria).toBe(CATEGORIA_ALIMENTACAO_SPONTE);
    expect(alimentacao?.total).toBe(almocos * 30);
    expect(alimentacao?.parcelas).toBe(11);

    const horaExtra = r.lancamentos.find((l) => l.tipo === "hora_extra");
    expect(horaExtra?.categoria).toBe(CATEGORIA_HORA_EXTRA_SPONTE);
    expect(horaExtra?.parcelas).toBe(11);
    expect(horaExtra?.total).toBe(5500);
  });

  it("não cobra alimentação nem hora extra sem valor configurado na unidade", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1];
    const r = montarPlanoFaturamento(
      entrada({ refeicoes, semRefeicoes: false, horarioEstendido: true }),
    );
    expect(r.lancamentos.some((l) => l.tipo === "alimentacao")).toBe(false);
    expect(r.lancamentos.some((l) => l.tipo === "hora_extra")).toBe(false);
    expect(r.pendencias.join(" ")).toContain("valor por refeição");
    expect(r.pendencias.join(" ")).toContain("hora extra");
  });

  it("produz no máximo um título por tipo (trava de idempotência do log)", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3, 4, 5];
    const r = montarPlanoFaturamento(
      entrada({
        dataMatricula: "2026-03-20",
        refeicoes,
        semRefeicoes: false,
        valorRefeicao: 30,
        horarioEstendido: true,
        valorHoraExtraMensal: 500,
      }),
    );
    const tipos = r.lancamentos.map((l) => l.tipo);
    expect(new Set(tipos).size).toBe(tipos.length);
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
