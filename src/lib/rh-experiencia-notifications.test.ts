import { describe, expect, it } from "vitest";
import {
  avisosExperienciaPendentes,
  dataAvisoExperiencia,
  dataMarcoExperiencia,
  mensagemAvisoExperiencia,
  type FuncionarioExperiencia,
} from "./rh-experiencia-notifications";

// Hoje fixo: 2026-09-08. Admissões calculadas para cair exatamente nos marcos.
const HOJE = "2026-09-08";
const ADMITIDO_HA_44 = "2026-07-26"; // +44 = 08/09
const ADMITIDO_HA_89 = "2026-06-11"; // +89 = 08/09
const ADMITIDO_HA_10 = "2026-08-29";

const f = (
  id: string,
  dataAdmissao: string | null,
  dataRescisao: string | null = null,
): FuncionarioExperiencia => ({ id, nome: `Func ${id}`, dataAdmissao, dataRescisao });

describe("datas dos marcos de experiência", () => {
  it("marco = admissão + 45/90 e aviso na véspera", () => {
    expect(dataMarcoExperiencia("2026-01-01", 45)).toBe("2026-02-15");
    expect(dataAvisoExperiencia("2026-01-01", 45)).toBe("2026-02-14");
    expect(dataMarcoExperiencia("2026-01-01", 90)).toBe("2026-04-01");
    expect(dataAvisoExperiencia("2026-01-01", 90)).toBe("2026-03-31");
  });

  it("atravessa virada de ano", () => {
    expect(dataAvisoExperiencia("2026-11-20", 90)).toBe("2027-02-17");
  });
});

describe("avisosExperienciaPendentes", () => {
  it("admitido há 44 dias aparece só com o aviso de 45", () => {
    const avisos = avisosExperienciaPendentes([f("a", ADMITIDO_HA_44)], [], HOJE);
    expect(avisos).toEqual([
      {
        funcionarioId: "a",
        nome: "Func a",
        marco: 45,
        dataMarco: "2026-09-09",
        dataAviso: HOJE,
      },
    ]);
  });

  it("admitido há 89 dias aparece com o de 90 (e o de 45 se ainda não lido)", () => {
    const avisos = avisosExperienciaPendentes([f("b", ADMITIDO_HA_89)], [], HOJE);
    expect(avisos.map((a) => a.marco)).toEqual([45, 90]);
    expect(avisos[1].dataMarco).toBe("2026-09-09");
  });

  it("admitido há 89 dias com o de 45 já lido mostra só o de 90", () => {
    const avisos = avisosExperienciaPendentes(
      [f("b", ADMITIDO_HA_89)],
      [{ funcionarioId: "b", marco: 45 }],
      HOJE,
    );
    expect(avisos.map((a) => a.marco)).toEqual([90]);
  });

  it("desligado (com data de rescisão) não aparece", () => {
    expect(avisosExperienciaPendentes([f("c", ADMITIDO_HA_44, "2026-09-01")], [], HOJE)).toEqual(
      [],
    );
  });

  it("aviso já marcado como lido não reaparece", () => {
    expect(
      avisosExperienciaPendentes(
        [f("a", ADMITIDO_HA_44)],
        [{ funcionarioId: "a", marco: 45 }],
        HOJE,
      ),
    ).toEqual([]);
  });

  it("aviso não some sozinho depois do marco: continua até ser lido", () => {
    const avisos = avisosExperienciaPendentes([f("d", "2026-05-01")], [], HOJE);
    expect(avisos.map((a) => a.marco)).toEqual([45, 90]);
  });

  it("um dia antes da véspera ainda não aparece; sem admissão, ignora", () => {
    expect(avisosExperienciaPendentes([f("e", "2026-07-27")], [], HOJE)).toEqual([]);
    expect(avisosExperienciaPendentes([f("g", ADMITIDO_HA_10)], [], HOJE)).toEqual([]);
    expect(avisosExperienciaPendentes([f("h", null)], [], HOJE)).toEqual([]);
    expect(avisosExperienciaPendentes([f("i", "")], [], HOJE)).toEqual([]);
  });

  it("lido de outro funcionário não afeta", () => {
    const avisos = avisosExperienciaPendentes(
      [f("a", ADMITIDO_HA_44)],
      [{ funcionarioId: "z", marco: 45 }],
      HOJE,
    );
    expect(avisos).toHaveLength(1);
  });
});

describe("mensagemAvisoExperiencia", () => {
  it("varia conforme amanhã / hoje / já passou", () => {
    const base = { funcionarioId: "a", nome: "Rafaela", dataAviso: HOJE };
    expect(mensagemAvisoExperiencia({ ...base, marco: 45, dataMarco: "2026-09-09" }, HOJE)).toBe(
      "Rafaela completa amanhã os primeiros 45 dias de experiência.",
    );
    expect(mensagemAvisoExperiencia({ ...base, marco: 90, dataMarco: HOJE }, HOJE)).toBe(
      "Rafaela completa hoje os 90 dias de experiência (prorrogação).",
    );
    expect(mensagemAvisoExperiencia({ ...base, marco: 90, dataMarco: "2026-09-01" }, HOJE)).toBe(
      "Rafaela já completou os 90 dias de experiência (prorrogação).",
    );
  });
});
