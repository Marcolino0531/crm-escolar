import { describe, expect, it } from "vitest";

import {
  expiracaoPausa,
  filtrarPorPausa,
  pausasVigentes,
  rotuloRestante,
  type PausaComprovante,
} from "./billing-pauses";
import {
  agruparPorResponsavel,
  parcelasCobraveis,
  type ParcelaCobranca,
} from "./billing-recurrence";
import { agruparLembretesPorResponsavel, type ParcelaLembrete } from "./billing-reminders";

const DATA_BASE = "2026-01-01";
const CLIQUE = new Date("2026-08-18T14:00:00.000Z");

function parcela(over: Partial<ParcelaCobranca> = {}): ParcelaCobranca {
  return {
    alunoId: "486",
    alunoNome: "Heitor Cordeiro Borges",
    unidade: "CEC",
    telefone: "(31) 99303-4128",
    responsavelNome: "Taciana Melo Cordeiro",
    vencimento: "2026-08-10",
    saldo: 180,
    linhaDigitavel: "03399.86012 12345.678901 23456.789012 3 98760000018000",
    ...over,
  };
}

function pausa(over: Partial<PausaComprovante> = {}): PausaComprovante {
  return {
    telefone: "5531993034128",
    alunoId: null,
    expiraEm: expiracaoPausa(CLIQUE),
    ...over,
  };
}

describe("janela de 24h da pausa por comprovante", () => {
  it("suspende a cobrança do responsável durante as 24h", () => {
    const cobraveis = parcelasCobraveis([parcela()], "2026-08-13", DATA_BASE);
    expect(cobraveis).toHaveLength(1);

    const doisMinutosDepois = new Date(CLIQUE.getTime() + 2 * 60_000);
    const vinteTresHorasDepois = new Date(CLIQUE.getTime() + 23 * 3600_000);
    const pausas = [pausa()];

    expect(filtrarPorPausa(cobraveis, pausas, doisMinutosDepois)).toHaveLength(0);
    expect(filtrarPorPausa(cobraveis, pausas, vinteTresHorasDepois)).toHaveLength(0);
    expect(
      agruparPorResponsavel(
        filtrarPorPausa(cobraveis, pausas, doisMinutosDepois),
        "2026-08-13",
        new Map(),
      ),
    ).toHaveLength(0);
  });

  it("suspende também o lembrete de vencimento do mesmo responsável", () => {
    const lembretes: ParcelaLembrete[] = [parcela({ vencimento: "2026-08-23", saldo: 1936.7 })];
    const durante = new Date(CLIQUE.getTime() + 3600_000);

    const restantes = filtrarPorPausa(lembretes, [pausa()], durante);
    expect(restantes).toHaveLength(0);
    expect(agruparLembretesPorResponsavel(restantes, "2026-08-18")).toHaveLength(0);
  });

  it("pausa só o aluno do comprovante e mantém a cobrança do irmão", () => {
    const parcelas = [
      parcela(),
      parcela({ alunoId: "487", alunoNome: "Vicente Cordeiro Borges", saldo: 100 }),
    ];
    const durante = new Date(CLIQUE.getTime() + 3600_000);

    const restantes = filtrarPorPausa(parcelas, [pausa({ alunoId: "486" })], durante);
    expect(restantes.map((p) => p.alunoId)).toEqual(["487"]);
  });

  it("não afeta outro responsável", () => {
    const outro = parcela({ telefone: "(31) 98823-0304", alunoId: "543" });
    const durante = new Date(CLIQUE.getTime() + 3600_000);
    expect(filtrarPorPausa([outro], [pausa()], durante)).toHaveLength(1);
  });
});

describe("retomada depois das 24h", () => {
  it("volta a cobrar quando a parcela continua em aberto", () => {
    const depois = new Date(CLIQUE.getTime() + 24 * 3600_000 + 60_000);
    const pausas = [pausa()];

    expect(pausasVigentes(pausas, depois)).toHaveLength(0);

    const cobraveis = parcelasCobraveis([parcela()], "2026-08-19", DATA_BASE);
    const restantes = filtrarPorPausa(cobraveis, pausas, depois);
    expect(restantes).toHaveLength(1);
    expect(agruparPorResponsavel(restantes, "2026-08-19", new Map())).toHaveLength(1);
  });

  it("não retoma quando a baixa já foi processada no Sponte", () => {
    const depois = new Date(CLIQUE.getTime() + 24 * 3600_000 + 60_000);
    const quitada = parcela({ dataPagamento: "2026-08-18" });

    const cobraveis = parcelasCobraveis([quitada], "2026-08-19", DATA_BASE);
    expect(cobraveis).toHaveLength(0);
    expect(filtrarPorPausa(cobraveis, [pausa()], depois)).toHaveLength(0);
  });

  it("não retoma quando a parcela teve o saldo zerado", () => {
    const depois = new Date(CLIQUE.getTime() + 25 * 3600_000);
    const cobraveis = parcelasCobraveis([parcela({ saldo: 0 })], "2026-08-19", DATA_BASE);
    expect(filtrarPorPausa(cobraveis, [pausa()], depois)).toHaveLength(0);
  });
});

describe("visibilidade e cancelamento", () => {
  it("lista só as pausas vigentes, com o tempo restante", () => {
    const vigente = pausa();
    const expirada = pausa({
      telefone: "5531988230304",
      expiraEm: new Date(CLIQUE.getTime() - 3600_000).toISOString(),
    });
    const durante = new Date(CLIQUE.getTime() + 4 * 3600_000 + 40 * 60_000);

    expect(pausasVigentes([vigente, expirada], durante)).toEqual([vigente]);
    expect(rotuloRestante(vigente, durante)).toBe("19h20 restantes");
    expect(rotuloRestante(expirada, durante)).toBe("expirada");
  });

  it("cancelar a pausa devolve a parcela à cobrança imediatamente", () => {
    const durante = new Date(CLIQUE.getTime() + 3600_000);
    const cobraveis = parcelasCobraveis([parcela()], "2026-08-13", DATA_BASE);

    expect(filtrarPorPausa(cobraveis, [pausa()], durante)).toHaveLength(0);
    // Cancelar = remover a linha da tabela; nada mais precisa acontecer.
    expect(filtrarPorPausa(cobraveis, [], durante)).toHaveLength(1);
  });
});
