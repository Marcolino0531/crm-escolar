import { describe, expect, it } from "vitest";
import {
  contagemQuitados,
  montarFolhaSalario,
  podeEditarLote,
  podeVerLote,
  tipoLote,
} from "./rh-folhas";
import type { SalarioRegistro } from "./rh-salario";

const reg = (
  funcionarioId: string,
  competencia: string,
  valor: number,
  valorLiquido: number | null = null,
): SalarioRegistro => ({
  id: `${funcionarioId}-${competencia}`,
  funcionarioId,
  competencia,
  valor,
  valorLiquido,
  observacao: "",
  criadoEm: "2026-01-01T00:00:00Z",
  criadoPor: "Teste",
});

const funcs = [
  { id: "b", nomeCompleto: "Bruna" },
  { id: "a", nomeCompleto: "Ana" },
  { id: "c", nomeCompleto: "Carlos", dataRescisao: "2026-05-01" },
  { id: "d", nomeCompleto: "Dora" },
];

const regs = [
  reg("a", "2026-01", 3000, 2500),
  reg("a", "2026-09", 3300, 2700),
  reg("b", "2026-03", 2000),
  reg("c", "2026-01", 9999, 9000),
  reg("d", "2026-10", 1500),
];

describe("tipoLote", () => {
  it("tudo que não é 'salario' é VT (dados antigos sem tipo)", () => {
    expect(tipoLote("salario")).toBe("salario");
    expect(tipoLote("vt")).toBe("vt");
    expect(tipoLote(null)).toBe("vt");
    expect(tipoLote(undefined)).toBe("vt");
  });
});

describe("montarFolhaSalario", () => {
  it("um item por ativo com salário vigente, líquido quando houver, ordenado por nome", () => {
    const f = montarFolhaSalario(funcs, regs, "2026-08");
    expect(f.itens).toEqual([
      { employee_id: "a", employee_name: "Ana", total_amount: 2500 },
      { employee_id: "b", employee_name: "Bruna", total_amount: 2000 },
    ]);
    expect(f.total).toBe(4500);
  });

  it("respeita a competência (reajuste de setembro não entra em agosto)", () => {
    expect(montarFolhaSalario(funcs, regs, "2026-09").itens[0].total_amount).toBe(2700);
    expect(montarFolhaSalario(funcs, regs, "2026-08").itens[0].total_amount).toBe(2500);
  });

  it("desligado fica fora; ativo sem salário vigente vai para semSalario", () => {
    const f = montarFolhaSalario(funcs, regs, "2026-08");
    expect(f.itens.map((i) => i.employee_id)).not.toContain("c");
    expect(f.semSalario).toEqual(["Dora"]);
    // Em outubro Dora já tem salário.
    expect(montarFolhaSalario(funcs, regs, "2026-10").semSalario).toEqual([]);
  });

  it("total arredondado a centavos", () => {
    const f = montarFolhaSalario(
      [
        { id: "x", nomeCompleto: "X" },
        { id: "y", nomeCompleto: "Y" },
      ],
      [reg("x", "2026-01", 0.1), reg("y", "2026-01", 0.2)],
      "2026-01",
    );
    expect(f.total).toBe(0.3);
  });
});

describe("permissões por tipo de lote", () => {
  const soRh = { podeEditarRh: true, podeVerSalario: false, podeEditarSalario: false };
  const veSalario = { podeEditarRh: false, podeVerSalario: true, podeEditarSalario: false };
  const editaSalario = { podeEditarRh: false, podeVerSalario: true, podeEditarSalario: true };

  it("editar RH não dá acesso a lotes de salário", () => {
    expect(podeVerLote("vt", soRh)).toBe(true);
    expect(podeEditarLote("vt", soRh)).toBe(true);
    expect(podeVerLote("salario", soRh)).toBe(false);
    expect(podeEditarLote("salario", soRh)).toBe(false);
  });

  it("rh_salario controla os lotes de salário, sem afetar VT", () => {
    expect(podeVerLote("salario", veSalario)).toBe(true);
    expect(podeEditarLote("salario", veSalario)).toBe(false);
    expect(podeEditarLote("salario", editaSalario)).toBe(true);
    expect(podeEditarLote("vt", editaSalario)).toBe(false);
  });
});

describe("contagemQuitados", () => {
  it("conta pagos e marca quitado só com todos pagos", () => {
    expect(contagemQuitados([{ is_paid: true }, { is_paid: false }])).toEqual({
      pagos: 1,
      total: 2,
      quitado: false,
    });
    expect(contagemQuitados([{ is_paid: true }, { is_paid: true }]).quitado).toBe(true);
    expect(contagemQuitados([]).quitado).toBe(false);
  });
});

// ── Lote de Salário em três blocos ─────────────────────────────────────────
import { blocosDaFolhaSalva, loteComValoresMensais, tipoPessoaLote } from "./rh-folhas";
import { montarLoteFolha, type LinhaResumo } from "./folha-pagamento";
import { itensValorMensal, type ValorMensalRegistro } from "./rh-salario";

describe("lote com Terceirizados e Extras", () => {
  const vmReg = (
    tipo: "terceirizado" | "extra",
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
  const valores = [
    vmReg("terceirizado", "t1", "2026-01", 700.15),
    vmReg("terceirizado", "t2", "2026-01", 0),
    vmReg("extra", "e1", "2026-02", 250.1),
    vmReg("extra", "e2", "2026-02", 120),
  ];
  const outros = [
    ...itensValorMensal(
      [
        { id: "t1", nome: "TERCEIRO TESTE" },
        { id: "t2", nome: "Zerado" },
        { id: "t3", nome: "Sem Valor" },
      ],
      valores,
      "terceirizado",
      "2026-08",
    ),
    ...itensValorMensal(
      [
        { id: "e2", nome: "extra b" },
        { id: "e1", nome: "extra a" },
        { id: "e3", nome: "Inativo", ativo: false },
      ],
      [...valores, vmReg("extra", "e3", "2026-01", 99)],
      "extra",
      "2026-08",
    ),
  ];
  const somaCentavos = (ns: number[]) => ns.reduce((acc, n) => acc + Math.round(n * 100), 0);

  it("sem Extrato Mensal (salário manual): total = soma dos itens dos três tipos", () => {
    const efetivos = montarFolhaSalario(funcs, regs, "2026-08");
    const lote = loteComValoresMensais(efetivos.itens, outros);
    expect(
      lote.itens.map((i) => [i.tipo_pessoa, i.employee_id, i.pessoa_id, i.employee_name]),
    ).toEqual([
      ["efetivo", "a", null, "Ana"],
      ["efetivo", "b", null, "Bruna"],
      ["terceirizado", null, "t1", "Terceiro Teste"],
      ["extra", null, "e1", "Extra A"],
      ["extra", null, "e2", "Extra B"],
    ]);
    expect(lote.subtotais).toEqual({ efetivo: 4500, terceirizado: 700.15, extra: 370.1 });
    expect(Math.round(lote.total * 100)).toBe(somaCentavos(lote.itens.map((i) => i.total_amount)));
    expect(lote.total).toBe(5570.25);
  });

  it("com Extrato Mensal: total = soma dos itens dos três tipos", () => {
    const linhas: LinhaResumo[] = [
      {
        chave: "1",
        funcionarioId: "f1",
        nome: "EFETIVO TESTE",
        status: "confirmado",
        bruto: 2000,
        liquido: 1800.33,
        restituicao: 10,
      },
      {
        chave: "2",
        funcionarioId: "f2",
        nome: "PENDENTE",
        status: "em_conferencia",
        bruto: 1000,
        liquido: 900,
        restituicao: 0,
      },
    ];
    const lote = loteComValoresMensais(montarLoteFolha(linhas).itens, outros);
    expect(lote.itens.map((i) => i.tipo_pessoa)).toEqual([
      "efetivo",
      "terceirizado",
      "extra",
      "extra",
    ]);
    expect(lote.subtotais.efetivo).toBe(1800.33);
    expect(Math.round(lote.total * 100)).toBe(somaCentavos(lote.itens.map((i) => i.total_amount)));
    expect(lote.total).toBe(2870.58);
  });

  it("valor zero, sem lançamento ou inativa não entram no lote", () => {
    const ids = outros.map((o) => o.pessoaId);
    expect(ids).toEqual(["t1", "e2", "e1"]);
  });
});

describe("blocosDaFolhaSalva", () => {
  it("folha antiga (itens sem tipo): tudo em Efetivos, com o mesmo total", () => {
    const itens = [
      { id: "1", total_amount: 1000.1 },
      { id: "2", total_amount: 2000.2, tipo_pessoa: null },
      { id: "3", total_amount: 0.3, tipo_pessoa: undefined },
    ];
    const r = blocosDaFolhaSalva(itens);
    expect(r.blocos.map((b) => [b.tipo, b.itens.map((i) => i.id), b.subtotal])).toEqual([
      ["efetivo", ["1", "2", "3"], 3000.6],
    ]);
    expect(r.total).toBe(3000.6);
  });

  it("folha nova: três blocos na ordem, subtotal por bloco e total", () => {
    const r = blocosDaFolhaSalva([
      { id: "x", total_amount: 100.1, tipo_pessoa: "extra" },
      { id: "e", total_amount: 1000, tipo_pessoa: "efetivo" },
      { id: "t", total_amount: 50.05, tipo_pessoa: "terceirizado" },
    ]);
    expect(r.blocos.map((b) => [b.tipo, b.subtotal])).toEqual([
      ["efetivo", 1000],
      ["terceirizado", 50.05],
      ["extra", 100.1],
    ]);
    expect(r.total).toBe(1150.15);
    expect(tipoPessoaLote("outro")).toBe("efetivo");
  });
});
