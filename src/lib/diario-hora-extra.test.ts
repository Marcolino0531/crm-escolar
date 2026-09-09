import { describe, expect, it } from "vitest";
import type { SchedulePlan } from "@/lib/diario";
import {
  avaliarRegistro,
  formatarMinutos,
  hhmmParaMinutos,
  inferirDirecao,
  minutosHoraExtra,
} from "@/lib/diario-hora-extra";

// Exemplo do áudio do diretor: contratado 13h às 17h30.
const DIA = { entry: "13:00", exit: "17:30" };
const SEGUNDA = 1;
const plano: SchedulePlan = {
  0: null,
  1: DIA,
  2: DIA,
  3: DIA,
  4: DIA,
  5: DIA,
  6: null,
};
// 2026-09-07 é segunda-feira.
const em = (hhmm: string) => new Date(2026, 8, 7, ...hhmm.split(":").map(Number));

describe("minutosHoraExtra — entrada (tolerância de 15 min antes)", () => {
  it("entrada 12h45 (exatamente na tolerância) não gera minutos", () => {
    expect(minutosHoraExtra("entrada", hhmmParaMinutos("12:45"), DIA)).toBe(0);
  });
  it("entrada 12h50 (dentro da tolerância) não gera minutos", () => {
    expect(minutosHoraExtra("entrada", hhmmParaMinutos("12:50"), DIA)).toBe(0);
  });
  it("entrada 12h44 (fora da tolerância) cobra o total até o contratado: 16 min", () => {
    expect(minutosHoraExtra("entrada", hhmmParaMinutos("12:44"), DIA)).toBe(16);
  });
  it("entrada 12h00 gera 60 minutos (total, sem descontar a tolerância)", () => {
    expect(minutosHoraExtra("entrada", hhmmParaMinutos("12:00"), DIA)).toBe(60);
  });
  it("caso da Alice: contratada 13h00, registrada 07h50 → 5h10 (310 min), não 4h55", () => {
    expect(minutosHoraExtra("entrada", hhmmParaMinutos("07:50"), DIA)).toBe(310);
  });
  it("entrada depois do horário contratado não gera minutos", () => {
    expect(minutosHoraExtra("entrada", hhmmParaMinutos("13:20"), DIA)).toBe(0);
  });
});

describe("minutosHoraExtra — saída (tolerância de 30 min depois)", () => {
  it("saída 18h00 (exatamente na tolerância) não gera minutos", () => {
    expect(minutosHoraExtra("saida", hhmmParaMinutos("18:00"), DIA)).toBe(0);
  });
  it("saída 17h50 (dentro da tolerância) não gera minutos", () => {
    expect(minutosHoraExtra("saida", hhmmParaMinutos("17:50"), DIA)).toBe(0);
  });
  it("saída 18h01 (fora da tolerância) cobra o total desde o contratado: 31 min", () => {
    expect(minutosHoraExtra("saida", hhmmParaMinutos("18:01"), DIA)).toBe(31);
  });
  it("saída 19h00 gera 90 minutos (total, sem descontar a tolerância)", () => {
    expect(minutosHoraExtra("saida", hhmmParaMinutos("19:00"), DIA)).toBe(90);
  });
  it("saída antes do horário contratado não gera minutos", () => {
    expect(minutosHoraExtra("saida", hhmmParaMinutos("17:00"), DIA)).toBe(0);
  });
});

describe("os quatro casos do áudio (pontas independentes)", () => {
  const total = (entrada: string | null, saida: string | null) =>
    (entrada ? minutosHoraExtra("entrada", hhmmParaMinutos(entrada), DIA) : 0) +
    (saida ? minutosHoraExtra("saida", hhmmParaMinutos(saida), DIA) : 0);

  it("nenhuma ponta registrada: 0 (chegou e saiu no contratado)", () => {
    expect(total(null, null)).toBe(0);
  });
  it("só entrada antecipada (12h00): 60 min", () => {
    expect(total("12:00", null)).toBe(60);
  });
  it("só saída atrasada (18h30): 60 min", () => {
    expect(total(null, "18:30")).toBe(60);
  });
  it("as duas pontas (12h00 e 18h30): 120 min", () => {
    expect(total("12:00", "18:30")).toBe(120);
  });
  it("entrada 12h45 e saída 18h00 (dentro das duas tolerâncias): 0", () => {
    expect(total("12:45", "18:00")).toBe(0);
  });
});

describe("avaliarRegistro", () => {
  it("dentro da tolerância: não cobra, 0 minutos, sem motivo", () => {
    expect(avaliarRegistro(plano, "entrada", em("12:50"))).toEqual({
      temHorario: true,
      minutos: 0,
      cobra: false,
      motivo: null,
    });
  });
  it("além da tolerância: cobra o tempo total desde o contratado e explica", () => {
    const av = avaliarRegistro(plano, "saida", em("19:15"));
    expect(av.cobra).toBe(true);
    expect(av.minutos).toBe(105);
    expect(av.motivo).toBe("1h45 depois das 17:30 (tolerância de 30 min)");
  });
  it("dia sem horário contratado: cobra com minutos nulos (conferir manualmente)", () => {
    const domingo = new Date(2026, 8, 6, 15, 0);
    expect(domingo.getDay()).not.toBe(SEGUNDA);
    const av = avaliarRegistro(plano, "entrada", domingo);
    expect(av).toMatchObject({ temHorario: false, minutos: null, cobra: true });
    expect(av.motivo).toMatch(/Sem horário contratado/);
  });
});

describe("inferirDirecao (portaria via QR)", () => {
  it("antes do meio do horário contratado é entrada, depois é saída", () => {
    expect(inferirDirecao(DIA, hhmmParaMinutos("12:30"))).toBe("entrada");
    expect(inferirDirecao(DIA, hhmmParaMinutos("15:14"))).toBe("entrada");
    expect(inferirDirecao(DIA, hhmmParaMinutos("15:15"))).toBe("saida");
    expect(inferirDirecao(DIA, hhmmParaMinutos("18:10"))).toBe("saida");
  });
  it("sem horário no dia: manhã é entrada, tarde é saída", () => {
    expect(inferirDirecao(null, hhmmParaMinutos("08:00"))).toBe("entrada");
    expect(inferirDirecao(null, hhmmParaMinutos("12:00"))).toBe("saida");
  });
});

describe("formatarMinutos", () => {
  it("formata minutos, horas cheias e horas com minutos", () => {
    expect(formatarMinutos(5)).toBe("5 min");
    expect(formatarMinutos(60)).toBe("1h");
    expect(formatarMinutos(75)).toBe("1h15");
    expect(formatarMinutos(125)).toBe("2h05");
  });
});
