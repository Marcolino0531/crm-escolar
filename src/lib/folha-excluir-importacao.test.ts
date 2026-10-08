import { describe, expect, it } from "vitest";
import { planoExclusaoImportacao } from "./folha-pagamento";

// Dados fictícios.
type Reg = {
  id: string;
  importacaoId: string;
  tipo: "empregado" | "contribuinte";
  codigo: string;
  cpf: string;
  nome: string;
  situacao: string;
  funcionarioId: string | null;
  status: "em_conferencia" | "confirmado";
  proventos: number;
  descontos: number;
  liquido: number;
  rubricas: [];
  restituicaoGravada: number | null;
};

const reg = (over: Partial<Reg> & Pick<Reg, "id" | "codigo">): Reg => ({
  importacaoId: "impA",
  tipo: "empregado",
  cpf: "",
  nome: `PESSOA ${over.codigo}`,
  situacao: "Trabalhando",
  funcionarioId: null,
  status: "confirmado",
  proventos: 0,
  descontos: 0,
  liquido: 0,
  rubricas: [],
  restituicaoGravada: null,
  ...over,
});

describe("excluir a importação inteira de uma empresa", () => {
  const registros = [
    reg({
      id: "a1",
      codigo: "1",
      funcionarioId: "f1",
      proventos: 2000,
      descontos: 180.1,
      liquido: 1819.9,
    }),
    reg({
      id: "a2",
      codigo: "2",
      funcionarioId: "f2",
      proventos: 3000,
      descontos: 330,
      liquido: 2670,
    }),
    reg({
      id: "a3",
      codigo: "3",
      funcionarioId: "f3",
      proventos: 1000.05,
      descontos: 80,
      liquido: 920.05,
    }),
    reg({ id: "a4", codigo: "4", proventos: 500, descontos: 40, liquido: 460 }),
    reg({
      id: "b2",
      codigo: "7",
      importacaoId: "impB",
      funcionarioId: "f2",
      proventos: 1500.1,
      descontos: 200.05,
      liquido: 1300.05,
    }),
    reg({
      id: "b3",
      codigo: "8",
      importacaoId: "impB",
      funcionarioId: "f3",
      status: "em_conferencia",
      proventos: 700,
      descontos: 50,
      liquido: 650,
    }),
  ];
  const decisao = (salarios: ReturnType<typeof planoExclusaoImportacao>["salarios"], f: string) =>
    salarios.find((s) => s.funcionarioId === f);

  it("(5.1) funcionário só na importação excluída: salário da folha removido", () => {
    const { salarios } = planoExclusaoImportacao(registros, "impA");
    expect(decisao(salarios, "f1")).toEqual({ funcionarioId: "f1", acao: "remover" });
  });

  it("(5.2) restante Confirmado: recalculado só com o que ficou", () => {
    const { salarios } = planoExclusaoImportacao(registros, "impA");
    expect(decisao(salarios, "f2")).toEqual({
      funcionarioId: "f2",
      acao: "gravar",
      valor: 1500.1,
      valorLiquido: 1300.05,
    });
  });

  it("(5.3) restante Em conferência: salário da folha removido", () => {
    const { salarios } = planoExclusaoImportacao(registros, "impA");
    expect(decisao(salarios, "f3")).toEqual({ funcionarioId: "f3", acao: "remover" });
  });

  it("(5.4) salário manual do funcionário na competência não é tocado", () => {
    const { salarios } = planoExclusaoImportacao(registros, "impA", new Set(["f1", "f2"]));
    expect(salarios.map((s) => s.funcionarioId)).toEqual(["f3"]);
  });

  it("(5.5) totais do registro = soma dos registros apagados; a outra empresa não entra", () => {
    const { totais, salarios } = planoExclusaoImportacao(registros, "impA");
    expect(totais).toEqual({
      colaboradores: 4,
      proventos: 6500.05,
      descontos: 630.1,
      liquido: 5869.95,
    });
    expect(salarios).toHaveLength(3);
    expect(planoExclusaoImportacao(registros, "impB").totais).toEqual({
      colaboradores: 2,
      proventos: 2200.1,
      descontos: 250.05,
      liquido: 1950.05,
    });
  });
});
