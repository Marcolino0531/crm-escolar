import { describe, it, expect } from "vitest";
import {
  alertaExecucaoCron,
  execucaoConcluida,
  resumoDoDia,
  slotDaRota,
  type ExecucaoCron,
} from "./billing-cron-runs";

const HOJE = "2026-08-11";

function exec(over: Partial<ExecucaoCron> = {}): ExecucaoCron {
  return {
    data_ref: HOJE,
    slot: "09h",
    status: "ok",
    enviados: 1,
    falhas: 0,
    ...over,
  };
}

describe("slotDaRota", () => {
  it("mapeia cada tentativa do dia para o seu slot", () => {
    expect(slotDaRota("/api/whatsapp/cron")).toBe("09h");
    expect(slotDaRota("/api/whatsapp/cron/tentativa-2")).toBe("12h");
    expect(slotDaRota("/api/whatsapp/cron/tentativa-3")).toBe("15h");
    expect(slotDaRota("/api/whatsapp/cron/tentativa-4")).toBe("18h");
  });

  it("ignora rotas que não são do cron", () => {
    expect(slotDaRota("/api/whatsapp/webhook")).toBeNull();
    expect(slotDaRota("/api/whatsapp/cron/tentativa-9")).toBeNull();
  });
});

describe("execucaoConcluida", () => {
  it("considera concluída a execução que avaliou a régua até o fim", () => {
    for (const status of ["ok", "sem_envio", "nao_util", "pausado"] as const) {
      expect(execucaoConcluida(exec({ status }))).toBe(true);
    }
  });

  it("não considera concluída a execução em andamento ou com erro", () => {
    expect(execucaoConcluida(exec({ status: "em_andamento" }))).toBe(false);
    expect(execucaoConcluida(exec({ status: "erro" }))).toBe(false);
  });
});

describe("resumoDoDia", () => {
  it("soma apenas as execuções do dia consultado", () => {
    const runs = [
      exec({ slot: "09h", enviados: 20, falhas: 1 }),
      exec({ slot: "12h", status: "sem_envio", enviados: 0 }),
      exec({ data_ref: "2026-08-10", slot: "09h", enviados: 5 }),
    ];
    expect(resumoDoDia(runs, HOJE)).toEqual({
      tentativas: 2,
      enviados: 20,
      falhas: 1,
      concluida: true,
      comErro: false,
    });
  });

  it("marca o dia como não concluído quando só houve erro", () => {
    const runs = [exec({ status: "erro", enviados: 0, erro: "timeout do Sponte" })];
    expect(resumoDoDia(runs, HOJE)).toMatchObject({
      tentativas: 1,
      concluida: false,
      comErro: true,
    });
  });
});

describe("alertaExecucaoCron", () => {
  it("acusa quando o dia útil passou da hora limite sem nenhuma execução", () => {
    expect(alertaExecucaoCron([], HOJE, 13, true)).toBe(
      "A cobrança automática não foi executada hoje.",
    );
  });

  it("não acusa antes da hora limite (a 1ª tentativa ainda pode rodar)", () => {
    expect(alertaExecucaoCron([], HOJE, 9, true)).toBeNull();
  });

  it("não acusa em fim de semana ou feriado", () => {
    expect(alertaExecucaoCron([], "2026-08-09", 18, false)).toBeNull();
  });

  it("acusa quando houve tentativas, mas nenhuma concluiu", () => {
    const runs = [exec({ status: "erro" }), exec({ slot: "12h", status: "em_andamento" })];
    expect(alertaExecucaoCron(runs, HOJE, 15, true)).toBe(
      "A cobrança automática não concluiu nenhuma execução hoje.",
    );
  });

  it("some quando a tentativa perdida é coberta por outra do dia", () => {
    const runs = [
      exec({ status: "em_andamento", enviados: 0 }),
      exec({ slot: "12h", status: "ok" }),
    ];
    expect(alertaExecucaoCron(runs, HOJE, 15, true)).toBeNull();
  });

  it("mantém o aviso de falha quando o dia concluiu com uma tentativa em erro", () => {
    const runs = [
      exec({ status: "erro", enviados: 0 }),
      exec({ slot: "12h", status: "sem_envio" }),
    ];
    expect(alertaExecucaoCron(runs, HOJE, 15, true)).toBe(
      "A cobrança automática registrou falha em uma das tentativas de hoje.",
    );
  });

  it("não acusa o dia em que a régua rodou e ninguém era cobrável", () => {
    expect(
      alertaExecucaoCron([exec({ status: "sem_envio", enviados: 0 })], HOJE, 18, true),
    ).toBeNull();
  });
});
