import { describe, it, expect } from "vitest";
import {
  cobertoPeloAcordo,
  filtrarPorAcordo,
  filtrarPorAcordoDoAluno,
  isMesReferencia,
  mapaExcecoes,
  mesDoVencimento,
  parcelaIsentaPorAcordo,
  rotuloMesReferencia,
} from "./billing-exceptions";
import { parcelasCobraveis, type ParcelaCobranca } from "./billing-recurrence";
import { calcularTotalVencido } from "./billing-debt";

// Aluno 100 tem acordo até julho/2026; aluno 200 não tem exceção.
const EXCECOES = mapaExcecoes([{ alunoId: "100", mesReferencia: "2026-07" }]);

function parcela(alunoId: string, vencimento: string, saldo = 1000): ParcelaCobranca {
  return {
    alunoId,
    alunoNome: `Aluno ${alunoId}`,
    unidade: "CEC",
    telefone: "31999990000",
    responsavelNome: "Responsável",
    vencimento,
    saldo,
  };
}

describe("mês de referência", () => {
  it("aceita YYYY-MM válido e rejeita formatos ou meses inválidos", () => {
    expect(isMesReferencia("2026-07")).toBe(true);
    expect(isMesReferencia("2026-12")).toBe(true);
    expect(isMesReferencia("2026-13")).toBe(false);
    expect(isMesReferencia("2026-00")).toBe(false);
    expect(isMesReferencia("07/2026")).toBe(false);
    expect(isMesReferencia("")).toBe(false);
  });

  it("extrai o mês do vencimento e ignora data inválida", () => {
    expect(mesDoVencimento("2026-07-31")).toBe("2026-07");
    expect(mesDoVencimento("2026-08-01")).toBe("2026-08");
    expect(mesDoVencimento("")).toBe("");
    expect(mesDoVencimento("31/07/2026")).toBe("");
  });

  it("descreve o mês por extenso para a tela", () => {
    expect(rotuloMesReferencia("2026-07")).toBe("julho de 2026");
    expect(rotuloMesReferencia("2026-01")).toBe("janeiro de 2026");
  });
});

describe("mapa de exceções", () => {
  it("indexa por AlunoID e descarta entradas inválidas", () => {
    const mapa = mapaExcecoes([
      { alunoId: "100", mesReferencia: "2026-07" },
      { alunoId: "", mesReferencia: "2026-07" },
      { alunoId: "300", mesReferencia: "julho" },
    ]);
    expect([...mapa.entries()]).toEqual([["100", "2026-07"]]);
  });

  it("com duas exceções do mesmo aluno mantém o acordo mais recente", () => {
    const mapa = mapaExcecoes([
      { alunoId: "100", mesReferencia: "2026-05" },
      { alunoId: "100", mesReferencia: "2026-09" },
    ]);
    expect(mapa.get("100")).toBe("2026-09");
  });
});

describe("cobertura do acordo", () => {
  it("cobre todo o mês de referência, inclusive o último dia", () => {
    expect(cobertoPeloAcordo("2026-07-01", "2026-07")).toBe(true);
    expect(cobertoPeloAcordo("2026-07-31", "2026-07")).toBe(true);
  });

  it("cobre meses anteriores e nunca os posteriores", () => {
    expect(cobertoPeloAcordo("2026-01-10", "2026-07")).toBe(true);
    expect(cobertoPeloAcordo("2025-12-05", "2026-07")).toBe(true);
    expect(cobertoPeloAcordo("2026-08-01", "2026-07")).toBe(false);
    expect(cobertoPeloAcordo("2027-01-05", "2026-07")).toBe(false);
  });

  it("aluno sem exceção nunca tem parcela isenta", () => {
    expect(parcelaIsentaPorAcordo(parcela("200", "2026-01-10"), EXCECOES)).toBe(false);
    expect(parcelaIsentaPorAcordo(parcela("100", "2026-01-10"), EXCECOES)).toBe(true);
  });
});

describe("filtragem das parcelas elegíveis", () => {
  it("remove só as parcelas do aluno com acordo até o mês de referência", () => {
    const parcelas = [
      parcela("100", "2026-06-10"),
      parcela("100", "2026-07-10"),
      parcela("100", "2026-08-10"),
      parcela("200", "2026-06-10"),
    ];
    expect(filtrarPorAcordo(parcelas, EXCECOES).map((p) => [p.alunoId, p.vencimento])).toEqual([
      ["100", "2026-08-10"],
      ["200", "2026-06-10"],
    ]);
  });

  it("sem exceção cadastrada devolve a lista intacta", () => {
    const parcelas = [parcela("100", "2026-06-10"), parcela("200", "2026-07-10")];
    expect(filtrarPorAcordo(parcelas, mapaExcecoes([]))).toEqual(parcelas);
  });

  it("após remover a exceção o aluno volta a ser cobrável, inclusive nas antigas", () => {
    const parcelas = [parcela("100", "2026-06-10"), parcela("100", "2026-08-10")];
    expect(filtrarPorAcordo(parcelas, EXCECOES)).toHaveLength(1);
    // Exceção removida = aluno fora do mapa; nada mais precisa ser desfeito.
    expect(filtrarPorAcordo(parcelas, mapaExcecoes([]))).toHaveLength(2);
  });

  it("acordo mais antigo que a dívida não isenta nada", () => {
    const parcelas = [parcela("100", "2026-08-10"), parcela("100", "2026-09-10")];
    const antigo = mapaExcecoes([{ alunoId: "100", mesReferencia: "2026-05" }]);
    expect(filtrarPorAcordo(parcelas, antigo)).toHaveLength(2);
  });

  it("combina com a tolerância de dias úteis sem burlar a régua", () => {
    // 2026-08-12 é uma quarta-feira; a parcela de 11/08 ainda está em tolerância.
    const hoje = "2026-08-12";
    const parcelas = [
      parcela("100", "2026-07-05"), // coberta pelo acordo
      parcela("100", "2026-08-05"), // fora do acordo e fora da tolerância → cobra
      parcela("100", "2026-08-11"), // fora do acordo, ainda em tolerância → não cobra
    ];
    const elegiveis = parcelasCobraveis(filtrarPorAcordo(parcelas, EXCECOES), hoje, "2026-08-01");
    expect(elegiveis.map((p) => p.vencimento)).toEqual(["2026-08-05"]);
  });
});

describe("total da dívida cobrada", () => {
  it("desconta do total as parcelas cobertas pelo acordo", () => {
    const hoje = "2026-08-12";
    const doAluno = [
      { vencimento: "2026-06-10", saldo: 1000 },
      { vencimento: "2026-07-10", saldo: 1000 },
      { vencimento: "2026-08-05", saldo: 1000 },
    ];
    const semAcordo = filtrarPorAcordoDoAluno("100", doAluno, EXCECOES);
    expect(semAcordo.map((p) => p.vencimento)).toEqual(["2026-08-05"]);
    // Só a parcela de agosto entra no valor anunciado na mensagem.
    expect(calcularTotalVencido(semAcordo, hoje)).toBeCloseTo(
      calcularTotalVencido([{ vencimento: "2026-08-05", saldo: 1000 }], hoje),
      2,
    );
    expect(calcularTotalVencido(semAcordo, hoje)).toBeLessThan(calcularTotalVencido(doAluno, hoje));
  });

  it("aluno sem exceção mantém o total cheio", () => {
    const hoje = "2026-08-12";
    const doAluno = [
      { vencimento: "2026-06-10", saldo: 1000 },
      { vencimento: "2026-08-05", saldo: 1000 },
    ];
    expect(filtrarPorAcordoDoAluno("200", doAluno, EXCECOES)).toEqual(doAluno);
    expect(calcularTotalVencido(filtrarPorAcordoDoAluno("200", doAluno, EXCECOES), hoje)).toBe(
      calcularTotalVencido(doAluno, hoje),
    );
  });
});
