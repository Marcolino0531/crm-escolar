import { describe, expect, it } from "vitest";

import {
  pausasDaUnidade,
  totaisPorUnidade,
  type LogExecucao,
} from "@/lib/billing-execucoes-unidade";

describe("pausasDaUnidade", () => {
  const pausas = [
    { id: "1", responsavel_nome: "Zélia Souza", unidade: "CEC", created_at: "2026-09-10" },
    { id: "2", responsavel_nome: "ana lima", unidade: "CEC Baby", created_at: "2026-09-11" },
    { id: "3", responsavel_nome: "Bruno Alves", unidade: "CEC", created_at: "2026-09-12" },
    { id: "4", responsavel_nome: "Álvaro Reis", unidade: "cec", created_at: "2026-09-13" },
  ];

  it("filtra pela unidade do topo e ordena por responsável (asc, sem caixa/acento)", () => {
    expect(pausasDaUnidade(pausas, "CEC").map((p) => p.id)).toEqual(["4", "3", "1"]);
  });

  it("em Todas as Unidades mostra tudo, em ordem alfabética", () => {
    expect(pausasDaUnidade(pausas, null).map((p) => p.responsavel_nome)).toEqual([
      "Álvaro Reis",
      "ana lima",
      "Bruno Alves",
      "Zélia Souza",
    ]);
  });

  it("não altera a lista original", () => {
    const copia = [...pausas];
    pausasDaUnidade(pausas, null);
    expect(pausas).toEqual(copia);
  });
});

describe("totaisPorUnidade", () => {
  // 10h BRT = 13:00Z; 16h BRT = 19:00Z.
  const run10 = {
    data_ref: "2026-09-15",
    iniciado_em: "2026-09-15T13:00:00Z",
    finalizado_em: "2026-09-15T13:00:28Z",
    pulados: 0,
  };
  const run16 = {
    data_ref: "2026-09-15",
    iniciado_em: "2026-09-15T19:00:00Z",
    finalizado_em: "2026-09-15T19:00:09Z",
    pulados: 16,
  };
  const log = (
    data_envio: string,
    unidade: string,
    telefone: string,
    status = "enviado",
  ): LogExecucao => ({ data_envio, unidade, telefone, status });

  const logs: LogExecucao[] = [
    log("2026-09-15T13:00:02Z", "CEC", "5531911111111"),
    log("2026-09-15T13:00:05Z", "CEC", "5531922222222", "lido"),
    log("2026-09-15T13:00:08Z", "CEC", "5531933333333", "falha"),
    log("2026-09-15T13:00:11Z", "CEC Baby", "5531944444444"),
    log("2026-09-15T13:00:14Z", "Núcleo Belvedere", "5531955555555", "erro"),
    log("2026-09-15T13:00:20Z", "Núcleo Belvedere", "5531966666666"),
    // Log de OUTRO dia, fora de qualquer janela.
    log("2026-09-14T13:00:03Z", "CEC", "5531977777777"),
  ];

  it("contagem da unidade bate com a soma manual dos logs daquela unidade/janela", () => {
    expect(totaisPorUnidade(run10, logs, "CEC")).toEqual({ enviados: 2, falhas: 1, pulados: 0 });
    expect(totaisPorUnidade(run10, logs, "CEC Baby")).toEqual({
      enviados: 1,
      falhas: 0,
      pulados: 0,
    });
    expect(totaisPorUnidade(run10, logs, "Núcleo Belvedere")).toEqual({
      enviados: 1,
      falhas: 1,
      pulados: 0,
    });
    // Soma das unidades = total agregado da execução.
    const soma = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"]
      .map((u) => totaisPorUnidade(run10, logs, u))
      .reduce((s, t) => s + t.enviados + t.falhas, 0);
    expect(soma).toBe(6);
  });

  it("a tentativa das 16h não conta os logs das 10h (janelas não se sobrepõem)", () => {
    const t = totaisPorUnidade(run16, logs, "CEC");
    expect(t.enviados).toBe(0);
    expect(t.falhas).toBe(0);
  });

  it("pulados da unidade = telefones lembrados com sucesso antes, no mesmo dia", () => {
    // CEC: 2 sucessos às 10h (a falha não conta como 'já lembrado').
    expect(totaisPorUnidade(run16, logs, "CEC").pulados).toBe(2);
    // Sem pulados na execução, não inventa.
    expect(totaisPorUnidade({ ...run16, pulados: 0 }, logs, "CEC").pulados).toBe(0);
  });

  it("execução ainda em andamento (sem finalizado_em) conta até agora", () => {
    const aberta = { ...run10, finalizado_em: null };
    expect(totaisPorUnidade(aberta, logs, "CEC Baby").enviados).toBe(1);
  });

  it("compara unidade sem distinguir caixa", () => {
    expect(totaisPorUnidade(run10, logs, "cec baby").enviados).toBe(1);
  });
});
