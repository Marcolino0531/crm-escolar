import { describe, expect, it } from "vitest";
import itensFixture from "./__fixtures__/extrato-mensal-ficticio.itens.json";
import esperado from "./__fixtures__/extrato-mensal-ficticio.esperado.json";
import {
  ErroExtratoMensal,
  centavosBR,
  conferirIntegridade,
  importarExtratoMensal,
  inssDoColaborador,
  lerExtratoMensal,
  paraCentavos,
  somaReais,
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
