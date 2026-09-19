import { describe, expect, it } from "vitest";
import {
  MULTA_TETO,
  calcularDevolucao,
  calcularMulta,
  dataPrevistaSugerida,
  diasUteisAtraso,
  formatarCodigoExemplar,
  normalizarCodigoExemplar,
  pendenciasDoAluno,
  resumirPendencias,
  saldoMultasAberto,
  validarNovoEmprestimo,
  type EmprestimoBase,
} from "./biblioteca";

function emp(p: Partial<EmprestimoBase> & { id: string }): EmprestimoBase {
  return {
    aluno_id: "100",
    data_emprestimo: "2026-09-25",
    data_prevista: "2026-10-02",
    data_devolucao: null,
    perdido: false,
    dias_atraso: 0,
    multa_valor: 0,
    multa_paga_em: null,
    ...p,
  };
}

// Calendário de referência (2026): 02/10 sexta, 03–04/10 fim de semana,
// 05/10 segunda; 02/11 (Finados) segunda; 08/12 (Imaculada, BH) terça.
describe("diasUteisAtraso / multa", () => {
  it("devolução em dia (ou antes) não gera atraso nem multa", () => {
    expect(diasUteisAtraso("2026-10-02", "2026-10-02")).toBe(0);
    expect(diasUteisAtraso("2026-10-02", "2026-09-30")).toBe(0);
    expect(calcularDevolucao("2026-10-02", "2026-10-02")).toEqual({ diasAtraso: 0, multa: 0 });
  });

  it("atraso que atravessa o fim de semana não conta sábado e domingo", () => {
    // Prevista sexta 02/10, devolvida terça 06/10 → segunda 05 e terça 06 = 2 dias úteis.
    expect(diasUteisAtraso("2026-10-02", "2026-10-06")).toBe(2);
    expect(calcularDevolucao("2026-10-02", "2026-10-06")).toEqual({ diasAtraso: 2, multa: 4 });
    // Devolvida na segunda 05/10: só 1 dia útil (não 3 corridos).
    expect(calcularDevolucao("2026-10-02", "2026-10-05")).toEqual({ diasAtraso: 1, multa: 2 });
  });

  it("atraso que atravessa feriado nacional (Finados) e municipal de BH (08/12) pula esses dias", () => {
    // Prevista sexta 30/10, devolvida terça 03/11: 02/11 é Finados → só terça = 1 dia útil.
    expect(diasUteisAtraso("2026-10-30", "2026-11-03")).toBe(1);
    // Prevista sexta 04/12, devolvida quarta 09/12: 05–06 fim de semana, 08/12 Imaculada (BH) → 07 e 09 = 2.
    expect(diasUteisAtraso("2026-12-04", "2026-12-09")).toBe(2);
  });

  it("multa é R$2,00 por dia útil e nunca passa de R$30,00", () => {
    expect(calcularMulta(1)).toBe(2);
    expect(calcularMulta(15)).toBe(30);
    expect(calcularMulta(16)).toBe(30);
    expect(calcularMulta(400)).toBe(MULTA_TETO);
    // Atraso de quase um ano: teto.
    expect(calcularDevolucao("2026-03-02", "2027-02-26").multa).toBe(30);
  });

  it("data prevista sugerida cai sempre em dia útil", () => {
    // Sexta 25/09 + 7 = sexta 02/10 (útil).
    expect(dataPrevistaSugerida("2026-09-25")).toBe("2026-10-02");
    // Sábado 26/09 + 7 = sábado 03/10 → segunda 05/10.
    expect(dataPrevistaSugerida("2026-09-26")).toBe("2026-10-05");
  });
});

describe("bloqueio de novo empréstimo", () => {
  const hoje = "2026-10-10";

  it("aluno com multa em aberto é bloqueado", () => {
    const lista = [emp({ id: "a", data_devolucao: "2026-10-06", dias_atraso: 2, multa_valor: 4 })];
    const p = pendenciasDoAluno(lista, hoje);
    expect(p.podeEmprestar).toBe(false);
    expect(p.motivos).toEqual(["multa_aberta"]);
    expect(p.saldoMultas).toBe(4);
    expect(validarNovoEmprestimo("disponivel", lista, hoje)).toEqual({
      ok: false,
      erro: "Multa em aberto.",
    });
  });

  it("multa paga deixa de bloquear", () => {
    const lista = [
      emp({
        id: "a",
        data_devolucao: "2026-10-06",
        dias_atraso: 2,
        multa_valor: 4,
        multa_paga_em: "2026-10-06T14:00:00Z",
      }),
    ];
    expect(saldoMultasAberto(lista)).toBe(0);
    expect(pendenciasDoAluno(lista, hoje).podeEmprestar).toBe(true);
  });

  it("aluno com empréstimo em atraso é bloqueado", () => {
    const lista = [emp({ id: "a", data_prevista: "2026-10-02" })];
    const p = pendenciasDoAluno(lista, hoje);
    expect(p.podeEmprestar).toBe(false);
    expect(p.motivos).toEqual(["emprestimo_atrasado"]);
  });

  it("aluno com empréstimo aberto (ainda no prazo) também não pega um segundo", () => {
    const lista = [emp({ id: "a", data_prevista: "2026-10-20" })];
    const p = pendenciasDoAluno(lista, hoje);
    expect(p.podeEmprestar).toBe(false);
    expect(p.motivos).toEqual(["emprestimo_aberto"]);
  });

  it("sem pendência pode emprestar; exemplar não disponível nunca sai", () => {
    const lista = [emp({ id: "a", data_devolucao: "2026-10-01" })];
    expect(pendenciasDoAluno(lista, hoje).podeEmprestar).toBe(true);
    expect(validarNovoEmprestimo("disponivel", lista, hoje)).toEqual({ ok: true });
    expect(validarNovoEmprestimo("perdido", lista, hoje).ok).toBe(false);
    expect(validarNovoEmprestimo("emprestado", lista, hoje).ok).toBe(false);
    expect(validarNovoEmprestimo("manutencao", lista, hoje).ok).toBe(false);
  });

  it("multa E atraso acumulam os dois motivos", () => {
    const lista = [
      emp({ id: "a", data_devolucao: "2026-09-30", multa_valor: 6, data_prevista: "2026-09-26" }),
      emp({ id: "b", data_prevista: "2026-10-05" }),
    ];
    expect(pendenciasDoAluno(lista, hoje).motivos).toEqual(["multa_aberta", "emprestimo_atrasado"]);
  });
});

describe("resumirPendencias", () => {
  it("agrega por aluno só quem tem multa ou atraso, em ordem alfabética", () => {
    const hoje = "2026-10-10";
    const lista = [
      {
        ...emp({ id: "1", aluno_id: "7", data_devolucao: "2026-10-06", multa_valor: 4 }),
        aluno_nome: "Zeca",
      },
      {
        ...emp({ id: "2", aluno_id: "7", data_devolucao: "2026-09-01", multa_valor: 2 }),
        aluno_nome: "Zeca",
      },
      { ...emp({ id: "3", aluno_id: "8", data_prevista: "2026-10-01" }), aluno_nome: "Ana" },
      { ...emp({ id: "4", aluno_id: "9", data_prevista: "2026-10-30" }), aluno_nome: "Bia" },
    ];
    expect(resumirPendencias(lista, hoje)).toEqual([
      {
        aluno_id: "8",
        aluno_nome: "Ana",
        saldoMultas: 0,
        emprestimosAtrasados: 1,
        emprestimosAbertos: 1,
      },
      {
        aluno_id: "7",
        aluno_nome: "Zeca",
        saldoMultas: 6,
        emprestimosAtrasados: 0,
        emprestimosAbertos: 0,
      },
    ]);
  });
});

describe("código do exemplar", () => {
  it("normaliza leitura (só 12 dígitos) e formata em grupos de 4", () => {
    expect(normalizarCodigoExemplar("000000000042")).toBe("000000000042");
    expect(normalizarCodigoExemplar(" 0000 0000 0042 ")).toBe("000000000042");
    expect(normalizarCodigoExemplar("42")).toBe("");
    expect(formatarCodigoExemplar("000000000042")).toBe("0000 0000 0042");
  });
});
