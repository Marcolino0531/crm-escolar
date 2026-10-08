import { describe, expect, it } from "vitest";

import {
  CATEGORIA_MATRICULA_SPONTE,
  CATEGORIA_MENSALIDADE_SPONTE,
  ITEM_PLANO_VAZIO,
  MSG_ESTENDIDO_SEM_HORA_EXTRA,
  anoDoPlanoCurso,
  calcularExtrasPelaRotina,
  cronogramaMensal,
  diasUteisMarcados,
  minutosExtrasPorDia,
  minutosTurnoRegular,
  valorMensalHoraExtra,
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
import { refeicoesVazias, type HorariosRotina } from "@/lib/matricula-form";
import type { Weekday } from "@/lib/diario";
import {
  mensagemPacoteSemValor,
  valorMensalPacote,
  type PacotesExtras,
} from "@/lib/pacotes-extras";
import { CATEGORIA_MATERIAL_SPONTE, formatarBRL } from "@/lib/rematricula";
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

function pacotesBase(over: Partial<PacotesExtras> = {}): PacotesExtras {
  return {
    lanche_manha: 100,
    almoco: 500,
    lanche_tarde: 333.33,
    jantar: 250,
    hora_extra: 890,
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
    horarioEstendido: false,
    diasAtivos: [1, 2, 3, 4, 5],
    pacotes: pacotesBase(),
    ...over,
  };
}

function horariosIguais(dias: readonly Weekday[], entrada: string, saida: string): HorariosRotina {
  const h: HorariosRotina = {};
  for (const d of dias) h[d] = { entrada, saida };
  return h;
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

  it("preenchido em 03/03 sem data de início: 10 meses, março proporcional vencendo no próprio dia", () => {
    const datas = vencimentosMensalidade(2027, "2027-03-03");
    expect(datas).toHaveLength(10);
    expect(datas[0]).toBe("2027-03-03");
    expect(datas[1]).toBe("2027-04-05");
    expect(cronogramaMensal(2027, "2027-03-03")[0].proporcao).toEqual({ dias: 29, diasMes: 31 });
  });

  it("preenchido em 20/03: 10 mensalidades, a de março no próximo dia útil", () => {
    const datas = vencimentosMensalidade(2027, "2027-03-20"); // sábado
    expect(datas).toHaveLength(10);
    expect(datas[0]).toBe("2027-03-22"); // segunda
    expect(datas[1]).toBe("2027-04-05");
    expect(datas[9]).toBe("2027-12-06");
  });

  it("preenchido em 20/12 sem data de início: 1 mensalidade proporcional (12/31) vencendo no próprio dia", () => {
    const datas = vencimentosMensalidade(2027, "2027-12-20"); // segunda
    expect(datas).toEqual(["2027-12-20"]);
    expect(cronogramaMensal(2027, "2027-12-20")[0].proporcao).toEqual({ dias: 12, diasMes: 31 });
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

  it("dias úteis marcados: só seg–sex, sem repetição", () => {
    expect(diasUteisMarcados([1, 2, 3, 4, 5])).toBe(5);
    expect(diasUteisMarcados([1, 1, 3, 0, 6])).toBe(2);
    expect(diasUteisMarcados([])).toBe(0);
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
    expect(material?.primeiroVencimento).toBe("2026-03-20"); // sexta: vence no próprio dia
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
        horarioEstendido: true,
        horarios: horariosIguais([1, 2, 3, 4, 5], "07:20", "18:20"),
      }),
    );
    expect(tipos(plano)).toEqual(["almoco", "hora_extra", "material", "matricula", "mensalidade"]);
    expect(plano.pendencias).toEqual([]);
    const mensalidade = plano.lancamentos.find((l) => l.tipo === "mensalidade")!;
    expect(mensalidade.categoria).toBe(CATEGORIA_MENSALIDADE_SPONTE);
    expect(mensalidade.parcelas).toBe(11);
    expect(mensalidade.valorParcela).toBe(1775.95);
    expect(mensalidade.vencimentos[0]).toBe("2026-02-05");
    expect(plano.lancamentos.find((l) => l.tipo === "hora_extra")?.categoria).toBe("Hora Extra");
    expect(plano.lancamentos.find((l) => l.tipo === "almoco")?.categoria).toBe("Almoço");
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

  it("sem linha de pacotes para o colégio × ano: pendência própria por item, sem travar os demais", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1];
    const plano = montarPlanoFaturamento(
      entrada({ refeicoes, semRefeicoes: false, horarioEstendido: true, pacotes: null }),
    );
    expect(tipos(plano)).toEqual(["material", "matricula", "mensalidade"]);
    expect(tiposPendentes(plano)).toEqual(["almoco", "hora_extra"]);
    expect(plano.pendencias.find((p) => p.tipo === "almoco")?.motivo).toBe(
      "Pacote de Almoço 2026 sem valor em Cadastros Gerais > Valor Pacotes Extras. Lance na mão.",
    );
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

describe("pacotes extras (refeições e hora extra) na matrícula", () => {
  it("valor mensal = pacote ÷ 5 × dias, ao centavo (meio para cima)", () => {
    expect(valorMensalPacote(500, 3)).toBe(300);
    expect(valorMensalPacote(333.33, 5)).toBe(333.33);
    expect(valorMensalPacote(100, 1)).toBe(20);
    expect(valorMensalPacote(100.01, 3)).toBe(60.01);
    expect(valorMensalPacote(890, 5)).toBe(890);
    expect(valorMensalPacote(890, 2)).toBe(356);
  });

  it("24/09/2026 para 2027: cada item em 11 parcelas iguais (fev–dez), julho e dezembro cheios", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 3, 5];
    refeicoes.snack = [1, 2, 3, 4, 5];
    const plano = montarPlanoFaturamento(
      entrada({
        anoLetivo: 2027,
        dataMatricula: "2026-09-24",
        matriculaPrimeiroVencimento: "2026-09-30",
        refeicoes,
        semRefeicoes: false,
        horarioEstendido: true,
        diasAtivos: [1, 2, 3, 4, 5],
        // 1º Ano (turno 5h20): 07:20–13:40 = 1 hora extra por dia → pacote cheio.
        horarios: horariosIguais([1, 2, 3, 4, 5], "07:20", "13:40"),
      }),
    );
    const esperado = vencimentosMensalidade(2027, "2026-09-24");
    expect(esperado).toHaveLength(11);
    for (const [tipo, valor] of [
      ["almoco", 300],
      ["lanche_tarde", 333.33],
      ["hora_extra", 890],
    ] as const) {
      const l = plano.lancamentos.find((x) => x.tipo === tipo)!;
      expect(l.parcelas).toBe(11);
      expect(l.vencimentos).toEqual(esperado);
      expect(l.valorParcela).toBe(valor);
      expect(l.valorPrimeiraParcela).toBe(valor);
      expect(l.vencimentos[5]).toBe("2027-07-05");
      expect(l.vencimentos[10]).toBe("2027-12-06");
    }
    expect(plano.lancamentos.find((x) => x.tipo === "almoco")?.observacao).toBe(
      `Almoço 2027 — 3x por semana — pacote ${formatarBRL(500)}`,
    );
  });

  it("20/06/2027 para 2027 sem data de início: junho proporcional (11/30) vencendo em 21/06, demais jul–dez cheios", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.breakfast = [2];
    const plano = montarPlanoFaturamento(
      entrada({
        anoLetivo: 2027,
        dataMatricula: "2027-06-20",
        matriculaParcelas: 1,
        matriculaPrimeiroVencimento: "2027-06-25",
        refeicoes,
        semRefeicoes: false,
        horarioEstendido: true,
        diasAtivos: [2, 4],
        horarios: horariosIguais([2, 4], "07:20", "13:40"),
      }),
    );
    const esperado = vencimentosMensalidade(2027, "2027-06-20");
    expect(esperado[0]).toBe("2027-06-21");
    expect(esperado).toHaveLength(7);
    const lanche = plano.lancamentos.find((x) => x.tipo === "lanche_manha")!;
    expect(lanche.vencimentos).toEqual(esperado);
    expect(lanche.valorParcela).toBe(20);
    expect(lanche.valorPrimeiraParcela).toBe(7.33);
    expect(lanche.total).toBe(127.33);
    const he = plano.lancamentos.find((x) => x.tipo === "hora_extra")!;
    expect(he.vencimentos).toEqual(esperado);
    expect(he.valorParcela).toBe(356);
    expect(he.valorPrimeiraParcela).toBe(130.53);
  });

  it("Jantar não é cobrado em série sem jantar, mesmo marcado", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.dinner = [1, 2, 3, 4, 5];
    refeicoes.lunch = [1];
    const semJantar = montarPlanoFaturamento(
      entrada({ serie: "1º Ano", refeicoes, semRefeicoes: false }),
    );
    expect(tipos(semJantar)).not.toContain("jantar");
    expect(tiposPendentes(semJantar)).toEqual([]);
    const comJantar = montarPlanoFaturamento(
      entrada({ serie: "Maternal 3", refeicoes, semRefeicoes: false }),
    );
    expect(tipos(comJantar)).toContain("jantar");
  });

  it("pacote zerado gera pendência só daquela refeição; as outras são lançadas", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3];
    refeicoes.snack = [1, 2, 3, 4, 5];
    const plano = montarPlanoFaturamento(
      entrada({ refeicoes, semRefeicoes: false, pacotes: pacotesBase({ lanche_tarde: 0 }) }),
    );
    expect(tipos(plano)).toEqual(["almoco", "material", "matricula", "mensalidade"]);
    expect(plano.pendencias).toEqual([
      { tipo: "lanche_tarde", motivo: mensagemPacoteSemValor("lanche_tarde", 2026) },
    ]);
  });

  it("semRefeicoes suprime as refeições; sem horário estendido não há hora extra", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3];
    const plano = montarPlanoFaturamento(entrada({ refeicoes, semRefeicoes: true }));
    expect(tipos(plano)).toEqual(["material", "matricula", "mensalidade"]);
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

  it("opções pela janela até 31/01 do ano letivo: set 5x … dez 2x; no próprio ano só à vista", () => {
    expect(parcelamentoMatriculaDisponivel(2057.1, "2026-09-10", 2027).maxParcelas).toBe(5);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2026-12-10", 2027).maxParcelas).toBe(2);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2027-01-10", 2027).somenteAVista).toBe(true);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2027-03-10", 2027).somenteAVista).toBe(true);
  });

  it("1ª na data escolhida (sábado → dia útil), demais no dia 05 útil dos meses seguintes; soma igual ao valor", () => {
    const plano = montarPlanoFaturamento(
      entrada({ matriculaParcelas: 3, matriculaPrimeiroVencimento: "2025-09-20" }),
    );
    const matricula = plano.lancamentos.find((l) => l.tipo === "matricula")!;
    expect(matricula.categoria).toBe(CATEGORIA_MATRICULA_SPONTE);
    expect(matricula.vencimentos).toEqual(["2025-09-22", "2025-10-06", "2025-11-05"]);
    expect(soma(matricula)).toBe(2057.1);
    expect(matricula.valorParcela).toBe(685.7);
    expect(matricula.valorPrimeiraParcela).toBe(685.7);
  });

  it("parcelas fora da janela ou 1º vencimento fora da janela viram pendência da matrícula", () => {
    expect(
      tiposPendentes(
        montarPlanoFaturamento(entrada({ dataMatricula: "2026-01-10", matriculaParcelas: 2 })),
      ),
    ).toContain("matricula");
    expect(
      tiposPendentes(
        montarPlanoFaturamento(entrada({ matriculaPrimeiroVencimento: "2025-12-02" })),
      ),
    ).toContain("matricula");
    expect(
      tiposPendentes(
        montarPlanoFaturamento(entrada({ matriculaPrimeiroVencimento: "2025-09-12" })),
      ),
    ).toContain("matricula");
  });

  it("ano em curso (T4.8): 28/09/2026, início 19/10/2026 → 1x de R$ 300,00 (3/12) em 01/10/2026", () => {
    const plano = montarPlanoFaturamento(
      entrada({
        anoLetivo: 2026,
        dataMatricula: "2026-09-28",
        dataInicio: "2026-10-19",
        matriculaValor: 1200,
        matriculaParcelas: 1,
        matriculaPrimeiroVencimento: "2026-10-01",
      }),
    );
    const m = plano.lancamentos.find((l) => l.tipo === "matricula")!;
    expect(m.vencimentos).toEqual(["2026-10-01"]);
    expect(soma(m)).toBe(300);
    expect(m.observacao).toContain("proporcional 3/12");
    expect(
      tiposPendentes(
        montarPlanoFaturamento(
          entrada({
            anoLetivo: 2026,
            dataMatricula: "2026-09-28",
            dataInicio: "2026-10-19",
            matriculaParcelas: 2,
            matriculaPrimeiroVencimento: "2026-10-01",
          }),
        ),
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

describe("ETAPA 3 — primeiro mês proporcional pela data de início + hora extra por minutos", () => {
  const SEG_SEX: readonly Weekday[] = [1, 2, 3, 4, 5];
  const PACOTE_HE = 227.6;

  // Stella: Belvedere, Berçário (Infantil), 2026; preenchido 28/09, início 19/10,
  // seg–sex 07:20–16:50.
  function stella(over: Partial<EntradaFaturamentoMatricula> = {}): EntradaFaturamentoMatricula {
    return entrada({
      anoLetivo: 2026,
      dataMatricula: "2026-09-28",
      dataInicio: "2026-10-19",
      serie: "Berçário",
      plano: planoBase({
        matricula: { ...ITEM_PLANO_VAZIO },
        mensalidade: { ...planoBase().mensalidade, valorParcela: 1000 },
      }),
      matriculaValor: null,
      matriculaParcelas: null,
      matriculaPrimeiroVencimento: null,
      materialParcelas: 3,
      horarioEstendido: true,
      diasAtivos: SEG_SEX,
      horarios: horariosIguais(SEG_SEX, "07:20", "16:50"),
      pacotes: pacotesBase({ hora_extra: PACOTE_HE }),
      ...over,
    });
  }

  it("T3.1 Stella: 5h extras/dia → R$ 1.138,00; parcelas 19/10 (13/31), 05/11 e 07/12; nada em setembro", () => {
    expect(minutosTurnoRegular("Berçário")).toBe(270);
    expect(minutosExtrasPorDia(horariosIguais(SEG_SEX, "07:20", "16:50"), "Berçário")).toEqual({
      1: 300,
      2: 300,
      3: 300,
      4: 300,
      5: 300,
    });
    expect(valorMensalHoraExtra(PACOTE_HE, 1500)).toBe(1138);

    const he = montarPlanoFaturamento(stella()).lancamentos.find((l) => l.tipo === "hora_extra")!;
    expect(he.parcelas).toBe(3);
    expect(he.vencimentos).toEqual(["2026-10-19", "2026-11-05", "2026-12-07"]);
    expect(he.valorPrimeiraParcela).toBe(477.23);
    expect(he.valorParcela).toBe(1138);
    expect(he.total).toBe(2753.23);
    expect(he.vencimentos.some((v) => v.startsWith("2026-09"))).toBe(false);
    expect(he.observacao).toBe(
      `Hora Extra 2026 — 5h por dia, 5x por semana — ${formatarBRL(PACOTE_HE)} por hora — 1ª parcela proporcional 13/31 dias`,
    );
    expect(parcelasComAjuste(he)).toEqual([
      { numero: 1, valor: 477.23, vencimento: "2026-10-19" },
      { numero: 2, valor: 1138, vencimento: "2026-11-05" },
      { numero: 3, valor: 1138, vencimento: "2026-12-07" },
    ]);
  });

  it("T3.2 Infantil seg–sex 07:20–16:30 (4h40/dia): R$ 1.062,13", () => {
    const porDia = minutosExtrasPorDia(horariosIguais(SEG_SEX, "07:20", "16:30"), "Berçário");
    const semana = Object.values(porDia).reduce((s, m) => s + m, 0);
    expect(semana).toBe(280 * 5);
    expect(valorMensalHoraExtra(PACOTE_HE, semana)).toBe(1062.13);
  });

  it("T3.3 Infantil 3 dias/semana 07:20–16:50: R$ 682,80", () => {
    const porDia = minutosExtrasPorDia(horariosIguais([1, 3, 5], "07:20", "16:50"), "Maternal 1");
    const semana = Object.values(porDia).reduce((s, m) => s + m, 0);
    expect(valorMensalHoraExtra(PACOTE_HE, semana)).toBe(682.8);
  });

  it("T3.4 Fundamental seg–sex 07:20–18:20 (5h40/dia): R$ 1.289,73", () => {
    expect(minutosTurnoRegular("1º Ano")).toBe(320);
    const porDia = minutosExtrasPorDia(horariosIguais(SEG_SEX, "07:20", "18:20"), "1º Ano");
    expect(porDia[1]).toBe(340);
    const semana = Object.values(porDia).reduce((s, m) => s + m, 0);
    expect(valorMensalHoraExtra(PACOTE_HE, semana)).toBe(1289.73);
  });

  it("T3.5 mensalidade R$ 1.000 da Stella: 19/10 R$ 419,35; 05/11 e 07/12 R$ 1.000", () => {
    const m = montarPlanoFaturamento(stella()).lancamentos.find((l) => l.tipo === "mensalidade")!;
    expect(m.vencimentos).toEqual(["2026-10-19", "2026-11-05", "2026-12-07"]);
    expect(m.valorPrimeiraParcela).toBe(419.35);
    expect(m.valorParcela).toBe(1000);
    expect(m.total).toBe(2419.35);
  });

  it("T3.6 início em sábado 17/10: 1ª parcela R$ 483,87 (15/31) vencendo segunda 19/10", () => {
    const m = montarPlanoFaturamento(stella({ dataInicio: "2026-10-17" })).lancamentos.find(
      (l) => l.tipo === "mensalidade",
    )!;
    expect(m.vencimentos[0]).toBe("2026-10-19");
    expect(m.valorPrimeiraParcela).toBe(483.87);
    expect(cronogramaMensal(2026, "2026-09-28", "2026-10-17")[0].proporcao).toEqual({
      dias: 15,
      diasMes: 31,
    });
  });

  it("T3.7 início 01/11, preenchido 28/09: novembro cheio em 05/11 e dezembro em 07/12; nada antes", () => {
    const c = cronogramaMensal(2026, "2026-09-28", "2026-11-01");
    expect(c).toEqual([
      { vencimento: "2026-11-05", proporcao: null },
      { vencimento: "2026-12-07", proporcao: null },
    ]);
    const m = montarPlanoFaturamento(stella({ dataInicio: "2026-11-01" })).lancamentos.find(
      (l) => l.tipo === "mensalidade",
    )!;
    expect(m.valorPrimeiraParcela).toBe(1000);
    expect(m.parcelas).toBe(2);
  });

  it("T3.8 antecipada: preenchido 28/09/2026, ano 2027, início 03/02/2027: 11 parcelas cheias fev–dez", () => {
    const c = cronogramaMensal(2027, "2026-09-28", "2027-02-03");
    expect(c).toHaveLength(11);
    expect(c.every((m) => m.proporcao === null)).toBe(true);
    expect(c[0].vencimento).toBe("2027-02-05");
    expect(c[10].vencimento).toBe("2027-12-06");
    // Início antes de fevereiro também não gera nada antes de fevereiro.
    expect(cronogramaMensal(2027, "2026-09-28", "2027-01-10")).toEqual(c);
  });

  it("T3.9 ano 2027, início 15/03: março R$ 548,39 (17/31) em 15/03; abr–dez cheios (dez em 06/12); 10 parcelas", () => {
    const m = montarPlanoFaturamento(
      stella({
        anoLetivo: 2027,
        dataInicio: "2027-03-15",
        plano: planoBase({
          descricaoPlano: "2027",
          matricula: { ...ITEM_PLANO_VAZIO },
          mensalidade: { ...planoBase().mensalidade, valorParcela: 1000 },
        }),
      }),
    ).lancamentos.find((l) => l.tipo === "mensalidade")!;
    expect(m.parcelas).toBe(10);
    expect(m.vencimentos[0]).toBe("2027-03-15");
    expect(m.vencimentos[9]).toBe("2027-12-06");
    expect(m.valorPrimeiraParcela).toBe(548.39);
    expect(m.valorParcela).toBe(1000);
    expect(m.observacao).toContain("proporcional 17/31 dias");
  });

  it("T3.10 preenchido depois do início (25/10, início 19/10): outubro R$ 419,35 em 26/10; nov e dez cheios", () => {
    const m = montarPlanoFaturamento(stella({ dataMatricula: "2026-10-25" })).lancamentos.find(
      (l) => l.tipo === "mensalidade",
    )!;
    expect(m.vencimentos).toEqual(["2026-10-26", "2026-11-05", "2026-12-07"]);
    expect(m.valorPrimeiraParcela).toBe(419.35);
    expect(m.valorParcela).toBe(1000);
  });

  it("T3.11 material da Stella: no máximo 3 parcelas, 1ª ancorada na 1ª mensalidade", () => {
    expect(opcoesParcelasMaterial(2026, "2026-09-28", "2026-10-19")).toEqual([1, 2, 3]);
    expect(opcoesParcelasMaterial(2026, "2026-09-28")).toEqual([1, 2, 3, 4]);
    const plano = montarPlanoFaturamento(stella({ materialParcelas: 8 }));
    const mat = plano.lancamentos.find((l) => l.tipo === "material")!;
    expect(mat.parcelas).toBe(3);
    expect(mat.primeiroVencimento).toBe("2026-10-19");
    expect(mat.vencimentos).toEqual(["2026-10-19", "2026-11-05", "2026-12-07"]);
    expect(soma(mat)).toBe(2209.5);
  });

  it("T3.12 estendido com saída igual ao fim do turno regular: sem hora extra e pendência própria", () => {
    const plano = montarPlanoFaturamento(
      stella({ horarios: horariosIguais(SEG_SEX, "07:20", "11:50") }),
    );
    expect(plano.lancamentos.some((l) => l.tipo === "hora_extra")).toBe(false);
    expect(plano.pendencias.filter((p) => p.tipo === "hora_extra")).toEqual([
      {
        tipo: "hora_extra",
        motivo: "Horário estendido sem horas além do turno regular. Confira a rotina.",
      },
    ]);
    expect(MSG_ESTENDIDO_SEM_HORA_EXTRA).toBe(
      "Horário estendido sem horas além do turno regular. Confira a rotina.",
    );
  });
});

describe("calcularExtrasPelaRotina (Extras pela rotina salva)", () => {
  const base = {
    anoLetivo: 2027,
    serie: "1º Ano",
    refeicoes: refeicoesVazias(),
    semRefeicoes: false,
    horarioEstendido: false,
    diasAtivos: [1, 2, 3, 4, 5] as Weekday[],
    pacotes: pacotesBase({ lanche_manha: 100.01, almoco: 100.01, lanche_tarde: 100.01 }),
  };

  it("refeição em 5, 3 e 1 dia(s): pacote ÷ 5 × dias, ao centavo", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3, 4, 5];
    refeicoes.breakfast = [1, 3, 5];
    refeicoes.snack = [2];
    const extras = calcularExtrasPelaRotina({ ...base, refeicoes });
    expect(extras.map((x) => [x.tipo, x.valorMensal])).toEqual([
      ["lanche_manha", 60.01],
      ["almoco", 100.01],
      ["lanche_tarde", 20],
    ]);
    expect(extras[1]).toEqual({
      tipo: "almoco",
      categoria: "Almoço",
      valorMensal: 100.01,
      observacao: `Almoço 2027 — 5x por semana — pacote ${formatarBRL(100.01)}`,
      pendencia: null,
    });
  });

  it("hora extra com minutos diferentes por dia soma os minutos da semana", () => {
    // 1º Ano (turno 5h20): seg 1h, qua 1h30, demais dias sem minuto extra.
    const horarios: HorariosRotina = {
      ...horariosIguais([2, 4, 5], "07:20", "12:40"),
      1: { entrada: "07:20", saida: "13:40" },
      3: { entrada: "07:20", saida: "14:10" },
    };
    const extras = calcularExtrasPelaRotina({ ...base, horarioEstendido: true, horarios });
    // 890 × (150 min ÷ 60) ÷ 5 = 445,00.
    expect(extras).toEqual([
      {
        tipo: "hora_extra",
        categoria: "Hora Extra",
        valorMensal: 445,
        observacao: `Hora Extra 2027 — 2h30 por semana, 2x por semana — ${formatarBRL(890)} por hora`,
        pendencia: null,
      },
    ]);
    expect(valorMensalHoraExtra(890, 150)).toBe(445);
  });

  it("Jantar fica fora para série que não serve jantar", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.dinner = [1, 2, 3, 4, 5];
    expect(calcularExtrasPelaRotina({ ...base, serie: "7º Ano", refeicoes })).toEqual([]);
    const bercario = calcularExtrasPelaRotina({ ...base, serie: "Berçário", refeicoes });
    expect(bercario.map((x) => [x.tipo, x.valorMensal])).toEqual([["jantar", 250]]);
  });

  it("pacote sem valor (ou sem linha de pacotes) vira pendência do item", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3];
    const zerado = calcularExtrasPelaRotina({
      ...base,
      refeicoes,
      pacotes: pacotesBase({ almoco: 0 }),
    });
    expect(zerado).toEqual([
      {
        tipo: "almoco",
        categoria: "Almoço",
        valorMensal: null,
        observacao: null,
        pendencia: mensagemPacoteSemValor("almoco", 2027),
      },
    ]);
    const semPacotes = calcularExtrasPelaRotina({ ...base, refeicoes, pacotes: null });
    expect(semPacotes.map((x) => x.pendencia)).toEqual([mensagemPacoteSemValor("almoco", 2027)]);
  });

  it("sem refeições e sem horário estendido: nenhum Extra", () => {
    const refeicoes = refeicoesVazias();
    refeicoes.lunch = [1, 2, 3, 4, 5];
    expect(calcularExtrasPelaRotina({ ...base, refeicoes, semRefeicoes: true })).toEqual([]);
  });
});
