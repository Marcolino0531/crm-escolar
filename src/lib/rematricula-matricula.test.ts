import { describe, expect, it } from "vitest";
import type { ParcelaAberta } from "./cantina";
import {
  cronogramaMatricula,
  formatarDataBR,
  limitesPrimeiroVencimento,
  parcelamentoMatricula,
  parcelamentoMatriculaDisponivel,
  parcelasMatriculaValida,
  perguntaFrequenciaParcial,
  proporcaoMatriculaAnoEmCurso,
  textoJanelaPrimeiroVencimento,
  textoMatriculaAnoEmCurso,
  valorMatriculaProporcional,
  vencimentoEfetivoPrimeiraParcela,
  vencimentoMinimoMatricula,
  segmentoMatricula,
  turnosDisponiveisParaSerie,
  unidadeRestringeTurno,
  validarPrimeiroVencimento,
  valorMatricula,
  matriculaPortal,
  ROTULO_SEGMENTO_MATRICULA,
  SEGMENTOS_MATRICULA,
  mensagemPendenciasCampanha,
  segmentosSemValorMatricula,
  valorMensalidadeComDesconto,
  vencimentosMatriculaPelasMensalidades,
  type TurmaParaTurno,
} from "./rematricula-matricula";

describe("matrícula antecipada: janela da 1ª parcela por número de parcelas (T4.1–T4.7, T4.11)", () => {
  it("T4.1: preenchida em 28/09/2026 para 2027 — 4x até 31/10, 3x até 30/11, 2x até 31/12, 1x até 31/01", () => {
    expect(limitesPrimeiroVencimento("2026-09-28", 2027, 4)).toEqual({
      minimo: "2026-10-01",
      maximo: "2026-10-31",
      semEscolha: false,
    });
    expect(limitesPrimeiroVencimento("2026-09-28", 2027, 3)?.maximo).toBe("2026-11-30");
    expect(limitesPrimeiroVencimento("2026-09-28", 2027, 2)?.maximo).toBe("2026-12-31");
    expect(limitesPrimeiroVencimento("2026-09-28", 2027, 1)?.maximo).toBe("2027-01-31");
    const d = parcelamentoMatriculaDisponivel(1200, "2026-09-28", 2027);
    expect(d.anoEmCurso).toBe(false);
    expect(d.maxParcelas).toBe(4);
    expect(d.opcoes.map((o) => [o.parcelas, o.vencimentoMinimo, o.vencimentoMaximo])).toEqual([
      [1, "2026-10-01", "2027-01-31"],
      [2, "2026-10-01", "2026-12-31"],
      [3, "2026-10-01", "2026-11-30"],
      [4, "2026-10-01", "2026-10-31"],
    ]);
    expect(textoJanelaPrimeiroVencimento(limitesPrimeiroVencimento("2026-09-28", 2027, 4)!)).toBe(
      "Escolha o vencimento da 1ª parcela entre 01/10/2026 e 31/10/2026. As demais acompanham o vencimento da mensalidade.",
    );
  });
  it("T4.2: domingo 20/12/2026 é aceito e o vencimento efetivo é segunda 21/12/2026", () => {
    expect(validarPrimeiroVencimento("2026-12-20", "2026-09-28", 2027, 2)).toBe("");
    expect(vencimentoEfetivoPrimeiraParcela("2026-12-20")).toBe("2026-12-21");
    expect(vencimentosMatriculaPelasMensalidades([], "2026-12-20", 1)).toEqual(["2026-12-21"]);
  });
  it("T4.3: preenchida em 20/09/2026 — mínimo 23/09 e 5x até 30/09/2026", () => {
    expect(vencimentoMinimoMatricula("2026-09-20")).toBe("2026-09-23");
    expect(limitesPrimeiroVencimento("2026-09-20", 2027, 5)).toEqual({
      minimo: "2026-09-23",
      maximo: "2026-09-30",
      semEscolha: false,
    });
    expect(parcelamentoMatriculaDisponivel(1200, "2026-09-20", 2027).maxParcelas).toBe(5);
  });
  it("T4.4: preenchida em 29/09/2026 — 5x indisponível, máximo 4x", () => {
    expect(limitesPrimeiroVencimento("2026-09-29", 2027, 5)).toBeNull();
    expect(parcelasMatriculaValida(5, "2026-09-29", 2027)).toBe(false);
    expect(parcelasMatriculaValida(4, "2026-09-29", 2027)).toBe(true);
    expect(parcelamentoMatriculaDisponivel(1200, "2026-09-29", 2027).maxParcelas).toBe(4);
  });
  it("T4.5: 30/09/2026 para a matrícula de 28/09 é recusada (mínimo 01/10/2026)", () => {
    expect(validarPrimeiroVencimento("2026-09-30", "2026-09-28", 2027, 1)).toBe(
      "A data não pode ser anterior a 01/10/2026.",
    );
  });
  it("T4.6: 2x com a 1ª em 10/01/2027 é recusada — a 2ª passaria de 31/01", () => {
    const erro = validarPrimeiroVencimento("2027-01-10", "2026-09-28", 2027, 2);
    expect(erro).toContain("31/12/2026");
    expect(erro).toContain("31/01/2027");
  });
  it("T4.7: centavos — 1.200 em 3x = 400 × 3; 1.000 em 3x = 333,34 + 333,33 + 333,33", () => {
    const a = parcelamentoMatricula(1200, 3);
    expect([a.valorPrimeiraParcela, a.valorParcela, a.valorParcela]).toEqual([400, 400, 400]);
    const b = parcelamentoMatricula(1000, 3);
    expect([b.valorPrimeiraParcela, b.valorParcela, b.valorParcela]).toEqual([
      333.34, 333.33, 333.33,
    ]);
    expect(
      cronogramaMatricula(1000, 3, ["2026-10-05", "2026-11-05", "2026-12-07"]).map((i) => i.valor),
    ).toEqual([333.34, 333.33, 333.33]);
  });
  it("T4.11: preenchida em 30/12/2026 para 2027 — mínimo 02/01/2027, só 1x, até 31/01/2027", () => {
    const d = parcelamentoMatriculaDisponivel(1200, "2026-12-30", 2027);
    expect(d.maxParcelas).toBe(1);
    expect(d.somenteAVista).toBe(true);
    expect(d.opcoes).toHaveLength(1);
    expect(d.opcoes[0]).toMatchObject({
      parcelas: 1,
      vencimentoMinimo: "2027-01-02",
      vencimentoMaximo: "2027-01-31",
      semEscolha: false,
    });
  });
  it("ano em curso com preenchimento + 3 dias além do mês: sem escolha, vence em preenchimento + 3", () => {
    expect(limitesPrimeiroVencimento("2026-12-30", 2026, 1)).toEqual({
      minimo: "2027-01-02",
      maximo: "2027-01-02",
      semEscolha: true,
    });
    expect(vencimentoEfetivoPrimeiraParcela("2027-01-02")).toBe("2027-01-04");
  });
  it("quantidade fora de 1 a 5 é inválida", () => {
    expect(parcelasMatriculaValida(0, "2026-09-20", 2027)).toBe(false);
    expect(parcelasMatriculaValida(6, "2026-09-20", 2027)).toBe(false);
  });
});

describe("matrícula no ano letivo em curso (T4.8–T4.10)", () => {
  it("T4.8: 28/09/2026, início 19/10/2026 — R$ 300,00 (3/12), à vista em 01/10/2026", () => {
    const d = parcelamentoMatriculaDisponivel(1200, "2026-09-28", 2026, "2026-10-19");
    expect(d.anoEmCurso).toBe(true);
    expect(d.proporcao).toEqual({ meses: 3, de: 12 });
    expect(d.valor).toBe(300);
    expect(d.opcoes.map((o) => o.parcelas)).toEqual([1]);
    expect(d.opcoes[0]).toMatchObject({
      vencimentoMinimo: "2026-10-01",
      vencimentoMaximo: "2026-10-01",
      semEscolha: true,
      total: 300,
    });
    expect(validarPrimeiroVencimento("2026-10-01", "2026-09-28", 2026, 1)).toBe("");
    expect(vencimentoEfetivoPrimeiraParcela("2026-10-01")).toBe("2026-10-01");
    expect(textoMatriculaAnoEmCurso(d.proporcao)).toBe(
      "Matrícula para o ano letivo em andamento: pagamento à vista, proporcional aos meses restantes (3 de 12).",
    );
  });
  it("T4.9: 10/09/2026, início 15/09/2026 — R$ 400,00 (4/12), janela 13/09–30/09; domingo 13/09 vence 14/09", () => {
    const d = parcelamentoMatriculaDisponivel(1200, "2026-09-10", 2026, "2026-09-15");
    expect(d.proporcao).toEqual({ meses: 4, de: 12 });
    expect(d.valor).toBe(400);
    expect(d.opcoes).toHaveLength(1);
    expect(d.opcoes[0]).toMatchObject({
      vencimentoMinimo: "2026-09-13",
      vencimentoMaximo: "2026-09-30",
      semEscolha: false,
    });
    expect(validarPrimeiroVencimento("2026-09-13", "2026-09-10", 2026, 1)).toBe("");
    expect(vencimentoEfetivoPrimeiraParcela("2026-09-13")).toBe("2026-09-14");
    expect(parcelasMatriculaValida(2, "2026-09-10", 2026)).toBe(false);
  });
  it("T4.10: 15/01/2027, início 03/02/2027 — valor cheio, janela 18/01–31/01/2027", () => {
    const d = parcelamentoMatriculaDisponivel(1200, "2027-01-15", 2027, "2027-02-03");
    expect(d.anoEmCurso).toBe(true);
    expect(d.proporcao).toBeNull();
    expect(d.valor).toBe(1200);
    expect(d.opcoes.map((o) => [o.parcelas, o.vencimentoMinimo, o.vencimentoMaximo])).toEqual([
      [1, "2027-01-18", "2027-01-31"],
    ]);
  });
  it("sem data de início válida usa o mês do preenchimento; arredonda meio centavo para cima", () => {
    expect(proporcaoMatriculaAnoEmCurso(2026, "2026-09-10", "")).toEqual({ meses: 4, de: 12 });
    expect(proporcaoMatriculaAnoEmCurso(2026, "2026-09-10", null)).toEqual({ meses: 4, de: 12 });
    // 1.000,06 × 3/12 = 250,015 → 250,02
    expect(valorMatriculaProporcional(1000.06, { meses: 3, de: 12 })).toBe(250.02);
  });
});

describe("valor da matrícula por segmento e ano", () => {
  const cec = { infantil: 2057.1, fundamental_1: 2057.1, fundamental_2: 2234.25 };
  it("segmento por série: infantil até o 2º Período, fundamental_1 do 1º ao 5º, fundamental_2 do 6º", () => {
    for (const serie of ["Berçário", "Maternal 2", "1º Período", "2º Período"]) {
      expect(segmentoMatricula(serie)).toBe("infantil");
    }
    expect(segmentoMatricula("1º Ano")).toBe("fundamental_1");
    expect(segmentoMatricula("5º Ano")).toBe("fundamental_1");
    for (const serie of ["6º Ano", "7° Ano", "9º Ano"]) {
      expect(segmentoMatricula(serie)).toBe("fundamental_2");
    }
  });
  it("série desconhecida não tem segmento nem valor (não cai no infantil)", () => {
    expect(segmentoMatricula("Ensino Médio")).toBeNull();
    expect(segmentoMatricula("")).toBeNull();
    expect(valorMatricula(cec, "Ensino Médio")).toBeNull();
    expect(matriculaPortal(cec, "Ensino Médio", "2026-09-20", 2027)).toBeNull();
  });
  it("cada segmento devolve o valor cadastrado", () => {
    expect(valorMatricula(cec, "2º Período")).toBe(2057.1);
    expect(valorMatricula(cec, "5º Ano")).toBe(2057.1);
    expect(valorMatricula(cec, "6º Ano")).toBe(2234.25);
  });
  it("mesmo segmento com valores diferentes em dois colégios devolve o valor de cada um", () => {
    const belvedere = { infantil: 1800, fundamental_1: 1900, fundamental_2: 2000 };
    expect(valorMatricula(cec, "3º Ano")).toBe(2057.1);
    expect(valorMatricula(belvedere, "3º Ano")).toBe(1900);
    expect(valorMatricula(cec, "2º Período")).toBe(2057.1);
    expect(valorMatricula(belvedere, "2º Período")).toBe(1800);
  });
  it("segmento excluído no colégio devolve null e o portal não gera parcelas", () => {
    const cecBaby = { infantil: 1500 };
    expect(valorMatricula(cecBaby, "1º Ano")).toBeNull();
    expect(matriculaPortal(cecBaby, "1º Ano", "2026-09-20", 2027)).toBeNull();
    expect(valorMatricula({ fundamental_2: 0 }, "6º Ano")).toBeNull();
    expect(matriculaPortal({ fundamental_2: 0 }, "6º Ano", "2026-09-20", 2027)).toBeNull();
    const ok = matriculaPortal(cecBaby, "2º Período", "2026-09-20", 2027);
    expect(ok?.segmento).toBe("infantil");
    expect(ok?.valor).toBe(1500);
    expect(ok?.disponivel.opcoes.length).toBeGreaterThan(0);
  });
  it("lista os segmentos sem valor do colégio", () => {
    expect(segmentosSemValorMatricula(cec)).toEqual([]);
    expect(segmentosSemValorMatricula({ infantil: 2100 })).toEqual([
      "fundamental_1",
      "fundamental_2",
    ]);
    expect(segmentosSemValorMatricula({})).toEqual(SEGMENTOS_MATRICULA);
  });
  it("pendência para abrir a campanha só quando um colégio não tem nenhum segmento, citando o colégio", () => {
    const todos = [...SEGMENTOS_MATRICULA];
    expect(
      mensagemPendenciasCampanha(2028, {
        colegios: [
          { unidade: "CEC", segmentosSemValorMatricula: [] },
          { unidade: "CEC Baby", segmentosSemValorMatricula: ["fundamental_1", "fundamental_2"] },
        ],
      }),
    ).toBeNull();
    expect(
      mensagemPendenciasCampanha(2028, {
        colegios: [
          { unidade: "CEC", segmentosSemValorMatricula: [] },
          { unidade: "Núcleo Belvedere", segmentosSemValorMatricula: todos },
        ],
      }),
    ).toBe(
      "Não é possível abrir a campanha de 2028: falta cadastrar o valor da Matrícula de 2028 para Núcleo Belvedere (nenhum segmento cadastrado).",
    );
    expect(
      mensagemPendenciasCampanha(2028, {
        colegios: [
          { unidade: "Núcleo Belvedere", segmentosSemValorMatricula: todos },
          { unidade: "Núcleo Vale do Sereno", segmentosSemValorMatricula: todos },
        ],
      }),
    ).toContain("Núcleo Belvedere, Núcleo Vale do Sereno");
  });
  it("rótulo do segmento antigo fica só para histórico", () => {
    expect(ROTULO_SEGMENTO_MATRICULA.infantil_fundamental_1).toBe(
      "Educação Infantil e Ensino Fundamental I (cadastro antigo)",
    );
    expect(ROTULO_SEGMENTO_MATRICULA.infantil).toBe("Ensino Infantil");
    expect(ROTULO_SEGMENTO_MATRICULA.fundamental_1).toBe("Ensino Fundamental 1 / Anos Iniciais");
    expect(ROTULO_SEGMENTO_MATRICULA.fundamental_2).toBe("Ensino Fundamental 2 / Anos Finais");
  });
  it("divide em parcelas com sobra de centavos na 1ª e soma fecha no total", () => {
    const op = parcelamentoMatricula(2057.1, 3);
    expect(op.valorParcela).toBe(685.7);
    expect(op.valorPrimeiraParcela).toBe(685.7);
    const op4 = parcelamentoMatricula(2234.25, 4);
    expect(op4.valorParcela).toBe(558.56);
    expect(op4.valorPrimeiraParcela).toBe(558.57);
    expect(Math.round((op4.valorPrimeiraParcela + op4.valorParcela * 3) * 100)).toBe(223425);
  });
});

describe("parcelas 2+ seguem o vencimento real da mensalidade", () => {
  const mensalidade = (vencimento: string): ParcelaAberta => ({
    contaReceberID: vencimento,
    numeroBoleto: "",
    numeroParcela: "1",
    vencimento,
    categoria: "Mensalidade",
    saldo: 100,
    quitada: false,
  });
  it("usa a data da mensalidade de cada mês, não a data digitada", () => {
    const datas = vencimentosMatriculaPelasMensalidades(
      [mensalidade("2026-10-05"), mensalidade("2026-11-05"), mensalidade("2026-12-07")],
      "2026-09-18",
      4,
    );
    expect(datas).toEqual(["2026-09-18", "2026-10-05", "2026-11-05", "2026-12-07"]);
  });
  it("mês sem mensalidade emitida usa o dia habitual da mensalidade (rolado p/ dia útil), não o dia da 1ª", () => {
    // Caso real: 1ª parcela em 21/09/2026, mensalidades só a partir de fev/2027 no dia 10.
    const mensalidades2027 = [
      "2027-02-10",
      "2027-03-10",
      "2027-04-12",
      "2027-05-10",
      "2027-06-10",
    ].map(mensalidade);
    const datas = vencimentosMatriculaPelasMensalidades(mensalidades2027, "2026-09-21", 5);
    // 10/10/2026 é sábado → 13/10 (12/10 é feriado); 10/01/2027 é domingo → 11/01.
    expect(datas).toEqual(["2026-09-21", "2026-10-13", "2026-11-10", "2026-12-10", "2027-01-11"]);
    const itens = cronogramaMatricula(2234.25, 5, datas);
    expect(itens.map((i) => i.valor)).toEqual([446.85, 446.85, 446.85, 446.85, 446.85]);
    expect(itens.map((i) => i.vencimento)).toEqual(datas);
  });
  it("sem nenhuma mensalidade de referência, cai no mesmo dia da 1ª parcela", () => {
    expect(vencimentosMatriculaPelasMensalidades([], "2026-11-30", 3)).toEqual([
      "2026-11-30",
      "2026-12-30",
      "2027-01-30",
    ]);
  });
  it("cronograma casa valores e datas, sobra na 1ª", () => {
    const c = cronogramaMatricula(2234.25, 2, ["2026-12-10", "2027-01-10"]);
    expect(c).toEqual([
      { numero: 1, valor: 1117.13, vencimento: "2026-12-10" },
      { numero: 2, valor: 1117.12, vencimento: "2027-01-10" },
    ]);
  });
});

describe("frequência parcial só até o Maternal 3", () => {
  it("mostra a pergunta para Berçário e Maternais", () => {
    for (const s of ["Berçário", "Maternal 1", "Maternal 2", "Maternal 3"]) {
      expect(perguntaFrequenciaParcial(s)).toBe(true);
    }
  });
  it("oculta a partir do 1º Período, mesmo sendo Infantil", () => {
    for (const s of ["1º Período", "2º Período", "1º Ano", "9º Ano"]) {
      expect(perguntaFrequenciaParcial(s)).toBe(false);
    }
  });
});

describe("turnos por série a partir das turmas reais do Sponte", () => {
  const turma = (nome: string, horario: string, curso: string): TurmaParaTurno => ({
    nome,
    horario,
    curso,
    situacao: "Aberta",
  });
  const turmas2027: TurmaParaTurno[] = [
    turma("01 - Berçário 1", "Infantil - T", "01 - Berçário"),
    turma("02 - Maternal 1 T", "Infantil - T", "02 - Maternal 1"),
    turma("05 - 1º Período T", "Infantil - T", "05 - 1° Período"),
    turma("07 - 1º Ano M", "Fundamental 1/2 M", "07 - 1° Ano"),
    turma("07 - 1º Ano T", "Fundamental 1/2 T", "07 - 1° Ano"),
    turma("11 - 5º Ano", "Fundamental 1/2 M", "11 - 5° Ano"),
    turma("15 - 9º Ano", "Fundamental 1/2 M", "15 - 9° Ano"),
  ];
  it("só tarde: Berçário (pelo Horario), Maternais e Períodos", () => {
    expect(turnosDisponiveisParaSerie(turmas2027, "Berçário")).toEqual({
      manha: false,
      tarde: true,
    });
    expect(turnosDisponiveisParaSerie(turmas2027, "Maternal 1")).toEqual({
      manha: false,
      tarde: true,
    });
    expect(turnosDisponiveisParaSerie(turmas2027, "1º Período")).toEqual({
      manha: false,
      tarde: true,
    });
  });
  it("manhã e tarde: 1º Ano", () => {
    expect(turnosDisponiveisParaSerie(turmas2027, "1º Ano")).toEqual({ manha: true, tarde: true });
  });
  it("só manhã: 5º ao 9º Ano", () => {
    expect(turnosDisponiveisParaSerie(turmas2027, "5º Ano")).toEqual({ manha: true, tarde: false });
    expect(turnosDisponiveisParaSerie(turmas2027, "9° Ano")).toEqual({ manha: true, tarde: false });
  });
  it("sem turma da série (ou fechada) libera os dois turnos", () => {
    expect(turnosDisponiveisParaSerie(turmas2027, "3º Ano")).toEqual({ manha: true, tarde: true });
    const fechada = [
      { ...turma("11 - 5º Ano", "Fundamental 1/2 M", "11 - 5° Ano"), situacao: "Fechada" },
    ];
    expect(turnosDisponiveisParaSerie(fechada, "5º Ano")).toEqual({ manha: true, tarde: true });
  });
  it("a restrição vale só para CEC e CEC Baby", () => {
    expect(unidadeRestringeTurno("CEC")).toBe(true);
    expect(unidadeRestringeTurno("CEC Baby")).toBe(true);
    expect(unidadeRestringeTurno("Belvedere")).toBe(false);
    expect(unidadeRestringeTurno("Vale do Sereno")).toBe(false);
  });
});

describe("mensalidade vigente com desconto", () => {
  it("Valor × (1 − desconto): 2.134,25 com 80% → 426,85", () => {
    expect(valorMensalidadeComDesconto(2134.25, 80)).toBe(426.85);
  });
  it("sem desconto devolve o valor cheio; 100% zera", () => {
    expect(valorMensalidadeComDesconto(2134.25, 0)).toBe(2134.25);
    expect(valorMensalidadeComDesconto(2134.25, 100)).toBe(0);
  });
});

describe("datas em dd/mm/aaaa", () => {
  it("converte ISO e preserva texto que não é data", () => {
    expect(formatarDataBR("2026-09-05")).toBe("05/09/2026");
    expect(formatarDataBR("2026-09-05T10:00:00Z")).toBe("05/09/2026");
    expect(formatarDataBR("")).toBe("");
    expect(formatarDataBR("—")).toBe("—");
  });
});
