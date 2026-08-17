import { describe, expect, it } from "vitest";
import {
  contadorNaoLidas,
  idsParaConcluirAutomaticamente,
  momentoLocal,
  notificacaoConcluida,
  notificacoesPendentes,
  reuniaoJaPassou,
  type NotificacaoReuniao,
} from "./agenda-notifications";

const AGORA = "2026-08-18T14:30";

function aviso(over: Partial<NotificacaoReuniao> = {}): NotificacaoReuniao {
  return {
    id: "n1",
    message: "Você foi incluído em uma reunião: Ana — 18/08/2026 às 15:00",
    read: false,
    created_at: "2026-08-17T10:00:00Z",
    concluded_at: null,
    reuniao: { data: "2026-08-18", horario: "15:00" },
    ...over,
  };
}

describe("reuniaoJaPassou", () => {
  it("compara data e hora quando a reunião tem horário", () => {
    expect(reuniaoJaPassou({ data: "2026-08-18", horario: "15:00" }, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: "2026-08-18", horario: "14:00" }, AGORA)).toBe(true);
    expect(reuniaoJaPassou({ data: "2026-08-19", horario: "08:00" }, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: "2026-08-17", horario: "23:59" }, AGORA)).toBe(true);
  });

  it("reunião de hoje sem horário só passa quando o dia vira", () => {
    expect(reuniaoJaPassou({ data: "2026-08-18", horario: null }, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: "2026-08-18", horario: "" }, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: "2026-08-17", horario: null }, AGORA)).toBe(true);
  });

  it("horário fora do formato cai na comparação por dia, não some do nada", () => {
    expect(reuniaoJaPassou({ data: "2026-08-18", horario: "manhã" }, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: "2026-08-18", horario: "99:99" }, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: "2026-08-17", horario: "manhã" }, AGORA)).toBe(true);
  });

  it("aviso sem reunião vinculada nunca conclui sozinho", () => {
    expect(reuniaoJaPassou(null, AGORA)).toBe(false);
    expect(reuniaoJaPassou({ data: null, horario: "15:00" }, AGORA)).toBe(false);
  });
});

describe("conclusão automática e lista pendente", () => {
  const passada = aviso({ id: "passada", reuniao: { data: "2026-08-10", horario: "09:00" } });
  const hojeAindaVai = aviso({ id: "hoje", reuniao: { data: "2026-08-18", horario: "16:00" } });
  const futura = aviso({ id: "futura", reuniao: { data: "2026-09-02", horario: "10:00" } });
  const jaConcluida = aviso({
    id: "manual",
    concluded_at: "2026-08-18T13:00:00Z",
    reuniao: { data: "2026-08-25", horario: "10:00" },
  });

  const todas = [passada, hojeAindaVai, futura, jaConcluida];

  it("check manual tira da lista mesmo com a reunião no futuro", () => {
    expect(notificacaoConcluida(jaConcluida, AGORA)).toBe(true);
    expect(notificacaoConcluida(futura, AGORA)).toBe(false);
  });

  it("a lista mostra só o que ainda não aconteceu nem foi marcado", () => {
    expect(notificacoesPendentes(todas, AGORA).map((n) => n.id)).toEqual(["hoje", "futura"]);
  });

  it("conclui automaticamente só a reunião passada ainda sem marca", () => {
    expect(idsParaConcluirAutomaticamente(todas, AGORA)).toEqual(["passada"]);
    // Depois de gravada, não tenta de novo (evita laço de update no sininho).
    const gravada = todas.map((n) =>
      n.id === "passada" ? { ...n, concluded_at: "2026-08-18T14:30:00Z" } : n,
    );
    expect(idsParaConcluirAutomaticamente(gravada, AGORA)).toEqual([]);
  });
});

describe("contador de não lidas", () => {
  it("conta apenas aviso pendente e não lido", () => {
    const lista = [
      aviso({ id: "a", read: false, reuniao: { data: "2026-08-19", horario: "10:00" } }),
      aviso({ id: "b", read: true, reuniao: { data: "2026-08-20", horario: "10:00" } }),
      // Reunião que já passou: sai do contador mesmo sem o usuário ter lido.
      aviso({ id: "c", read: false, reuniao: { data: "2026-08-01", horario: "10:00" } }),
      // Concluída no check: sai do contador mesmo com a reunião no futuro.
      aviso({
        id: "d",
        read: false,
        concluded_at: "2026-08-18T09:00:00Z",
        reuniao: { data: "2026-08-30", horario: "10:00" },
      }),
    ];
    expect(contadorNaoLidas(lista, AGORA)).toBe(1);
  });

  it("sem avisos o contador é zero", () => {
    expect(contadorNaoLidas([], AGORA)).toBe(0);
  });
});

describe("momentoLocal", () => {
  it("usa o horário local, com zero à esquerda, no formato do vencimento", () => {
    expect(momentoLocal(new Date(2026, 7, 3, 9, 5))).toBe("2026-08-03T09:05");
    expect(momentoLocal(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31T23:59");
  });
});
