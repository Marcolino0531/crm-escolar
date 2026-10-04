import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chaveColaborador,
  chavesExcluidas,
  montarLoteFolha,
  planejarReimportacao,
  registroExcluido,
  restituicoesDaCompetencia,
  restituicoesPorPessoa,
  resumoDaFolha,
  salarioAposExclusao,
  semDescartados,
  totaisDasEmpresas,
  totaisResumo,
  type ExclusaoFolha,
} from "./folha-pagamento";
import type { RubricaFolha } from "./folha-pagamento";

// Dados fictícios.
const CNPJ_A = "11.222.333/0001-81";
const CNPJ_B = "11.444.777/0001-61";
const COMP = "2026-09";
const PROX = "2026-10";

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
  rubricas: RubricaFolha[];
  restituicaoGravada: number | null;
};

const inss = (valor: number): RubricaFolha[] => [
  { tipo: "D", codigo: "998", descricao: "INSS", valor },
];

const reg = (over: Partial<Reg> & Pick<Reg, "id" | "codigo">): Reg => ({
  importacaoId: "impA",
  tipo: "empregado",
  cpf: "",
  nome: `PESSOA ${over.codigo}`,
  situacao: "Trabalhando",
  funcionarioId: null,
  status: "confirmado",
  proventos: 1000,
  descontos: 100,
  liquido: 900,
  rubricas: inss(100),
  restituicaoGravada: null,
  ...over,
});

/** Simula a exclusão: o servidor apaga o registro; as telas recalculam com o que ficou. */
const excluir = (registros: readonly Reg[], id: string) => registros.filter((r) => r.id !== id);

const telas = (registros: readonly Reg[], marcados: ReadonlySet<string>) => {
  const rest = restituicoesDaCompetencia(registros, marcados, false);
  const porId = new Map(rest.linhas.map((l) => [l.id, l.restituicao]));
  const resumo = resumoDaFolha(registros, porId);
  return {
    folha: totaisDasEmpresas(registros),
    restituicao: rest.total,
    restituicaoPessoas: restituicoesPorPessoa(registros, rest.linhas),
    resumo: totaisResumo(resumo),
    lote: montarLoteFolha(resumo),
  };
};

describe("exclusão de colaborador da folha", () => {
  const regs = [
    reg({ id: "r1", codigo: "1", funcionarioId: "f1", cpf: "90000000191" }),
    reg({
      id: "r2",
      codigo: "2",
      funcionarioId: "f2",
      cpf: "90000000272",
      proventos: 3000.5,
      descontos: 400.25,
      liquido: 2600.25,
      rubricas: inss(300.1),
    }),
    reg({ id: "r3", codigo: "3", funcionarioId: "f3", importacaoId: "impB" }),
  ];

  it("(4.1) totais da Folha, Resumo, Restituição e lote não têm os valores do excluído", () => {
    const marcados = new Set(["f1", "f2", "f3"]);
    const antes = telas(regs, marcados);
    expect(antes.folha).toEqual({
      proventos: 5000.5,
      descontos: 600.25,
      liquido: 4400.25,
      colaboradores: 3,
    });
    const depois = telas(excluir(regs, "r2"), marcados);
    expect(depois.folha).toEqual({
      proventos: 2000,
      descontos: 200,
      liquido: 1800,
      colaboradores: 2,
    });
    expect(depois.restituicao).toBe(200);
    expect(depois.restituicaoPessoas.map((p) => p.funcionarioId)).toEqual(["f1", "f3"]);
    expect(depois.resumo).toEqual({ bruto: 2000, liquido: 1800, restituicao: 200 });
    expect(depois.lote.total).toBe(1800);
    expect(depois.lote.itens.map((i) => i.employee_id)).toEqual(["f1", "f3"]);
    // Totais de uma empresa: só os registros dela que ficaram.
    expect(totaisDasEmpresas(excluir(regs, "r2").filter((r) => r.importacaoId === "impA"))).toEqual(
      { proventos: 1000, descontos: 100, liquido: 900, colaboradores: 1 },
    );
  });

  it("(4.2) pessoa com dois contratos e um excluído soma só o outro", () => {
    const dois = [
      reg({ id: "c1", codigo: "22", funcionarioId: "f9", proventos: 3000, liquido: 2670 }),
      reg({
        id: "c2",
        codigo: "57",
        funcionarioId: "f9",
        importacaoId: "impB",
        proventos: 1500.1,
        liquido: 1300.05,
      }),
    ];
    const resumo = resumoDaFolha(excluir(dois, "c2"), new Map());
    expect(resumo).toHaveLength(1);
    expect(resumo[0]).toMatchObject({
      funcionarioId: "f9",
      bruto: 3000,
      liquido: 2670,
      contratos: 1,
    });
    expect(salarioAposExclusao(excluir(dois, "c2"), "f9")).toEqual({
      acao: "gravar",
      valor: 3000,
      valorLiquido: 2670,
    });
  });

  it("(4.3) excluir depois de confirmar recalcula ou remove funcionarios_salarios", () => {
    const dois = [
      reg({ id: "c1", codigo: "22", funcionarioId: "f9", proventos: 3000, liquido: 2670 }),
      reg({ id: "c2", codigo: "57", funcionarioId: "f9", proventos: 1500.1, liquido: 1300.05 }),
    ];
    expect(salarioAposExclusao(dois, "f9")).toEqual({
      acao: "gravar",
      valor: 4500.1,
      valorLiquido: 3970.05,
    });
    expect(salarioAposExclusao(excluir(dois, "c1"), "f9")).toEqual({
      acao: "gravar",
      valor: 1500.1,
      valorLiquido: 1300.05,
    });
    expect(salarioAposExclusao(excluir(excluir(dois, "c1"), "c2"), "f9")).toEqual({
      acao: "remover",
    });
    // O que ficou ainda está Em conferência: a linha antiga (com o excluído) sai.
    const pendente = [{ ...dois[0], status: "em_conferencia" as const }, dois[1]];
    expect(salarioAposExclusao(excluir(pendente, "c2"), "f9")).toEqual({ acao: "remover" });
  });

  it("(4.4) reimportar a competência não traz o registro excluído de volta", () => {
    const exclusoes: ExclusaoFolha[] = [
      {
        fixa: false,
        competencia: COMP,
        cnpj: CNPJ_A,
        tipo: "empregado",
        codigo: "2",
        cpf: "90000000272",
      },
    ];
    const gravados = excluir(regs, "r2")
      .filter((r) => r.importacaoId === "impA")
      .map((r) => ({ ...r, ajustadoManualmente: false }));
    const pdf = regs.filter((r) => r.importacaoId === "impA");
    const descartar = chavesExcluidas(pdf, exclusoes, { competencia: COMP, cnpj: CNPJ_A });
    expect(descartar).toEqual(["empregado:2"]);
    const plano = planejarReimportacao(gravados, semDescartados(pdf, descartar));
    expect(plano.novos).toEqual([]);
    expect(plano.iguais.map(chaveColaborador)).toEqual(["empregado:1"]);
    // Só nesta empresa e nesta competência.
    expect(chavesExcluidas(pdf, exclusoes, { competencia: COMP, cnpj: CNPJ_B })).toEqual([]);
    expect(chavesExcluidas(pdf, exclusoes, { competencia: PROX, cnpj: CNPJ_A })).toEqual([]);
    // Desfeita a exclusão (linha apagada), volta na próxima reimportação.
    expect(chavesExcluidas(pdf, [], { competencia: COMP, cnpj: CNPJ_A })).toEqual([]);
  });

  it("(4.5) exclusão fixa: a importação seguinte grava sem o registro e com totais reduzidos", () => {
    const fixas: ExclusaoFolha[] = [
      {
        fixa: true,
        competencia: null,
        cnpj: CNPJ_A,
        tipo: "empregado",
        codigo: "2",
        cpf: "90000000272",
      },
      { fixa: true, competencia: null, cnpj: CNPJ_B, tipo: "contribuinte", codigo: "8", cpf: "" },
    ];
    const proxima = [
      ...regs.map((r) => ({ ...r, id: `n${r.id}` })),
      // Mesmo CPF com outro código e em outra empresa: também fica de fora.
      reg({ id: "n4", codigo: "40", cpf: "900.000.002-72", importacaoId: "impB", proventos: 50 }),
      reg({ id: "n5", codigo: "8", tipo: "contribuinte", importacaoId: "impB", proventos: 70 }),
      reg({ id: "n6", codigo: "8", tipo: "empregado", importacaoId: "impB" }),
    ];
    const gravar = (cnpj: string, imp: string) => {
      const pdf = proxima.filter((r) => r.importacaoId === imp);
      return semDescartados(pdf, chavesExcluidas(pdf, fixas, { competencia: PROX, cnpj }));
    };
    const gravadosA = gravar(CNPJ_A, "impA");
    const gravadosB = gravar(CNPJ_B, "impB");
    expect(gravadosA.map((r) => r.codigo)).toEqual(["1"]);
    expect(gravadosB.map(chaveColaborador)).toEqual(["empregado:3", "empregado:8"]);
    expect(totaisDasEmpresas([...gravadosA, ...gravadosB])).toEqual({
      proventos: 3000,
      descontos: 300,
      liquido: 2700,
      colaboradores: 3,
    });
    expect(
      registroExcluido({ tipo: "contribuinte", codigo: "8", cpf: "" }, fixas, {
        competencia: PROX,
        cnpj: CNPJ_A,
      }),
    ).toBe(false);
  });
});

describe("(4.6) usuário que não é admin não recebe registros excluídos", () => {
  const fonte = readFileSync("src/lib/rh-folha.functions.ts", "utf8");
  const blocos = fonte.split(/\nexport const /).slice(1);
  const fn = (nome: string) => {
    const b = blocos.find((x) => x.startsWith(`${nome} =`));
    if (!b) throw new Error(`server function ${nome} não encontrada`);
    return b;
  };
  const nomes = blocos.map((b) => b.slice(0, b.indexOf(" ")));

  it("excluir, listar e desfazer exigem administrador", () => {
    for (const n of ["excluirColaboradorFolha", "listarExclusoesFolha", "desfazerExclusaoFolha"]) {
      expect(fn(n)).toContain("await exigirAdminFolha(context.userId)");
    }
  });

  it("nenhuma outra server function devolve a lista de exclusões", () => {
    const admin = new Set(["listarExclusoesFolha", "desfazerExclusaoFolha"]);
    for (const n of nomes.filter((x) => !admin.has(x))) {
      expect(fn(n), n).not.toContain("paraExclusaoListada");
      expect(fn(n), n).not.toContain("rh_folha_exclusoes");
    }
  });

  it("preparar devolve só as chaves a descartar e gravar reaplica no servidor", () => {
    expect(fn("prepararImportacaoFolha")).toContain(
      "descartar: chavesExcluidas(data.identidades, exclusoes, data)",
    );
    const gravar = fn("gravarImportacaoFolha");
    expect(gravar.indexOf("revalidarFolha(")).toBeGreaterThan(-1);
    expect(gravar.indexOf("chavesExcluidas(folha.colaboradores")).toBeGreaterThan(
      gravar.indexOf("revalidarFolha("),
    );
    expect(gravar).toContain("planejarReimportacao(gravados.map(original), colaboradores)");
  });

  it("os totais do PDF não vão para o navegador", () => {
    const tipo = fonte.slice(
      fonte.indexOf("export type ImportacaoFolha"),
      fonte.indexOf("};", fonte.indexOf("export type ImportacaoFolha")),
    );
    for (const campo of [
      "totalProventos",
      "totalDescontos",
      "liquidoGeral",
      "totalColaboradores",
    ]) {
      expect(tipo).not.toContain(campo);
    }
  });

  it("na tela, ações e lista de excluídos só para admin", () => {
    const tela = readFileSync("src/components/crm/FolhaPagamentoRH.tsx", "utf8");
    expect(tela).toContain("{isAdmin && excluindo && (");
    expect(tela).toContain("{isAdmin && verExcluidos && (");
    expect(tela).toContain("{isAdmin && !fechada && (");
  });
});
