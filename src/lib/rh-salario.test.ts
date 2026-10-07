import { describe, expect, it } from "vitest";
import {
  competenciaAtual,
  competenciaDe,
  competenciaValida,
  historicoDoFuncionario,
  partesCompetencia,
  preenchimentoSalario,
  rotuloCompetencia,
  salarioVigente,
  validarSalario,
  type SalarioRegistro,
} from "./rh-salario";

const reg = (
  funcionarioId: string,
  competencia: string,
  valor: number,
  id = `${funcionarioId}-${competencia}`,
  valorLiquido: number | null = null,
  observacao = "",
): SalarioRegistro => ({
  id,
  funcionarioId,
  competencia,
  valor,
  valorLiquido,
  observacao,
  criadoEm: "2026-01-01T00:00:00Z",
  criadoPor: "Teste",
});

const base = [
  reg("a", "2026-01", 2000),
  reg("a", "2026-07", 2200),
  reg("a", "2025-05", 1800),
  reg("b", "2026-03", 3000),
];

describe("competência", () => {
  it("valida YYYY-MM", () => {
    expect(competenciaValida("2026-09")).toBe(true);
    expect(competenciaValida("2026-13")).toBe(false);
    expect(competenciaValida("09/2026")).toBe(false);
    expect(competenciaValida("")).toBe(false);
  });

  it("competência atual e rótulo MM/AAAA", () => {
    expect(competenciaAtual(new Date(2026, 8, 17))).toBe("2026-09");
    expect(rotuloCompetencia("2026-09")).toBe("09/2026");
  });
});

describe("historicoDoFuncionario", () => {
  it("filtra pelo funcionário, mais recente primeiro, sem mutar a entrada", () => {
    const copia = [...base];
    expect(historicoDoFuncionario(base, "a").map((r) => r.competencia)).toEqual([
      "2026-07",
      "2026-01",
      "2025-05",
    ]);
    expect(base).toEqual(copia);
  });
});

describe("salarioVigente", () => {
  it("usa a maior competência <= pedida (histórico preservado, não sobrescreve)", () => {
    expect(salarioVigente(base, "a", "2026-03")?.valor).toBe(2000);
    expect(salarioVigente(base, "a", "2026-07")?.valor).toBe(2200);
    expect(salarioVigente(base, "a", "2027-01")?.valor).toBe(2200);
    expect(salarioVigente(base, "a", "2025-12")?.valor).toBe(1800);
  });

  it("antes do primeiro registro ou funcionário sem salário → null", () => {
    expect(salarioVigente(base, "a", "2025-01")).toBeNull();
    expect(salarioVigente(base, "c", "2026-09")).toBeNull();
  });

  it("não vaza salário de outro funcionário", () => {
    expect(salarioVigente(base, "b", "2026-09")?.valor).toBe(3000);
    expect(salarioVigente(base, "b", "2026-02")).toBeNull();
  });
});

describe("competenciaDe / partesCompetencia", () => {
  it("mês+ano ⇄ YYYY-MM", () => {
    expect(competenciaDe(2026, 9)).toBe("2026-09");
    expect(competenciaDe(2027, 12)).toBe("2027-12");
    expect(partesCompetencia("2026-09")).toEqual({ ano: 2026, mes: 9 });
  });
});

describe("preenchimentoSalario (pré-preenchimento do cadastro)", () => {
  const regs = [
    reg("a", "2026-07", 2200, undefined, 1900, "reajuste"),
    reg("a", "2026-01", 2000, undefined, 1750),
  ];

  it("competência sem registro próprio herda bruto e líquido do vigente (virada do mês)", () => {
    expect(preenchimentoSalario(regs, "a", "2026-08")).toEqual({
      valor: 2200,
      valorLiquido: 1900,
      observacao: "",
      proprio: false,
      origem: "2026-07",
    });
  });

  it("competência com registro próprio devolve o próprio (inclusive observação)", () => {
    expect(preenchimentoSalario(regs, "a", "2026-07")).toEqual({
      valor: 2200,
      valorLiquido: 1900,
      observacao: "reajuste",
      proprio: true,
      origem: "2026-07",
    });
  });

  it("competência entre dois registros herda do anterior, não do posterior", () => {
    expect(preenchimentoSalario(regs, "a", "2026-04")).toMatchObject({
      valor: 2000,
      valorLiquido: 1750,
      proprio: false,
      origem: "2026-01",
    });
  });

  it("sem histórico anterior → campos vazios", () => {
    expect(preenchimentoSalario(regs, "a", "2025-12")).toEqual({
      valor: null,
      valorLiquido: null,
      observacao: "",
      proprio: false,
      origem: null,
    });
    expect(preenchimentoSalario(regs, "zz", "2026-08").valor).toBeNull();
  });

  it("não muta os registros (salvar só cria a competência selecionada)", () => {
    const antes = JSON.stringify(regs);
    preenchimentoSalario(regs, "a", "2026-08");
    expect(JSON.stringify(regs)).toBe(antes);
  });
});

describe("validarSalario", () => {
  it("líquido é opcional, mas se vier precisa ser >= 0", () => {
    expect(validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: null })).toEqual({});
    expect(validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: 90 })).toEqual({});
    expect(
      validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: -1 }).valorLiquido,
    ).toBeTruthy();
    expect(
      validarSalario({ competencia: "2026-09", valor: 100, valorLiquido: NaN }).valorLiquido,
    ).toBeTruthy();
  });

  it("aceita competência válida e valor >= 0", () => {
    expect(validarSalario({ competencia: "2026-09", valor: 0 })).toEqual({});
    expect(validarSalario({ competencia: "2026-09", valor: 2500.5 })).toEqual({});
  });

  it("rejeita competência inválida e valor negativo/NaN", () => {
    expect(validarSalario({ competencia: "2026", valor: -1 })).toEqual({
      competencia: "Informe a competência (MM/AAAA).",
      valor: "Informe um valor maior ou igual a zero.",
    });
    expect(validarSalario({ competencia: "2026-09", valor: NaN }).valor).toBeDefined();
  });
});

// ── Terceirizados e Extras: valor mensal ────────────────────────────────────
import {
  historicoValorMensal,
  totalDoBloco,
  valorAPagar,
  valorMensalVigente,
  type TipoPessoaPagamento,
  type ValorMensalRegistro,
} from "./rh-salario";

const vm = (
  tipo: TipoPessoaPagamento,
  pessoaId: string,
  competencia: string,
  valor: number,
): ValorMensalRegistro => ({
  id: `${tipo}-${pessoaId}-${competencia}`,
  tipo,
  pessoaId,
  competencia,
  valor,
  observacao: "",
  criadoEm: "2026-01-01T00:00:00Z",
  criadoPor: "Teste",
});

describe("valor mensal de Terceirizados e Extras", () => {
  const valores = [
    vm("terceirizado", "t1", "2026-03", 800),
    vm("terceirizado", "t1", "2026-06", 950.5),
    vm("extra", "e1", "2026-02", 300),
    vm("extra", "e1", "2026-05", 0),
    vm("extra", "e2", "2026-04", 120.1),
  ];

  it("5.1 vale no mês lançado e nos seguintes; outro lançamento troca a partir da nova competência", () => {
    expect(valorAPagar(valores, "terceirizado", "t1", "2026-03")).toBe(800);
    expect(valorAPagar(valores, "terceirizado", "t1", "2026-05")).toBe(800);
    expect(valorAPagar(valores, "terceirizado", "t1", "2026-06")).toBe(950.5);
    expect(valorAPagar(valores, "terceirizado", "t1", "2027-01")).toBe(950.5);
  });

  it("5.1 competência anterior ao primeiro lançamento fica sem valor", () => {
    expect(valorAPagar(valores, "terceirizado", "t1", "2026-02")).toBeNull();
    expect(valorMensalVigente(valores, "terceirizado", "t1", "2026-02")).toBeNull();
  });

  it("5.2 valor zero encerra a partir daquela competência", () => {
    expect(valorAPagar(valores, "extra", "e1", "2026-04")).toBe(300);
    expect(valorAPagar(valores, "extra", "e1", "2026-05")).toBeNull();
    expect(valorAPagar(valores, "extra", "e1", "2026-12")).toBeNull();
    expect(valorMensalVigente(valores, "extra", "e1", "2026-07")?.valor).toBe(0);
  });

  it("não mistura tipos: mesmo id como terceirizado e como Extra são pessoas diferentes", () => {
    const mistos = [vm("terceirizado", "x", "2026-01", 500), vm("extra", "x", "2026-01", 70)];
    expect(valorAPagar(mistos, "terceirizado", "x", "2026-02")).toBe(500);
    expect(valorAPagar(mistos, "extra", "x", "2026-02")).toBe(70);
    expect(historicoValorMensal(mistos, "extra", "x").map((r) => r.valor)).toEqual([70]);
  });

  it("histórico da pessoa, mais recente primeiro, sem mutar a entrada", () => {
    const antes = JSON.stringify(valores);
    expect(historicoValorMensal(valores, "terceirizado", "t1").map((r) => r.competencia)).toEqual([
      "2026-06",
      "2026-03",
    ]);
    expect(JSON.stringify(valores)).toBe(antes);
  });

  it("5.3 total do bloco = soma dos vigentes das pessoas ativas; inativada não entra", () => {
    const extras = [
      { id: "e1", ativo: true },
      { id: "e2", ativo: true },
      { id: "e3", ativo: false },
    ];
    const comInativo = [...valores, vm("extra", "e3", "2026-01", 999)];
    expect(totalDoBloco(extras, comInativo, "extra", "2026-04")).toBe(420.1);
    // e1 encerrado em 05: só e2.
    expect(totalDoBloco(extras, comInativo, "extra", "2026-05")).toBe(120.1);
    expect(totalDoBloco(extras, comInativo, "extra", "2026-01")).toBe(0);
    expect(totalDoBloco([{ id: "t1", ativo: true }], valores, "terceirizado", "2026-07")).toBe(
      950.5,
    );
  });

  it("total soma em centavos (sem erro de ponto flutuante)", () => {
    const regs = [vm("extra", "a", "2026-01", 0.1), vm("extra", "b", "2026-01", 0.2)];
    const pessoas = [
      { id: "a", ativo: true },
      { id: "b", ativo: true },
    ];
    expect(totalDoBloco(pessoas, regs, "extra", "2026-01")).toBe(0.3);
  });
});

describe("5.4 vigência dos efetivos continua igual", () => {
  it("mesmos resultados de salarioVigente/historicoDoFuncionario", () => {
    expect(salarioVigente(base, "a", "2026-03")?.id).toBe("a-2026-01");
    expect(salarioVigente(base, "a", "2025-01")).toBeNull();
    expect(salarioVigente(base, "b", "2026-02")).toBeNull();
    expect(historicoDoFuncionario(base, "b").map((r) => r.id)).toEqual(["b-2026-03"]);
  });
});

// ── Conferência do servidor: itens de Terceirizado e Extra no lote ─────────
import { conferirItensValorMensal } from "./rh-salario";

describe("conferirItensValorMensal", () => {
  const registros = [vm("terceirizado", "t1", "2026-03", 800.1), vm("extra", "e1", "2026-03", 300)];
  const pessoas = new Map([
    ["terceirizado:t1", { schoolId: "s1", ativo: true }],
    ["extra:e1", { schoolId: "s1", ativo: true }],
    ["extra:e2", { schoolId: "s2", ativo: true }],
    ["terceirizado:t9", { schoolId: "s1", ativo: false }],
  ]);
  const item = (tipo: TipoPessoaPagamento, pessoaId: string, valor: number) => ({
    tipo,
    pessoaId,
    nome: "Pessoa Teste",
    valor,
  });
  const conferir = (itens: ReturnType<typeof item>[]) =>
    conferirItensValorMensal(itens, pessoas, registros, "s1", "2026-06");

  it("aceita valor igual, em centavos, ao valor a pagar", () => {
    expect(conferir([item("terceirizado", "t1", 800.1), item("extra", "e1", 300)])).toBeNull();
  });

  it("recusa valor diferente do valor a pagar", () => {
    expect(conferir([item("terceirizado", "t1", 800.11)])).toMatch(/não confere/);
  });

  it("recusa pessoa de outro colégio", () => {
    expect(conferir([item("extra", "e2", 300)])).toMatch(/outro colégio/);
  });

  it("recusa pessoa inativa", () => {
    expect(conferir([item("terceirizado", "t9", 800.1)])).toMatch(/inativo/);
  });

  it("recusa pessoa sem valor a pagar, inexistente ou repetida", () => {
    expect(
      conferirItensValorMensal([item("extra", "e1", 300)], pessoas, [], "s1", "2026-06"),
    ).toMatch(/não confere/);
    expect(conferir([item("extra", "nada", 1)])).toMatch(/não encontrado/);
    expect(conferir([item("extra", "e1", 300), item("extra", "e1", 300)])).toMatch(
      /mais de uma vez/,
    );
  });
});
