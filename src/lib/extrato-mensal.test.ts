import { describe, expect, it } from "vitest";
import itensFixture from "./__fixtures__/extrato-mensal-ficticio.itens.json";
import esperado from "./__fixtures__/extrato-mensal-ficticio.esperado.json";
import itensSecoes from "./__fixtures__/extrato-mensal-secoes-ficticio.itens.json";
import esperadoSecoes from "./__fixtures__/extrato-mensal-secoes-ficticio.esperado.json";
import itensContratos from "./__fixtures__/extrato-mensal-contratos-ficticio.itens.json";
import esperadoContratos from "./__fixtures__/extrato-mensal-contratos-ficticio.esperado.json";
import itensComplemento from "./__fixtures__/extrato-mensal-complemento-ficticio.itens.json";
import esperadoComplemento from "./__fixtures__/extrato-mensal-complemento-ficticio.esperado.json";
import {
  agruparPorPessoa,
  registrosPorCpf,
  restituicoesDaCompetencia,
  restituicoesPorPessoa,
  salariosDaFolha,
} from "./folha-pagamento";
import {
  ErroExtratoMensal,
  calculosDoCabecalho,
  centavosBR,
  codigoRepetido,
  conferirIntegridade,
  importarExtratoMensal,
  inssDoColaborador,
  lerExtratoMensal,
  paraCentavos,
  somaReais,
  somenteDigitos,
  type ItemTexto,
  type PaginaItens,
} from "./extrato-mensal";

const paginas = itensFixture as PaginaItens[];
const clonar = (): PaginaItens[] => JSON.parse(JSON.stringify(itensFixture)) as PaginaItens[];

describe("leitura do Extrato Mensal (fixture fictício)", () => {
  const folha = importarExtratoMensal(paginas);

  it("cabeçalho, competência e totais gerais", () => {
    expect(folha.empresa).toBe(esperado.empresa);
    expect(folha.cnpj).toBe(esperado.cnpj);
    expect(folha.calculo).toBe("Folha Mensal");
    expect(folha.competencia).toBe(esperado.competencia);
    expect(folha.totalProventos).toBe(172388.65);
    expect(folha.totalDescontos).toBe(37764.33);
    expect(folha.liquidoGeral).toBe(134624.32);
  });

  it("42 colaboradores: 41 empregados e 1 contribuinte", () => {
    expect(folha.colaboradores).toHaveLength(42);
    expect(folha.colaboradores.filter((c) => c.tipo === "empregado")).toHaveLength(41);
    expect(folha.colaboradores.filter((c) => c.tipo === "contribuinte")).toHaveLength(1);
  });

  it("cada colaborador igual ao esperado (rubricas, totais e INSS)", () => {
    for (const e of esperado.colaboradores) {
      const c = folha.colaboradores.find((x) => x.codigo === e.codigo);
      expect(c, e.codigo).toBeDefined();
      if (!c) continue;
      expect(c.nome).toBe(e.nome);
      expect(c.tipo).toBe(e.tipo);
      expect(c.cpf).toBe(e.cpf);
      expect(c.situacao).toBe(e.situacao);
      expect(paraCentavos(c.salarioBase)).toBe(paraCentavos(e.salario_base));
      expect(paraCentavos(c.proventos)).toBe(paraCentavos(e.proventos));
      expect(paraCentavos(c.descontos)).toBe(paraCentavos(e.descontos));
      expect(paraCentavos(c.liquido)).toBe(paraCentavos(e.liquido));
      expect(paraCentavos(inssDoColaborador(c))).toBe(paraCentavos(e.inss));
      const ordenar = (rs: readonly { tipo: string; codigo: string; valor: number }[]) =>
        rs.map((r) => `${r.tipo}:${r.codigo}:${paraCentavos(r.valor)}`).sort();
      expect(ordenar(c.rubricas)).toEqual(ordenar(e.rubricas));
    }
  });

  it("INSS código 998 total = 14.960,11", () => {
    expect(somaReais(folha.colaboradores.map(inssDoColaborador))).toBe(14960.11);
    expect(esperado.total_inss_998).toBe(14960.11);
  });

  it("números brasileiros com/sem milhar e negativos", () => {
    expect(centavosBR("1.081,13")).toBe(108113);
    expect(centavosBR("1081,13")).toBe(108113);
    expect(centavosBR("-12,50")).toBe(-1250);
    expect(centavosBR("0")).toBe(0);
    expect(centavosBR("18:00")).toBeNull();
  });
});

describe("integridade", () => {
  it("valor alterado em memória: recusa apontando o colaborador", () => {
    const folha = lerExtratoMensal(paginas);
    const alvo = folha.colaboradores[0];
    const alterada = {
      ...folha,
      colaboradores: folha.colaboradores.map((c, i) =>
        i === 0
          ? {
              ...c,
              rubricas: c.rubricas.map((r, j) => (j === 0 ? { ...r, valor: r.valor + 0.01 } : r)),
            }
          : c,
      ),
    };
    const erros = conferirIntegridade(alterada);
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0]).toContain(alvo.nome);
    expect(erros[0]).toContain("0,01");
  });

  it("item do PDF alterado: importarExtratoMensal lança e nada é importado", () => {
    const pags = clonar();
    const alvo = lerExtratoMensal(pags).colaboradores[0];
    // Provento "8066 DSR PROFESSOR AULISTA" (566,03) do 1º colaborador, metade esquerda.
    const item = pags[0].itens.find((i) => i.str === "566,03" && i.x < 290);
    expect(item).toBeDefined();
    if (item) item.str = "566,04";
    expect(() => importarExtratoMensal(pags)).toThrow(ErroExtratoMensal);
    try {
      importarExtratoMensal(pags);
    } catch (e) {
      expect((e as Error).message).toContain("nada foi importado");
      expect((e as Error).message).toContain(alvo.nome);
    }
  });

  it("total geral diferente da soma: recusa no total", () => {
    const folha = lerExtratoMensal(paginas);
    const erros = conferirIntegridade({ ...folha, liquidoGeral: folha.liquidoGeral + 0.01 });
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("Líquido Geral");
  });

  it("outro cálculo (13º, férias) é recusado", () => {
    const pags = clonar();
    for (const p of pags)
      for (const i of p.itens)
        if (i.str.includes("Folha Mensal"))
          i.str = i.str.replace("Folha Mensal", "13º Salário Integral");
    expect(() => lerExtratoMensal(pags)).toThrow(/Folha Mensal/);
  });
});

describe("vários cálculos e seções", () => {
  const LISTA = "Folha Mensal, Resilição Professor e Complementar";
  const item = (str: string, x: number, y: number) => ({ str, x, y });
  type PaginaEditavel = { pagina: number; itens: ItemTexto[] };
  const comLista = (): PaginaEditavel[] => {
    const pags = clonar() as PaginaEditavel[];
    for (const p of pags) for (const i of p.itens) if (i.str === "Folha Mensal") i.str = LISTA;
    pags[0].itens.push(
      item("Complemento de cálculo:", 0, 785.64),
      item("Normal", 104.64, 785.64),
      item("Folha Mensal", 245.04, 750.2),
    );
    return pags;
  };

  it('lista do Cálculo separada por vírgula e por "e"', () => {
    expect(calculosDoCabecalho(LISTA)).toEqual([
      "Folha Mensal",
      "Resilição Professor",
      "Complementar",
    ]);
    expect(calculosDoCabecalho("Folha Mensal")).toEqual(["Folha Mensal"]);
  });

  it("seções com título, complemento de cálculo e seções vazias depois dos totais", () => {
    const pags = comLista();
    const ultima = pags[pags.length - 1];
    ultima.itens.push(
      item("Resilição Professor", 245.04, 620.1),
      item("Complementar", 245.04, 610.1),
      item("INSS", 0, 66.1),
      item("FGTS, PIS e ISS", 0, 62.1),
      item("IRRF conforme competência de pagamento", 0, 58.1),
    );
    const folha = importarExtratoMensal(pags);
    expect(folha.calculo).toBe("Folha Mensal");
    expect(folha.calculoOriginal).toBe(LISTA);
    expect(folha.colaboradores).toHaveLength(42);
    expect(folha.liquidoGeral).toBe(134624.32);
    expect(conferirIntegridade(folha)).toEqual([]);
  });

  it("formato antigo (sem título) guarda o cálculo original", () => {
    const folha = lerExtratoMensal(paginas);
    expect(folha.calculoOriginal).toBe("Folha Mensal");
  });

  it("colaborador em seção não suportada é recusado", () => {
    const pags = comLista();
    pags[pags.length - 1].itens.push(item("Complementar", 245.04, 755.5));
    expect(() => lerExtratoMensal(pags)).toThrow(/seção "Complementar".*não é suportada/);
  });

  it("colaborador em seção aberta depois dos totais também é recusado", () => {
    const pags = comLista();
    const ultima = pags[pags.length - 1];
    const bloco = ultima.itens
      .filter((i) => i.y > 670 && i.y < 752)
      .map((i) => ({
        ...i,
        y: i.y - 380,
        str: i.str === "42 FABIANA RESENDE DOS JARDIM" ? "43 OUTRA PESSOA" : i.str,
      }));
    ultima.itens.push(item("Complementar", 245.04, 380.1), ...bloco);
    expect(() => lerExtratoMensal(pags)).toThrow(/seção "Complementar".*não é suportada/);
  });

  it("lista sem Folha Mensal é recusada", () => {
    const pags = clonar();
    for (const p of pags)
      for (const i of p.itens) if (i.str === "Folha Mensal") i.str = "Complementar e Férias";
    expect(() => lerExtratoMensal(pags)).toThrow(/Folha Mensal/);
  });

  it("outra linha fora de colaborador continua sendo erro", () => {
    const pags = comLista();
    pags[0].itens.push(item("Texto qualquer", 245.04, 745.0));
    expect(() => lerExtratoMensal(pags)).toThrow(/fora de um colaborador/);
  });

  it("mesmo código como empregado e contribuinte é recusado", () => {
    expect(
      codigoRepetido([
        { tipo: "empregado", codigo: "22" },
        { tipo: "contribuinte", codigo: "22" },
      ]),
    ).toMatch(/empregado e como contribuinte/);
    expect(
      codigoRepetido([
        { tipo: "empregado", codigo: "22" },
        { tipo: "empregado", codigo: "23" },
      ]),
    ).toBeNull();
  });
});

type Esperado = {
  empresa: string;
  cnpj: string;
  calculo: string;
  calculo_cabecalho: string;
  competencia: string;
  total_colaboradores: number;
  total_proventos: number;
  total_descontos: number;
  liquido_geral: number;
  total_inss_998: number;
  colaboradores: {
    codigo: string;
    nome: string;
    tipo: string;
    situacao: string;
    cpf: string;
    salario_base: number;
    proventos: number;
    descontos: number;
    liquido: number;
    inss: number;
    rubricas: { tipo: string; codigo: string; valor: number }[];
  }[];
};

describe.each([
  ["seções", itensSecoes, esperadoSecoes],
  ["contratos", itensContratos, esperadoContratos],
  ["complemento de cálculo", itensComplemento, esperadoComplemento],
] as [string, unknown, Esperado][])("fixture fictício: %s", (_nome, itens, esp) => {
  const folha = importarExtratoMensal(itens as PaginaItens[]);

  it("cabeçalho, cálculo original e totais gerais", () => {
    expect(folha.empresa).toBe(esp.empresa);
    expect(folha.cnpj).toBe(esp.cnpj);
    expect(folha.calculo).toBe("Folha Mensal");
    expect(folha.calculo).toBe(esp.calculo);
    expect(folha.calculoOriginal).toBe(esp.calculo_cabecalho);
    expect(folha.competencia).toBe(esp.competencia);
    expect(folha.totalProventos).toBe(esp.total_proventos);
    expect(folha.totalDescontos).toBe(esp.total_descontos);
    expect(folha.liquidoGeral).toBe(esp.liquido_geral);
    expect(folha.colaboradores).toHaveLength(esp.total_colaboradores);
    expect(somaReais(folha.colaboradores.map(inssDoColaborador))).toBe(esp.total_inss_998);
    expect(conferirIntegridade(folha)).toEqual([]);
  });

  it("cada colaborador igual ao esperado", () => {
    expect(folha.colaboradores.map((c) => `${c.tipo}:${c.codigo}`).sort()).toEqual(
      esp.colaboradores.map((e) => `${e.tipo}:${e.codigo}`).sort(),
    );
    for (const e of esp.colaboradores) {
      const c = folha.colaboradores.find((x) => x.codigo === e.codigo && x.tipo === e.tipo);
      expect(c, e.codigo).toBeDefined();
      if (!c) continue;
      expect(c.nome).toBe(e.nome);
      expect(c.cpf).toBe(e.cpf);
      expect(c.situacao).toBe(e.situacao);
      expect(paraCentavos(c.salarioBase)).toBe(paraCentavos(e.salario_base));
      expect(paraCentavos(c.proventos)).toBe(paraCentavos(e.proventos));
      expect(paraCentavos(c.descontos)).toBe(paraCentavos(e.descontos));
      expect(paraCentavos(c.liquido)).toBe(paraCentavos(e.liquido));
      expect(paraCentavos(inssDoColaborador(c))).toBe(paraCentavos(e.inss));
      const ordenar = (rs: readonly { tipo: string; codigo: string; valor: number }[]) =>
        rs.map((r) => `${r.tipo}:${r.codigo}:${paraCentavos(r.valor)}`).sort();
      expect(ordenar(c.rubricas)).toEqual(ordenar(e.rubricas));
    }
  });
});

describe("fixture fictício de contratos: agregação por pessoa", () => {
  const esp = esperadoContratos as unknown as {
    pessoas_distintas: number;
    pessoas_com_mais_de_um_contrato: number;
    pessoas: {
      cpf: string;
      codigos: string[];
      proventos: number;
      liquido: number;
      inss: number;
    }[];
  };
  const folha = importarExtratoMensal(itensContratos as PaginaItens[]);
  // Simula o vínculo ao RH pelo CPF: todos os contratos da pessoa no mesmo funcionário.
  const registros = folha.colaboradores.map((c) => ({
    ...c,
    id: `${c.tipo}:${c.codigo}`,
    funcionarioId: `f-${somenteDigitos(c.cpf)}`,
    status: "confirmado" as const,
    restituicaoGravada: null,
  }));

  it("pessoas distintas e com mais de um contrato", () => {
    expect(agruparPorPessoa(registros)).toHaveLength(esp.pessoas_distintas);
    const multiplos = [...registrosPorCpf(registros).values()].filter((n) => n > 1);
    expect(multiplos).toHaveLength(esp.pessoas_com_mais_de_um_contrato);
  });

  it("salário, líquido e INSS 998 somados por pessoa", () => {
    const salarios = new Map(salariosDaFolha(registros).map((s) => [s.funcionarioId, s]));
    const marcados = new Set(registros.map((r) => r.funcionarioId));
    const rest = restituicoesDaCompetencia(registros, marcados, false);
    const inss = new Map(
      restituicoesPorPessoa(registros, rest.linhas).map((l) => [l.funcionarioId, l]),
    );
    expect(salarios.size).toBe(esp.pessoas_distintas);
    for (const p of esp.pessoas) {
      const f = `f-${somenteDigitos(p.cpf)}`;
      expect(paraCentavos(salarios.get(f)?.valor ?? -1), p.cpf).toBe(paraCentavos(p.proventos));
      expect(paraCentavos(salarios.get(f)?.valorLiquido ?? -1), p.cpf).toBe(
        paraCentavos(p.liquido),
      );
      expect(paraCentavos(inss.get(f)?.inss ?? -1), p.cpf).toBe(paraCentavos(p.inss));
      expect(inss.get(f)?.contratos).toBe(p.codigos.length);
    }
  });
});
