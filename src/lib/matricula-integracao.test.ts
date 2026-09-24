import { describe, expect, it } from "vitest";
import {
  montarSecoesFinanceiras,
  motivosPendencia,
  seloCobranca,
  seloTurma,
  temPendencia,
  vencimentosDoLancamento,
  type LancamentoFicha,
  type SituacaoSubmissao,
} from "./matricula-integracao";

const OK: SituacaoSubmissao = {
  status: "sucesso",
  erro: null,
  turma_status: "matriculado",
  turma_pendencia: null,
  turma_nome: "04 - Maternal 3 M",
  faturamento_status: "lancado",
  faturamento_pendencia: null,
};

function lanc(parcial: Partial<LancamentoFicha> & { tipo: string }): LancamentoFicha {
  return {
    parcelas: 1,
    valor_parcela: 0,
    valor_primeira_parcela: 0,
    primeiro_vencimento: null,
    total: 0,
    status: "lancado",
    erro: null,
    sponte_conta_receber_id: null,
    ...parcial,
  };
}

describe("selos Turma e Cobrança", () => {
  it("tudo certo: Matriculado + Lançada, sem pendência", () => {
    expect(seloTurma(OK)?.rotulo).toBe("Matriculado");
    expect(seloCobranca(OK)?.rotulo).toBe("Lançada");
    expect(temPendencia(OK)).toBe(false);
  });

  it("caso real 706: sem turma e nao_aplicavel → Pendente/Pendente com motivos", () => {
    const s: SituacaoSubmissao = {
      ...OK,
      turma_status: "sem_turma",
      turma_pendencia: "Nenhuma turma aberta para Maternal 3 — turno Tarde",
      turma_nome: null,
      faturamento_status: "nao_aplicavel",
      faturamento_pendencia: "Matrícula sem turma formalizada",
    };
    expect(seloTurma(s)?.valor).toBe("pendente");
    expect(seloCobranca(s)?.valor).toBe("pendente");
    expect(motivosPendencia(s)).toEqual([
      "Turma: Nenhuma turma aberta para Maternal 3 — turno Tarde",
      "Cobrança: Matrícula sem turma formalizada",
    ]);
  });

  it("caso real 707: matriculado e sem_plano → só a cobrança pendente", () => {
    const s: SituacaoSubmissao = {
      ...OK,
      faturamento_status: "sem_plano",
      faturamento_pendencia: "O plano do curso não tem valor de matrícula com data de vencimento.",
    };
    expect(motivosPendencia(s)).toEqual([
      "Cobrança: O plano do curso não tem valor de matrícula com data de vencimento.",
    ]);
  });

  it("erro na criação no Sponte conta como pendência mesmo sem turma/faturamento", () => {
    const s: SituacaoSubmissao = {
      status: "erro_aluno",
      erro: "CPF inválido",
      turma_status: null,
      turma_pendencia: null,
      turma_nome: null,
      faturamento_status: null,
      faturamento_pendencia: null,
    };
    expect(seloTurma(s)).toBeNull();
    expect(seloCobranca(s)).toBeNull();
    expect(motivosPendencia(s)).toEqual(["Criação no Sponte: CPF inválido"]);
  });

  it("parcial e erro viram pendência; resolvida manualmente deixa de contar", () => {
    expect(temPendencia({ ...OK, faturamento_status: "parcial" })).toBe(true);
    expect(temPendencia({ ...OK, turma_status: "erro" })).toBe(true);
    expect(
      temPendencia({ ...OK, turma_status: "erro", pendencia_resolvida_em: "2026-09-25T10:00:00Z" }),
    ).toBe(false);
  });
});

describe("seções financeiras da ficha", () => {
  it("vencimentos: 1º gravado e demais no dia 05", () => {
    expect(vencimentosDoLancamento({ parcelas: 3, primeiro_vencimento: "2026-09-20" })).toEqual([
      "2026-09-20",
      "2026-10-05",
      "2026-11-05",
    ]);
    expect(vencimentosDoLancamento({ parcelas: 3, primeiro_vencimento: null })).toEqual([]);
  });

  it("monta Matrícula, Mensalidades, Material e Integração a partir dos lançamentos", () => {
    const secoes = montarSecoesFinanceiras(
      { ...OK, faturamento_status: "parcial", faturamento_pendencia: "Alimentação: sem valor." },
      {
        matricula_valor: 2057.1,
        matricula_parcelas: 3,
        matricula_primeiro_vencimento: "2026-09-20",
        material_valor_anual: 2209.5,
        material_parcelas: 8,
      },
      [
        lanc({
          tipo: "matricula",
          parcelas: 3,
          valor_parcela: 685.7,
          primeiro_vencimento: "2026-09-20",
          total: 2057.1,
          sponte_conta_receber_id: "9001",
        }),
        lanc({
          tipo: "mensalidade",
          parcelas: 4,
          valor_parcela: 1500,
          primeiro_vencimento: "2026-09-21",
          total: 6000,
        }),
        lanc({
          tipo: "material",
          parcelas: 4,
          valor_parcela: 552.38,
          primeiro_vencimento: "2026-09-21",
          total: 2209.5,
          status: "ajuste_pendente",
        }),
      ],
    );
    expect(secoes.map((s) => s.titulo)).toEqual([
      "Matrícula",
      "Mensalidades",
      "Material pedagógico",
      "Integração",
    ]);
    const campos = (i: number) =>
      Object.fromEntries(secoes[i].grupos.flatMap((g) => g.campos.map((c) => [c.rotulo, c.valor])));
    expect(campos(0)["Parcelas escolhidas"]).toBe("3x de R$ 685,70");
    expect(campos(0)["Vencimentos"]).toBe("20/09/2026, 05/10/2026, 05/11/2026");
    expect(campos(0)["Conta a receber (Sponte)"]).toBe("9001");
    expect(campos(1)["Quantidade"]).toBe("4");
    expect(campos(1)["Vencimentos"]).toBe("21/09/2026, 05/10/2026, 05/11/2026, 07/12/2026");
    expect(campos(2)["Parcelas escolhidas pelo responsável"]).toBe("8x");
    expect(campos(2)["Parcelas lançadas"]).toBe("4x (limitadas às mensalidades restantes)");
    expect(campos(2)["Status no Sponte"]).toBe("Lançado (ajuste da 1ª parcela pendente)");
    expect(campos(3)["Status geral"]).toBe("Parcial");
    expect(campos(3)["Pendências"]).toBe("Alimentação: sem valor.");
    expect(campos(3)["Matrícula"]).toBe("Lançado · 3x · R$ 2.057,10");
  });

  it("sem valor de matrícula, a seção explica que a secretaria combina o pagamento", () => {
    const [matricula] = montarSecoesFinanceiras(
      OK,
      {
        matricula_valor: null,
        matricula_parcelas: null,
        matricula_primeiro_vencimento: null,
        material_valor_anual: null,
        material_parcelas: null,
      },
      [],
    );
    expect(matricula.grupos[0].campos[0].valor).toMatch(/secretaria combina/);
  });
});
