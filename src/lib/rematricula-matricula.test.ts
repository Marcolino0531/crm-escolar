import { describe, expect, it } from "vitest";
import type { ParcelaAberta } from "./cantina";
import {
  cronogramaMatricula,
  formatarDataBR,
  limitesPrimeiroVencimento,
  maxParcelasMatricula,
  mesReferenciaMatricula,
  parcelamentoMatricula,
  parcelamentoMatriculaDisponivel,
  parcelasMatriculaValida,
  perguntaFrequenciaParcial,
  segmentoMatricula,
  turnosDisponiveisParaSerie,
  unidadeRestringeTurno,
  validarPrimeiroVencimento,
  valorMatricula,
  valorMensalidadeComDesconto,
  vencimentosMatriculaPelasMensalidades,
  type TurmaParaTurno,
} from "./rematricula-matricula";
import { itensMaterialInclusos } from "./rematricula";

describe("mês de referência da matrícula", () => {
  it("até o dia 25 usa o mês do preenchimento", () => {
    expect(mesReferenciaMatricula("2026-09-25")).toBe("2026-09");
    expect(mesReferenciaMatricula("2026-09-01")).toBe("2026-09");
  });
  it("do dia 26 em diante passa para o mês seguinte (inclusive virada de ano)", () => {
    expect(mesReferenciaMatricula("2026-09-26")).toBe("2026-10");
    expect(mesReferenciaMatricula("2026-12-26")).toBe("2027-01");
    expect(mesReferenciaMatricula("2027-01-26")).toBe("2027-02");
  });
});

describe("quantidade de parcelas disponíveis (set–jan, máx 5x)", () => {
  it("até 25/09: 5x (set, out, nov, dez, jan)", () => {
    expect(maxParcelasMatricula("2026-09-25")).toBe(5);
    expect(
      parcelamentoMatriculaDisponivel(2057.1, "2026-09-10").opcoes.map((o) => o.parcelas),
    ).toEqual([1, 2, 3, 4, 5]);
  });
  it("26/09: 4x (out–jan)", () => {
    expect(maxParcelasMatricula("2026-09-26")).toBe(4);
  });
  it("26/10: 3x (nov–jan)", () => {
    expect(maxParcelasMatricula("2026-10-26")).toBe(3);
  });
  it("dezembro: 2x; 26/12 vira janeiro e fica só à vista", () => {
    expect(maxParcelasMatricula("2026-12-10")).toBe(2);
    expect(parcelamentoMatriculaDisponivel(2057.1, "2026-12-26").somenteAVista).toBe(true);
  });
  it("janeiro: só à vista, sem seleção de parcelas", () => {
    const jan = parcelamentoMatriculaDisponivel(2057.1, "2027-01-20");
    expect(jan.somenteAVista).toBe(true);
    expect(jan.maxParcelas).toBe(1);
    expect(jan.opcoes).toHaveLength(1);
    expect(jan.mesReferencia).toBe("2027-01");
  });
  it("26/01 (referência fevereiro, fora da janela): só à vista", () => {
    const fev = parcelamentoMatriculaDisponivel(2057.1, "2027-01-26");
    expect(fev.mesReferencia).toBe("2027-02");
    expect(fev.somenteAVista).toBe(true);
    expect(fev.maxParcelas).toBe(1);
  });
  it("valida a quantidade escolhida contra a data de preenchimento", () => {
    expect(parcelasMatriculaValida(5, "2026-09-25")).toBe(true);
    expect(parcelasMatriculaValida(5, "2026-09-26")).toBe(false);
    expect(parcelasMatriculaValida(2, "2027-01-20")).toBe(false);
    expect(parcelasMatriculaValida(1, "2027-01-26")).toBe(true);
  });
});

describe("valor da matrícula por segmento", () => {
  it("Educação Infantil e Fundamental I: R$ 2.057,10", () => {
    for (const serie of ["Berçário", "Maternal 2", "1º Período", "1º Ano", "5º Ano"]) {
      expect(segmentoMatricula(serie)).toBe("infantil_fundamental_1");
      expect(valorMatricula(serie)).toBe(2057.1);
    }
  });
  it("Fundamental II: R$ 2.234,25", () => {
    for (const serie of ["6º Ano", "7° Ano", "9º Ano"]) {
      expect(segmentoMatricula(serie)).toBe("fundamental_2");
      expect(valorMatricula(serie)).toBe(2234.25);
    }
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

describe("vencimento da 1ª parcela", () => {
  it("fica entre a data de preenchimento e o último dia do mês", () => {
    expect(limitesPrimeiroVencimento("2026-09-10")).toEqual({
      minimo: "2026-09-10",
      maximo: "2026-09-30",
    });
    expect(validarPrimeiroVencimento("2026-09-10", "2026-09-10")).toBe("");
    expect(validarPrimeiroVencimento("2026-09-30", "2026-09-10")).toBe("");
    expect(validarPrimeiroVencimento("2026-09-09", "2026-09-10")).toContain("10/09/2026");
    expect(validarPrimeiroVencimento("2026-10-01", "2026-09-10")).toContain("30/09/2026");
    expect(validarPrimeiroVencimento("", "2026-09-10")).not.toBe("");
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
  it("sem mensalidade no mês, cai no mesmo dia da 1ª parcela", () => {
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

describe("material pedagógico sem Material Coletivo", () => {
  it("nenhuma faixa lista Material Coletivo", () => {
    for (const s of ["1º Período", "3º Ano", "8º Ano"]) {
      const itens = itensMaterialInclusos("CEC", s);
      expect(itens.length).toBeGreaterThan(0);
      expect(itens).not.toContain("Material Coletivo");
    }
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
