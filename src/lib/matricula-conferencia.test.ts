import { describe, expect, it } from "vitest";
import {
  lerConferenciaManual,
  montarCamposConferenciaManual,
  tocaCamposFixados,
} from "@/lib/matricula-conferencia";

const base = { em: "2026-09-30T12:00:00.000Z", porId: "u-1", porNome: "Sérgio" };

describe("montarCamposConferenciaManual", () => {
  it("as duas marcadas: status, pendências resolvidas e conferência fixada", () => {
    const r = montarCamposConferenciaManual({
      ...base,
      turmaConferida: true,
      cobrancaLancada: true,
    });
    expect(r.fixado).toBe(true);
    expect(r.campos).toEqual({
      conferencia: {
        manual: true,
        turmaConferida: true,
        cobrancaLancada: true,
        em: base.em,
        por: "Sérgio",
      },
      turma_status: "matriculado",
      turma_pendencia: null,
      faturamento_status: "lancado",
      faturamento_pendencia: null,
      pendencia_resolvida_em: base.em,
      pendencia_resolvida_por: "Sérgio",
      conferido_em: base.em,
      conferido_por: "u-1",
      conferido_por_nome: "Sérgio",
    });
    expect(r.campos).not.toHaveProperty("turma_nome");
  });

  it("só a turma: atualiza a turma e não fixa", () => {
    const r = montarCamposConferenciaManual({
      ...base,
      turmaConferida: true,
      cobrancaLancada: false,
    });
    expect(r.fixado).toBe(false);
    expect(r.campos.turma_status).toBe("matriculado");
    expect(r.campos).not.toHaveProperty("faturamento_status");
    expect(r.campos).not.toHaveProperty("conferido_em");
    expect(r.campos).not.toHaveProperty("pendencia_resolvida_em");
  });

  it("só a cobrança: atualiza a cobrança e não fixa", () => {
    const r = montarCamposConferenciaManual({
      ...base,
      turmaConferida: false,
      cobrancaLancada: true,
    });
    expect(r.fixado).toBe(false);
    expect(r.campos.faturamento_status).toBe("lancado");
    expect(r.campos).not.toHaveProperty("turma_status");
    expect(r.campos).not.toHaveProperty("conferido_em");
  });
});

describe("lerConferenciaManual / tocaCamposFixados", () => {
  it("ignora conferência ausente ou de outro formato", () => {
    expect(lerConferenciaManual(null)).toBeNull();
    expect(lerConferenciaManual({ turma: { ok: true } })).toBeNull();
    expect(
      lerConferenciaManual({ manual: true, turmaConferida: true, cobrancaLancada: false }),
    ).toMatchObject({ turmaConferida: true, cobrancaLancada: false });
  });

  it("aluno_nome não é campo fixado", () => {
    expect(tocaCamposFixados({ aluno_nome: "X" })).toBe(false);
    expect(tocaCamposFixados({ turma_status: "matriculado" })).toBe(true);
  });
});
