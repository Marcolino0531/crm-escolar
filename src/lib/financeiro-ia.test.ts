import { describe, it, expect } from "vitest";
import {
  compararRecorrentes,
  executarFerramenta,
  FERRAMENTAS_ANALISE,
  NOMES_FERRAMENTAS,
  resolverUnidades,
  validarChamadaFerramenta,
  type ChamadaFerramenta,
  type DespesaFluxo,
  type EscopoAnalise,
  type FiltroPeriodo,
  type FonteDadosFinanceiros,
  type InadimplenciaAgregada,
  type ReceitaPrevista,
  type ReceitaRealizada,
  type SerieRecorrente,
} from "@/lib/financeiro-ia";

const escopo: EscopoAnalise = {
  unidadesPermitidas: ["CEC", "CEC Baby"],
  hoje: "2026-08-20",
};

function despesa(over: Partial<DespesaFluxo>): DespesaFluxo {
  return {
    unidade: "CEC",
    mes: "2026-08-01",
    descricao: "Energia elétrica",
    categoria: "Infraestrutura",
    subcategoria: "Energia",
    valor: 1000,
    status: "pending",
    recorrente: false,
    ...over,
  };
}

// Dublê da fonte real: guarda os filtros recebidos (para provar que a ferramenta
// repassa unidade/categoria/subcategoria/intervalo) e devolve dados fixos.
function fonteFake(dados: {
  despesas?: DespesaFluxo[];
  receitasRealizadas?: ReceitaRealizada[];
  receitasPrevistas?: ReceitaPrevista[];
  series?: SerieRecorrente[];
  inadimplencia?: InadimplenciaAgregada[];
}) {
  const chamadas: { fn: string; filtro: unknown }[] = [];
  const aplicaFiltros = (linhas: DespesaFluxo[], f: FiltroPeriodo) =>
    linhas.filter(
      (d) =>
        f.unidades.includes(d.unidade) &&
        d.mes >= f.dataInicio.slice(0, 7) + "-01" &&
        d.mes <= f.dataFim &&
        (!f.categoria || d.categoria === f.categoria) &&
        (!f.subcategoria || d.subcategoria === f.subcategoria),
    );
  const fonte: FonteDadosFinanceiros = {
    async despesasFluxo(filtro) {
      chamadas.push({ fn: "despesasFluxo", filtro });
      return aplicaFiltros(dados.despesas ?? [], filtro);
    },
    async receitasRealizadas(filtro) {
      chamadas.push({ fn: "receitasRealizadas", filtro });
      return (dados.receitasRealizadas ?? []).filter(
        (r) =>
          filtro.unidades.includes(r.unidade) &&
          r.data >= filtro.dataInicio &&
          r.data <= filtro.dataFim &&
          (!filtro.categoria || r.categoria === filtro.categoria) &&
          (!filtro.subcategoria || r.subcategoria === filtro.subcategoria),
      );
    },
    async receitasPrevistas(filtro) {
      chamadas.push({ fn: "receitasPrevistas", filtro });
      return (dados.receitasPrevistas ?? []).filter((r) => filtro.unidades.includes(r.unidade));
    },
    async seriesRecorrentes(filtro) {
      chamadas.push({ fn: "seriesRecorrentes", filtro });
      return (dados.series ?? []).filter((s) => filtro.unidades.includes(s.unidade));
    },
    async inadimplencia(filtro) {
      chamadas.push({ fn: "inadimplencia", filtro });
      return (dados.inadimplencia ?? []).filter((l) => filtro.unidades.includes(l.unidade));
    },
  };
  return { fonte, chamadas };
}

async function roda(nome: string, args: unknown, fonte: FonteDadosFinanceiros) {
  const v = validarChamadaFerramenta(nome, args);
  if (!v.ok) throw new Error(`validação falhou: ${v.erro}`);
  return executarFerramenta(v.chamada, fonte, escopo);
}

describe("lista fechada de ferramentas", () => {
  it("expõe exatamente as cinco consultas permitidas", () => {
    expect([...NOMES_FERRAMENTAS]).toEqual([
      "buscar_despesas_fluxo_futuro",
      "buscar_receitas",
      "comparar_despesas_recorrentes",
      "buscar_inadimplencia",
      "calcular_saldo_projetado",
    ]);
    expect(FERRAMENTAS_ANALISE).toHaveLength(5);
    expect(FERRAMENTAS_ANALISE.map((f) => f.nome)).toEqual([...NOMES_FERRAMENTAS]);
  });

  it("nenhuma ferramenta aceita SQL, código ou propriedade extra", () => {
    for (const f of FERRAMENTAS_ANALISE) {
      const props = Object.keys(f.schemaJson.properties as Record<string, unknown>);
      expect(f.schemaJson.additionalProperties).toBe(false);
      expect(props.some((p) => /sql|query|consulta|codigo|script|tabela/i.test(p))).toBe(false);
    }
    expect(JSON.stringify(FERRAMENTAS_ANALISE).toLowerCase()).not.toContain("select ");
  });

  it("rejeita ferramenta desconhecida (não pode ser injetada pelo modelo)", () => {
    for (const nome of [
      "executar_sql",
      "sql",
      "buscar_alunos",
      "buscar_despesas_fluxo_futuro ",
      "BUSCAR_RECEITAS",
      "",
    ]) {
      const v = validarChamadaFerramenta(nome, { dataInicio: "2026-08-01", dataFim: "2026-08-31" });
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.erro).toContain("não existe");
    }
  });

  it("rejeita SQL livre passado como argumento de uma ferramenta válida", () => {
    const v = validarChamadaFerramenta("buscar_despesas_fluxo_futuro", {
      dataInicio: "2026-08-01",
      dataFim: "2026-08-31",
      sql: "select * from students",
    });
    expect(v.ok).toBe(false);
  });

  it("rejeita argumentos extras, faltando ou com tipo/formato errado", () => {
    const casos: unknown[] = [
      { dataInicio: "2026-08-01", dataFim: "2026-08-31", limite: 999 },
      { dataInicio: "2026-08-01" },
      { dataInicio: "01/08/2026", dataFim: "31/08/2026" },
      { dataInicio: "2026-08-01", dataFim: "2026-08-31", situacao: "canceladas" },
      { dataInicio: "2026-08-31", dataFim: "2026-08-01" },
      "select 1",
    ];
    for (const args of casos) {
      expect(validarChamadaFerramenta("buscar_despesas_fluxo_futuro", args).ok).toBe(false);
    }
  });

  it("aceita apenas janelas dentro do limite de cada consulta", () => {
    expect(
      validarChamadaFerramenta("buscar_receitas", {
        dataInicio: "2026-01-01",
        dataFim: "2026-03-31",
      }).ok,
    ).toBe(true);
    // Consulta que passa pelo Sponte: janela longa é recusada.
    expect(
      validarChamadaFerramenta("buscar_inadimplencia", {
        dataInicio: "2025-01-01",
        dataFim: "2026-12-31",
      }).ok,
    ).toBe(false);
    expect(
      validarChamadaFerramenta("calcular_saldo_projetado", {
        mesInicio: "2026-01",
        mesFim: "2026-12",
      }).ok,
    ).toBe(false);
  });
});

describe("escopo por unidade", () => {
  it("sem unidade explícita consulta todas as permitidas", () => {
    expect(resolverUnidades(undefined, escopo)).toEqual({
      ok: true,
      unidades: ["CEC", "CEC Baby"],
    });
  });

  it("recusa unidade fora do escopo do usuário em vez de cair no consolidado", async () => {
    const { fonte, chamadas } = fonteFake({ despesas: [despesa({ unidade: "Núcleo Belvedere" })] });
    const r = await roda(
      "buscar_despesas_fluxo_futuro",
      { unidade: "Núcleo Belvedere", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    expect(r.erro).toContain("fora do escopo");
    expect(r.dados).toBeUndefined();
    expect(chamadas).toHaveLength(0);
  });
});

describe("buscar_despesas_fluxo_futuro", () => {
  const despesas = [
    despesa({ descricao: "Energia CEC", valor: 1000 }),
    despesa({ unidade: "CEC Baby", descricao: "Energia Baby", valor: 500 }),
    despesa({ categoria: "Pessoal", subcategoria: "Salários", valor: 8000, status: "paid" }),
    despesa({ mes: "2026-06-01", descricao: "Energia junho", valor: 900 }),
  ];

  it("filtra por unidade", async () => {
    const { fonte } = fonteFake({ despesas });
    const r = await roda(
      "buscar_despesas_fluxo_futuro",
      { unidade: "CEC Baby", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const dados = r.dados as { quantidade: number; itens: DespesaFluxo[] };
    expect(dados.quantidade).toBe(1);
    expect(dados.itens[0].unidade).toBe("CEC Baby");
  });

  it("filtra por categoria e subcategoria", async () => {
    const { fonte } = fonteFake({ despesas });
    const porCategoria = await roda(
      "buscar_despesas_fluxo_futuro",
      { categoria: "Pessoal", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    expect((porCategoria.dados as { quantidade: number }).quantidade).toBe(1);

    const porSub = await roda(
      "buscar_despesas_fluxo_futuro",
      { subcategoria: "Energia", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const dados = porSub.dados as { quantidade: number; totalPrevisto: number };
    expect(dados.quantidade).toBe(2);
    expect(dados.totalPrevisto).toBe(1500);
  });

  it("filtra por intervalo de datas", async () => {
    const { fonte } = fonteFake({ despesas });
    const r = await roda(
      "buscar_despesas_fluxo_futuro",
      { dataInicio: "2026-06-01", dataFim: "2026-06-30" },
      fonte,
    );
    const dados = r.dados as { quantidade: number; itens: DespesaFluxo[] };
    expect(dados.quantidade).toBe(1);
    expect(dados.itens[0].descricao).toBe("Energia junho");
  });

  it("separa previstas de pagas", async () => {
    const { fonte } = fonteFake({ despesas });
    const previstas = await roda(
      "buscar_despesas_fluxo_futuro",
      { situacao: "previstas", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    expect((previstas.dados as { totalPago: number }).totalPago).toBe(0);

    const pagas = await roda(
      "buscar_despesas_fluxo_futuro",
      { situacao: "pagas", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const dados = pagas.dados as { quantidade: number; totalPago: number };
    expect(dados.quantidade).toBe(1);
    expect(dados.totalPago).toBe(8000);
  });

  it("informa a fonte dos números", async () => {
    const { fonte } = fonteFake({ despesas });
    const r = await roda(
      "buscar_despesas_fluxo_futuro",
      { dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    expect(r.fonte).toContain("Fluxo Futuro");
    expect(r.filtros.unidades).toBe("CEC, CEC Baby");
  });
});

describe("buscar_receitas", () => {
  const receitasRealizadas: ReceitaRealizada[] = [
    {
      unidade: "CEC",
      data: "2026-08-05",
      categoria: "Receitas",
      subcategoria: "Mensalidade",
      valor: 30000,
    },
    {
      unidade: "CEC",
      data: "2026-08-15",
      categoria: "Receitas",
      subcategoria: "Uniforme",
      valor: 2000,
    },
    {
      unidade: "CEC Baby",
      data: "2026-08-10",
      categoria: "Receitas",
      subcategoria: "Mensalidade",
      valor: 12000,
    },
    {
      unidade: "CEC",
      data: "2026-07-10",
      categoria: "Receitas",
      subcategoria: "Mensalidade",
      valor: 28000,
    },
  ];
  const receitasPrevistas: ReceitaPrevista[] = [
    { unidade: "CEC", mes: "2026-08-01", quantidadeBoletos: 4, valor: 4000 },
  ];

  it("filtra realizadas por unidade, subcategoria e intervalo", async () => {
    const { fonte } = fonteFake({ receitasRealizadas });
    const porUnidade = await roda(
      "buscar_receitas",
      {
        unidade: "CEC Baby",
        situacao: "realizadas",
        dataInicio: "2026-08-01",
        dataFim: "2026-08-31",
      },
      fonte,
    );
    expect((porUnidade.dados as { realizadas: { total: number } }).realizadas.total).toBe(12000);

    const porSub = await roda(
      "buscar_receitas",
      {
        subcategoria: "Uniforme",
        situacao: "realizadas",
        dataInicio: "2026-08-01",
        dataFim: "2026-08-31",
      },
      fonte,
    );
    expect((porSub.dados as { realizadas: { total: number } }).realizadas.total).toBe(2000);

    const julho = await roda(
      "buscar_receitas",
      { situacao: "realizadas", dataInicio: "2026-07-01", dataFim: "2026-07-31" },
      fonte,
    );
    expect((julho.dados as { realizadas: { total: number } }).realizadas.total).toBe(28000);
  });

  it("não devolve a descrição do lançamento (evita nome do pagador)", async () => {
    const { fonte } = fonteFake({ receitasRealizadas });
    const r = await roda(
      "buscar_receitas",
      { situacao: "realizadas", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    expect(JSON.stringify(r.dados)).not.toMatch(/descricao|descrição/i);
  });

  it("devolve previstas agregadas por unidade e mês", async () => {
    const { fonte } = fonteFake({ receitasPrevistas });
    const r = await roda(
      "buscar_receitas",
      { situacao: "previstas", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const dados = r.dados as {
      previstas: { total: number; quantidadeBoletos: number };
      realizadas: null;
    };
    expect(dados.previstas.total).toBe(4000);
    expect(dados.previstas.quantidadeBoletos).toBe(4);
    expect(dados.realizadas).toBeNull();
  });
});

describe("comparar_despesas_recorrentes", () => {
  const meses = ["2026-06", "2026-07", "2026-08"];

  it("aponta recorrente cadastrada e ausente no mês", () => {
    const series: SerieRecorrente[] = [
      {
        unidade: "CEC",
        descricao: "Aluguel",
        categoria: "Infraestrutura",
        subcategoria: "Aluguel",
        valor: 12000,
        mesInicio: "2026-01-01",
        mesFim: null,
        mesesPulados: [],
      },
    ];
    const despesas = [
      despesa({ mes: "2026-06-01", descricao: "Aluguel", recorrente: true }),
      despesa({ mes: "2026-07-01", descricao: "Aluguel", recorrente: true }),
    ];
    const r = compararRecorrentes(series, despesas, meses);
    expect(r.cadastradasAusentes).toHaveLength(1);
    expect(r.cadastradasAusentes[0].mesesAusentes).toEqual(["2026-08"]);
    expect(r.mesesAnalisados).toEqual(meses);
  });

  it("não acusa ausência em mês pulado ou fora da vigência da série", () => {
    const series: SerieRecorrente[] = [
      {
        unidade: "CEC",
        descricao: "Aluguel",
        categoria: "Infraestrutura",
        subcategoria: "Aluguel",
        valor: 12000,
        mesInicio: "2026-07-01",
        mesFim: null,
        mesesPulados: ["2026-08-01"],
      },
    ];
    const despesas = [despesa({ mes: "2026-07-01", descricao: "Aluguel", recorrente: true })];
    expect(compararRecorrentes(series, despesas, meses).cadastradasAusentes).toEqual([]);
  });

  it("aponta despesa recorrente pelo padrão mas não marcada como recorrente", () => {
    const despesas = meses.map((m) =>
      despesa({ mes: `${m}-01`, descricao: "Internet fibra", valor: 400, recorrente: false }),
    );
    const r = compararRecorrentes([], despesas, meses);
    expect(r.recorrentesNaoCadastradas).toHaveLength(1);
    expect(r.recorrentesNaoCadastradas[0].descricao).toBe("Internet fibra");
    expect(r.recorrentesNaoCadastradas[0].mesesPresentes).toEqual(meses);
    expect(r.recorrentesNaoCadastradas[0].valorMedio).toBe(400);
  });

  it("ignora despesa que aparece só em parte dos meses e a já marcada como recorrente", () => {
    const parcial = [
      despesa({ mes: "2026-06-01", descricao: "Manutenção pontual" }),
      despesa({ mes: "2026-07-01", descricao: "Manutenção pontual" }),
    ];
    expect(compararRecorrentes([], parcial, meses).recorrentesNaoCadastradas).toEqual([]);

    const marcadas = meses.map((m) =>
      despesa({ mes: `${m}-01`, descricao: "Internet fibra", recorrente: true }),
    );
    expect(compararRecorrentes([], marcadas, meses).recorrentesNaoCadastradas).toEqual([]);
  });

  it("olha os últimos 3 meses a partir do mês de referência", async () => {
    const { fonte, chamadas } = fonteFake({ despesas: [] });
    const r = await roda("comparar_despesas_recorrentes", { mesReferencia: "2026-08" }, fonte);
    expect(r.filtros.mesesAnalisados).toBe("2026-06, 2026-07, 2026-08");
    const filtro = chamadas.find((c) => c.fn === "despesasFluxo")?.filtro as FiltroPeriodo;
    expect(filtro.dataInicio).toBe("2026-06-01");
    expect(filtro.dataFim).toBe("2026-08-31");
  });
});

describe("buscar_inadimplencia", () => {
  const linhas: InadimplenciaAgregada[] = [
    {
      unidade: "CEC",
      quantidadeBoletos: 10,
      quantidadeParcelas: 14,
      valorTotal: 25000,
      valorAcordo: 5000,
    },
    {
      unidade: "CEC Baby",
      quantidadeBoletos: 3,
      quantidadeParcelas: 3,
      valorTotal: 6000,
      valorAcordo: 0,
    },
  ];

  it("agrega por unidade e período", async () => {
    const { fonte, chamadas } = fonteFake({ inadimplencia: linhas });
    const r = await roda(
      "buscar_inadimplencia",
      { dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const dados = r.dados as {
      totalEmAberto: number;
      totalSemAcordos: number;
      quantidadeBoletos: number;
      quantidadeParcelas: number;
      porUnidade: { unidade: string; valorEmAberto: number }[];
    };
    expect(dados.totalEmAberto).toBe(31000);
    expect(dados.totalSemAcordos).toBe(26000);
    expect(dados.quantidadeBoletos).toBe(13);
    expect(dados.quantidadeParcelas).toBe(17);
    expect(dados.porUnidade.map((u) => u.unidade)).toEqual(["CEC", "CEC Baby"]);
    expect(chamadas[0].filtro).toMatchObject({
      dataInicio: "2026-08-01",
      dataFim: "2026-08-31",
      unidades: ["CEC", "CEC Baby"],
    });
  });

  it("restringe a uma unidade quando pedido", async () => {
    const { fonte } = fonteFake({ inadimplencia: linhas });
    const r = await roda(
      "buscar_inadimplencia",
      { unidade: "CEC Baby", dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const dados = r.dados as { totalEmAberto: number; porUnidade: { unidade: string }[] };
    expect(dados.totalEmAberto).toBe(6000);
    expect(dados.porUnidade).toEqual([expect.objectContaining({ unidade: "CEC Baby" })]);
  });

  it("não expõe nome, CPF, endereço, telefone nem identificador individual", async () => {
    const { fonte } = fonteFake({ inadimplencia: linhas });
    const r = await roda(
      "buscar_inadimplencia",
      { dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      fonte,
    );
    const serializado = JSON.stringify(r).toLowerCase();
    for (const proibido of [
      "nomealuno",
      "nomeresponsavel",
      "cpf",
      "endereco",
      "endereço",
      "telefone",
      "alunoid",
      "numeroboleto",
      "numeroparcela",
      "linhadigitavel",
      "contareceberid",
    ]) {
      expect(serializado).not.toContain(proibido);
    }
    // A estrutura devolvida por unidade é só contagem e valor.
    const dados = r.dados as { porUnidade: Record<string, unknown>[] };
    for (const linha of dados.porUnidade) {
      expect(Object.keys(linha).sort()).toEqual([
        "quantidadeBoletos",
        "quantidadeParcelas",
        "unidade",
        "valorEmAberto",
        "valorRenegociadoAcordo",
      ]);
    }
  });
});

describe("calcular_saldo_projetado", () => {
  it("calcula receitas previstas − despesas não pagas por unidade e mês", async () => {
    const { fonte } = fonteFake({
      receitasPrevistas: [
        { unidade: "CEC", mes: "2026-08-01", quantidadeBoletos: 3, valor: 10000 },
        { unidade: "CEC", mes: "2026-09-01", quantidadeBoletos: 2, valor: 8000 },
        { unidade: "CEC Baby", mes: "2026-08-01", quantidadeBoletos: 1, valor: 3000 },
      ],
      despesas: [
        despesa({ mes: "2026-08-01", valor: 12000 }),
        // Despesa paga não entra na projeção.
        despesa({ mes: "2026-08-01", valor: 5000, status: "paid" }),
        despesa({ unidade: "CEC Baby", mes: "2026-09-01", valor: 1000 }),
      ],
    });
    const r = await roda(
      "calcular_saldo_projetado",
      { mesInicio: "2026-08", mesFim: "2026-09" },
      fonte,
    );
    const dados = r.dados as {
      linhas: { unidade: string; mes: string; saldoProjetado: number; despesasPrevistas: number }[];
      saldoTotal: number;
    };
    const cecAgosto = dados.linhas.find((l) => l.unidade === "CEC" && l.mes === "2026-08");
    expect(cecAgosto).toMatchObject({ despesasPrevistas: 12000, saldoProjetado: -2000 });
    expect(dados.linhas.find((l) => l.unidade === "CEC" && l.mes === "2026-09")).toMatchObject({
      saldoProjetado: 8000,
    });
    expect(dados.linhas.find((l) => l.unidade === "CEC Baby" && l.mes === "2026-09")).toMatchObject(
      {
        saldoProjetado: -1000,
      },
    );
    expect(dados.saldoTotal).toBe(8000);
  });

  it("restringe o cálculo à unidade pedida", async () => {
    const { fonte } = fonteFake({
      receitasPrevistas: [
        { unidade: "CEC", mes: "2026-08-01", quantidadeBoletos: 3, valor: 10000 },
        { unidade: "CEC Baby", mes: "2026-08-01", quantidadeBoletos: 1, valor: 3000 },
      ],
    });
    const r = await roda(
      "calcular_saldo_projetado",
      { unidade: "CEC", mesInicio: "2026-08", mesFim: "2026-08" },
      fonte,
    );
    const dados = r.dados as { linhas: { unidade: string }[]; saldoTotal: number };
    expect(dados.linhas.map((l) => l.unidade)).toEqual(["CEC"]);
    expect(dados.saldoTotal).toBe(10000);
  });
});

describe("auditoria das ferramentas disparadas", () => {
  it("cada resultado identifica a ferramenta e a fonte consultada", async () => {
    const { fonte } = fonteFake({});
    const chamadas: ChamadaFerramenta[] = [
      {
        nome: "buscar_despesas_fluxo_futuro",
        args: { dataInicio: "2026-08-01", dataFim: "2026-08-31" },
      },
      { nome: "buscar_receitas", args: { dataInicio: "2026-08-01", dataFim: "2026-08-31" } },
      { nome: "comparar_despesas_recorrentes", args: { mesReferencia: "2026-08" } },
      { nome: "buscar_inadimplencia", args: { dataInicio: "2026-08-01", dataFim: "2026-08-31" } },
      { nome: "calcular_saldo_projetado", args: { mesInicio: "2026-08", mesFim: "2026-08" } },
    ];
    for (const chamada of chamadas) {
      const r = await executarFerramenta(chamada, fonte, escopo);
      expect(r.ferramenta).toBe(chamada.nome);
      expect(NOMES_FERRAMENTAS).toContain(r.ferramenta);
      expect(r.fonte.length).toBeGreaterThan(0);
      expect(r.filtros.unidades).toBe("CEC, CEC Baby");
    }
  });
});
