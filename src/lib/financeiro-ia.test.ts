import { describe, it, expect } from "vitest";
import {
  NOMES_FERRAMENTAS_MODULOS,
  RESPOSTA_SEM_CONSULTA,
  type ContrachequeEnvioIA,
  type ConversaAtendimentoIA,
  type DocumentoEmitidoIA,
  type FolhaTransporteIA,
  type FonteDadosModulos,
  type ItemEstoqueUniformeIA,
  type LinhaRematriculaIA,
  type PedidoUniformeIA,
  type QuadroFuncionariosIA,
  type RecargaCantinaIA,
  type RepasseEsporteIA,
  type SubmissaoMatriculaIA,
  type TurmaAtivosIA,
  type TurmaEsporteIA,
} from "@/lib/analises-ia-modulos";
import {
  compararRecorrentes,
  executarFerramenta,
  ferramentaObrigatoriaPara,
  FERRAMENTAS_ANALISE,
  montarSystemPrompt,
  NOMES_FERRAMENTAS,
  resolverUnidades,
  validarChamadaFerramenta,
  type ChamadaFerramenta,
  type DespesaFluxo,
  type EscopoAnalise,
  type FiltroPeriodo,
  type FonteDadosFinanceiros,
  type GrupoExtrato,
  type InadimplenciaAgregada,
  type LancamentoExtrato,
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

function lancamento(over: Partial<LancamentoExtrato>): LancamentoExtrato {
  return {
    unidade: "CEC",
    data: "2026-08-05",
    descricao: "CEMIG",
    categoria: "Infraestrutura",
    subcategoria: "Energia",
    valor: 1000,
    ...over,
  };
}

// Dublê da fonte real: guarda os filtros recebidos (para provar que a ferramenta
// repassa unidade/categoria/subcategoria/intervalo) e devolve dados fixos.
function fonteFake(dados: {
  despesas?: DespesaFluxo[];
  extrato?: LancamentoExtrato[];
  receitasRealizadas?: ReceitaRealizada[];
  receitasPrevistas?: ReceitaPrevista[];
  series?: SerieRecorrente[];
  inadimplencia?: InadimplenciaAgregada[];
  cantina?: RecargaCantinaIA[];
  rematricula?: LinhaRematriculaIA[];
  repasses?: RepasseEsporteIA[];
  turmasEsporte?: TurmaEsporteIA[];
  estoqueUniformes?: ItemEstoqueUniformeIA[];
  pedidosUniformes?: PedidoUniformeIA[];
  documentos?: DocumentoEmitidoIA[];
  submissoes?: SubmissaoMatriculaIA[];
  ativos?: TurmaAtivosIA[];
  conversas?: ConversaAtendimentoIA[];
  contracheques?: ContrachequeEnvioIA[];
  folhasTransporte?: FolhaTransporteIA[];
  quadro?: QuadroFuncionariosIA[];
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
    async lancamentosExtrato(filtro) {
      chamadas.push({ fn: "lancamentosExtrato", filtro });
      return (dados.extrato ?? []).filter(
        (l) =>
          filtro.unidades.includes(l.unidade) &&
          l.data >= filtro.dataInicio &&
          l.data <= filtro.dataFim &&
          (!filtro.categoria || l.categoria === filtro.categoria) &&
          (!filtro.subcategoria || l.subcategoria === filtro.subcategoria),
      );
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

  // Dublê das fontes dos módulos: cada método aplica o mesmo recorte do adapter
  // real (unidade e período/mês) sobre linhas fixas.
  const modulos: FonteDadosModulos = {
    async recargasCantina(filtro) {
      chamadas.push({ fn: "recargasCantina", filtro });
      return (dados.cantina ?? []).filter(
        (r) =>
          filtro.unidades.includes(r.unidade) &&
          r.data >= filtro.dataInicio &&
          r.data <= filtro.dataFim,
      );
    },
    async rematriculaMaterial(filtro) {
      chamadas.push({ fn: "rematriculaMaterial", filtro });
      return {
        linhas: (dados.rematricula ?? []).filter(
          (l) =>
            filtro.unidades.includes(l.unidade) &&
            (filtro.anoLetivo === undefined || l.anoLetivo === filtro.anoLetivo),
        ),
        avisos: [],
      };
    },
    async esportes(filtro) {
      chamadas.push({ fn: "esportes", filtro });
      const casa = (modalidade: string) =>
        !filtro.modalidade ||
        modalidade.toLowerCase().includes(filtro.modalidade.trim().toLowerCase());
      return {
        repasses: (dados.repasses ?? []).filter(
          (r) =>
            filtro.unidades.includes(r.unidade) &&
            casa(r.modalidade) &&
            r.mesReferencia >= filtro.mesInicio &&
            r.mesReferencia <= filtro.mesFim,
        ),
        turmas: (dados.turmasEsporte ?? []).filter(
          (t) => filtro.unidades.includes(t.unidade) && casa(t.modalidade),
        ),
      };
    },
    async uniformes(filtro) {
      chamadas.push({ fn: "uniformes", filtro });
      return {
        estoque: dados.estoqueUniformes ?? [],
        pedidos: dados.pedidosUniformes ?? [],
        avisos: [],
      };
    },
    async documentosEmitidos(filtro) {
      chamadas.push({ fn: "documentosEmitidos", filtro });
      return (dados.documentos ?? []).filter(
        (d) =>
          filtro.unidades.includes(d.unidade) &&
          d.data >= filtro.dataInicio &&
          d.data <= filtro.dataFim &&
          (!filtro.tipo || d.tipo === filtro.tipo),
      );
    },
    async matriculas(filtro) {
      chamadas.push({ fn: "matriculas", filtro });
      return {
        submissoes: (dados.submissoes ?? []).filter(
          (s) =>
            filtro.unidades.includes(s.unidade) &&
            s.data >= filtro.dataInicio &&
            s.data <= filtro.dataFim,
        ),
        ativos: (dados.ativos ?? []).filter((a) => filtro.unidades.includes(a.unidade)),
        avisos: [],
      };
    },
    async atendimento(filtro) {
      chamadas.push({ fn: "atendimento", filtro });
      return {
        conversas: (dados.conversas ?? []).filter(
          (c) =>
            filtro.unidades.includes(c.unidade) &&
            c.data >= filtro.dataInicio &&
            c.data <= filtro.dataFim,
        ),
      };
    },
    async folhaRh(filtro) {
      chamadas.push({ fn: "folhaRh", filtro });
      return {
        contracheques: (dados.contracheques ?? []).filter(
          (c) =>
            filtro.unidades.includes(c.unidade) &&
            c.competencia >= filtro.mesInicio &&
            c.competencia <= filtro.mesFim,
        ),
        folhasTransporte: (dados.folhasTransporte ?? []).filter(
          (f) =>
            filtro.unidades.includes(f.unidade) &&
            f.mesReferencia >= filtro.mesInicio &&
            f.mesReferencia <= filtro.mesFim,
        ),
        quadro: (dados.quadro ?? []).filter((q) => filtro.unidades.includes(q.unidade)),
      };
    },
  };

  return { fonte: { ...fonte, ...modulos }, chamadas };
}

type FonteCompleta = FonteDadosFinanceiros & FonteDadosModulos;

async function roda(nome: string, args: unknown, fonte: FonteCompleta) {
  const v = validarChamadaFerramenta(nome, args);
  if (!v.ok) throw new Error(`validação falhou: ${v.erro}`);
  return executarFerramenta(v.chamada, fonte, escopo);
}

describe("lista fechada de ferramentas", () => {
  it("expõe exatamente as consultas permitidas (financeiras + módulos)", () => {
    expect([...NOMES_FERRAMENTAS]).toEqual([
      "buscar_despesas_fluxo_futuro",
      "buscar_lancamentos_extrato_bancario",
      "buscar_receitas",
      "comparar_despesas_recorrentes",
      "buscar_inadimplencia",
      "calcular_saldo_projetado",
      "buscar_recargas_cantina",
      "buscar_rematricula_material",
      "buscar_esportes_repasses",
      "buscar_uniformes_estoque_pedidos",
      "buscar_documentos_emitidos",
      "buscar_matriculas_alunos_ativos",
      "buscar_atendimento_conversas",
      "buscar_folha_rh",
      "listar_consultas_disponiveis",
    ]);
    expect(FERRAMENTAS_ANALISE).toHaveLength(15);
    expect(FERRAMENTAS_ANALISE.map((f) => f.nome)).toEqual([...NOMES_FERRAMENTAS]);
    // Todo módulo novo entra pela lista dos módulos, nunca por permissão genérica.
    expect(NOMES_FERRAMENTAS_MODULOS).toHaveLength(9);
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

// ─── Ferramentas dos módulos ────────────────────────────────────────────────

const periodoAgosto = { dataInicio: "2026-08-01", dataFim: "2026-08-31" };

describe("buscar_recargas_cantina", () => {
  const cantina: RecargaCantinaIA[] = [
    { unidade: "CEC", data: "2026-08-05", status: "pendente", valor: 50 },
    { unidade: "CEC", data: "2026-08-10", status: "efetivada", valor: 100 },
    { unidade: "CEC Baby", data: "2026-08-20", status: "lancada_no_boleto", valor: 200 },
    { unidade: "CEC", data: "2026-09-02", status: "efetivada", valor: 999 },
  ];

  it("soma valor e contagem por status no período, agregando por unidade", async () => {
    const { fonte } = fonteFake({ cantina });
    const r = await roda("buscar_recargas_cantina", periodoAgosto, fonte);
    const dados = r.dados as {
      quantidadeSolicitadas: number;
      valorSolicitado: number;
      porStatus: { status: string; quantidade: number; valor: number }[];
      porUnidade: { unidade: string; valorSolicitado: number }[];
    };
    expect(dados.quantidadeSolicitadas).toBe(3);
    expect(dados.valorSolicitado).toBe(350);
    expect(dados.porStatus).toEqual([
      { status: "pendente", rotulo: expect.any(String), quantidade: 1, valor: 50 },
      { status: "efetivada", rotulo: expect.any(String), quantidade: 1, valor: 100 },
      { status: "lancada_no_boleto", rotulo: expect.any(String), quantidade: 1, valor: 200 },
    ]);
    expect(dados.porUnidade).toEqual([
      expect.objectContaining({ unidade: "CEC", valorSolicitado: 150 }),
      expect.objectContaining({ unidade: "CEC Baby", valorSolicitado: 200 }),
    ]);
  });

  it("filtra por unidade e não devolve dado de aluno ou responsável", async () => {
    const { fonte, chamadas } = fonteFake({ cantina });
    const r = await roda("buscar_recargas_cantina", { ...periodoAgosto, unidade: "CEC" }, fonte);
    expect((r.dados as { quantidadeSolicitadas: number }).quantidadeSolicitadas).toBe(2);
    expect(chamadas[0].filtro).toEqual({ unidades: ["CEC"], ...periodoAgosto });
    expect(JSON.stringify(r.dados)).not.toMatch(/aluno|responsavel|responsável|telefone|boleto_/i);
  });
});

describe("buscar_rematricula_material", () => {
  const rematricula: LinhaRematriculaIA[] = [
    { unidade: "CEC", status: "nao_iniciado", parcelas: null, valorAnual: null, anoLetivo: 2027 },
    { unidade: "CEC", status: "em_andamento", parcelas: null, valorAnual: null, anoLetivo: 2027 },
    {
      unidade: "CEC",
      status: "aguardando_aprovacao",
      parcelas: 3,
      valorAnual: 900,
      anoLetivo: 2027,
    },
    {
      unidade: "CEC Baby",
      status: "rematriculado",
      parcelas: 8,
      valorAnual: 1600,
      anoLetivo: 2027,
    },
    { unidade: "CEC", status: "rematriculado", parcelas: 4, valorAnual: 500, anoLetivo: 2026 },
  ];

  it("conta os quatro status sobre os alunos ativos e distribui 1x a 8x", async () => {
    const { fonte } = fonteFake({ rematricula });
    const r = await roda("buscar_rematricula_material", { anoLetivo: 2027 }, fonte);
    const dados = r.dados as {
      totalAlunosAtivos: number;
      porStatus: { status: string; quantidade: number }[];
      distribuicaoParcelamentos: { parcelas: number; quantidade: number }[];
      valorMaterialAReceber: number;
    };
    expect(dados.totalAlunosAtivos).toBe(4);
    expect(dados.porStatus.map((s) => [s.status, s.quantidade])).toEqual([
      ["nao_iniciado", 1],
      ["em_andamento", 1],
      ["aguardando_aprovacao", 1],
      ["rematriculado", 1],
    ]);
    expect(dados.distribuicaoParcelamentos).toHaveLength(8);
    expect(dados.distribuicaoParcelamentos.filter((d) => d.quantidade > 0)).toEqual([
      { parcelas: 3, quantidade: 1 },
      { parcelas: 8, quantidade: 1 },
    ]);
    expect(dados.valorMaterialAReceber).toBe(2500);
  });

  it("agrega por unidade e ano letivo sem devolver nome ou id de aluno", async () => {
    const { fonte } = fonteFake({ rematricula });
    const r = await roda("buscar_rematricula_material", { unidade: "CEC" }, fonte);
    const dados = r.dados as {
      totalAlunosAtivos: number;
      porUnidade: { unidade: string; anosLetivos: number[]; valorMaterialAReceber: number }[];
    };
    expect(dados.totalAlunosAtivos).toBe(4);
    expect(dados.porUnidade).toHaveLength(1);
    expect(dados.porUnidade[0].unidade).toBe("CEC");
    expect(dados.porUnidade[0].anosLetivos.sort()).toEqual([2026, 2027]);
    expect(dados.porUnidade[0].valorMaterialAReceber).toBe(1400);
    expect(JSON.stringify(r.dados)).not.toMatch(/alunoId|aluno_id|cpf|nome/i);
  });
});

describe("buscar_esportes_repasses", () => {
  const repasses: RepasseEsporteIA[] = [
    {
      unidade: "CEC",
      modalidade: "Judô",
      parceiro: "Parceiro A",
      tipoRepasse: "percentual",
      mesReferencia: "2026-08",
      valorArrecadado: 1000,
      valorRepasse: 700,
      valorRetido: 300,
      pago: true,
    },
    {
      unidade: "CEC",
      modalidade: "Judô",
      parceiro: "Parceiro A",
      tipoRepasse: "percentual",
      mesReferencia: "2026-09",
      valorArrecadado: 1000,
      valorRepasse: 700,
      valorRetido: 300,
      pago: false,
    },
    {
      unidade: "CEC",
      modalidade: "Ballet",
      parceiro: "Parceiro B",
      tipoRepasse: "fixo",
      mesReferencia: "2026-08",
      valorArrecadado: 800,
      valorRepasse: 500,
      valorRetido: 300,
      pago: true,
    },
    {
      unidade: "CEC",
      modalidade: "Judô",
      parceiro: "Parceiro A",
      tipoRepasse: "percentual",
      mesReferencia: "2026-07",
      valorArrecadado: 5000,
      valorRepasse: 3500,
      valorRetido: 1500,
      pago: true,
    },
  ];
  const turmasEsporte: TurmaEsporteIA[] = [
    { unidade: "CEC", modalidade: "Judô", turma: "Turma A", quantidadeAlunos: 12 },
    { unidade: "CEC", modalidade: "Ballet", turma: "Turma B", quantidadeAlunos: 7 },
  ];
  const intervalo = { mesInicio: "2026-08", mesFim: "2026-09" };

  it("separa repasse percentual de fixo e agrega alunos por turma", async () => {
    const { fonte } = fonteFake({ repasses, turmasEsporte });
    const r = await roda("buscar_esportes_repasses", intervalo, fonte);
    const dados = r.dados as {
      totalArrecadado: number;
      totalRepassado: number;
      totalRetido: number;
      totalRepassadoPercentual: number;
      totalRepassadoFixo: number;
      porParceiro: { parceiro: string; meses: number; repassesPagos: number }[];
      alunosPorTurma: TurmaEsporteIA[];
      totalAlunosMatriculados: number;
    };
    expect(dados.totalArrecadado).toBe(2800);
    expect(dados.totalRepassado).toBe(1900);
    expect(dados.totalRetido).toBe(900);
    expect(dados.totalRepassadoPercentual).toBe(1400);
    expect(dados.totalRepassadoFixo).toBe(500);
    expect(dados.porParceiro[0]).toEqual(
      expect.objectContaining({ parceiro: "Parceiro A", meses: 2, repassesPagos: 1 }),
    );
    expect(dados.totalAlunosMatriculados).toBe(19);
    expect(dados.alunosPorTurma).toHaveLength(2);
  });

  it("filtra por modalidade e unidade sem devolver matrícula individual", async () => {
    const { fonte, chamadas } = fonteFake({ repasses, turmasEsporte });
    const r = await roda(
      "buscar_esportes_repasses",
      { ...intervalo, unidade: "CEC", modalidade: "Judô" },
      fonte,
    );
    const dados = r.dados as { totalRepassado: number; totalAlunosMatriculados: number };
    expect(chamadas[0].filtro).toEqual({
      unidades: ["CEC"],
      ...intervalo,
      modalidade: "Judô",
    });
    expect(dados.totalRepassado).toBe(1400);
    expect(dados.totalAlunosMatriculados).toBe(12);
    expect(JSON.stringify(r.dados)).not.toMatch(/aluno_id|alunoId|cpf|telefone/i);
  });
});

describe("buscar_uniformes_estoque_pedidos", () => {
  const estoqueUniformes: ItemEstoqueUniformeIA[] = [
    {
      loja: "CEC / CEC Baby",
      produto: "Bermuda Tactel / Azul",
      tamanho: "8",
      estoque: 2,
      estoqueMinimo: 5,
      pedidoRealizado: false,
    },
    {
      loja: "CEC / CEC Baby",
      produto: "Camiseta / Azul",
      tamanho: "10",
      estoque: 1,
      estoqueMinimo: 3,
      pedidoRealizado: true,
    },
    {
      loja: "CEC / CEC Baby",
      produto: "Agasalho / Azul",
      tamanho: "12",
      estoque: 10,
      estoqueMinimo: 5,
      pedidoRealizado: false,
    },
  ];
  const pedidosUniformes: PedidoUniformeIA[] = [
    {
      loja: "CEC / CEC Baby",
      produto: "Bermuda Tactel / Azul",
      tamanho: "8",
      quantidade: 4,
      receita: 400,
    },
    {
      loja: "CEC / CEC Baby",
      produto: "Camiseta / Azul",
      tamanho: "10",
      quantidade: 2,
      receita: 150,
    },
  ];

  it("lista só o que está abaixo do mínimo e o volume de pedidos pagos", async () => {
    const { fonte, chamadas } = fonteFake({ estoqueUniformes, pedidosUniformes });
    const r = await roda("buscar_uniformes_estoque_pedidos", periodoAgosto, fonte);
    const dados = r.dados as {
      itensAbaixoDoMinimo: number;
      itensAbaixoDoMinimoSemPedido: number;
      itens: ItemEstoqueUniformeIA[];
      pedidos: { quantidadePecas: number; receita: number; porPeca: PedidoUniformeIA[] };
    };
    expect(chamadas[0].filtro).toEqual({ unidades: ["CEC", "CEC Baby"], ...periodoAgosto });
    expect(dados.itensAbaixoDoMinimo).toBe(2);
    expect(dados.itensAbaixoDoMinimoSemPedido).toBe(1);
    expect(dados.itens.map((i) => i.produto)).toEqual(["Camiseta / Azul", "Bermuda Tactel / Azul"]);
    expect(dados.pedidos.quantidadePecas).toBe(6);
    expect(dados.pedidos.receita).toBe(550);
    expect(dados.pedidos.porPeca[0].produto).toBe("Bermuda Tactel / Azul");
  });

  it("não devolve comprador, sku nem dado de cliente", async () => {
    const { fonte } = fonteFake({ estoqueUniformes, pedidosUniformes });
    const r = await roda("buscar_uniformes_estoque_pedidos", periodoAgosto, fonte);
    expect(JSON.stringify(r.dados)).not.toMatch(/sku|comprador|cliente|endereco|endereço|email/i);
  });
});

describe("buscar_documentos_emitidos", () => {
  const documentos: DocumentoEmitidoIA[] = [
    { unidade: "CEC", tipo: "recibo", data: "2026-08-03", valorTotal: 1200 },
    { unidade: "CEC", tipo: "recibo", data: "2026-08-04", valorTotal: 800 },
    { unidade: "CEC Baby", tipo: "declaracao_debitos", data: "2026-08-10", valorTotal: 0 },
    { unidade: "CEC", tipo: "termo_confissao_divida", data: "2026-08-15", valorTotal: 5000 },
    { unidade: "CEC", tipo: "declaracao_ir", data: "2026-07-31", valorTotal: 0 },
  ];

  it("conta por tipo e unidade no período, declarando o lote como indisponível", async () => {
    const { fonte } = fonteFake({ documentos });
    const r = await roda("buscar_documentos_emitidos", periodoAgosto, fonte);
    const dados = r.dados as {
      quantidadeTotal: number;
      porTipo: { tipo: string; quantidade: number; valorTotal: number }[];
      porUnidade: { unidade: string; quantidade: number }[];
      statusEnvioEmLote: string;
    };
    expect(dados.quantidadeTotal).toBe(4);
    expect(dados.porTipo.filter((t) => t.quantidade > 0)).toEqual([
      expect.objectContaining({ tipo: "recibo", quantidade: 2, valorTotal: 2000 }),
      expect.objectContaining({ tipo: "declaracao_debitos", quantidade: 1 }),
      expect.objectContaining({ tipo: "termo_confissao_divida", quantidade: 1, valorTotal: 5000 }),
    ]);
    expect(dados.porUnidade.map((u) => [u.unidade, u.quantidade])).toEqual([
      ["CEC", 3],
      ["CEC Baby", 1],
    ]);
    // O envio em lote não é persistido: a ferramenta diz isso em vez de inventar.
    expect(dados.statusEnvioEmLote).toContain("não disponível");
  });

  it("restringe ao tipo pedido e não devolve responsável, CPF nem snapshot", async () => {
    const { fonte, chamadas } = fonteFake({ documentos });
    const r = await roda(
      "buscar_documentos_emitidos",
      { ...periodoAgosto, unidade: "CEC", tipo: "recibo" },
      fonte,
    );
    expect(chamadas[0].filtro).toEqual({
      unidades: ["CEC"],
      ...periodoAgosto,
      tipo: "recibo",
    });
    expect((r.dados as { quantidadeTotal: number }).quantidadeTotal).toBe(2);
    expect(JSON.stringify(r.dados)).not.toMatch(/cpf|snapshot|responsavel|responsável|itens/i);
  });
});

describe("buscar_matriculas_alunos_ativos", () => {
  const submissoes: SubmissaoMatriculaIA[] = [
    { unidade: "CEC", status: "sucesso", data: "2026-08-02" },
    { unidade: "CEC Baby", status: "sucesso", data: "2026-08-09" },
    { unidade: "CEC", status: "erro_aluno", data: "2026-08-11" },
    { unidade: "CEC", status: "duplicado", data: "2026-09-01" },
  ];
  const ativos: TurmaAtivosIA[] = [
    { unidade: "CEC", turma: "06 - 2º Período T", quantidadeAlunos: 20 },
    { unidade: "CEC", turma: "07 - 3º Período M", quantidadeAlunos: 15 },
    { unidade: "CEC Baby", turma: "01 - Berçário", quantidadeAlunos: 10 },
  ];

  it("conta confirmadas por status e alunos ativos por turma/unidade", async () => {
    const { fonte } = fonteFake({ submissoes, ativos });
    const r = await roda("buscar_matriculas_alunos_ativos", periodoAgosto, fonte);
    const dados = r.dados as {
      matriculasConfirmadas: number;
      submissoesTotal: number;
      porStatus: { status: string; quantidade: number }[];
      porUnidade: { unidade: string; matriculasConfirmadas: number; alunosAtivos: number }[];
      totalAlunosAtivos: number;
      alunosAtivosPorTurma: TurmaAtivosIA[];
    };
    expect(dados.matriculasConfirmadas).toBe(2);
    expect(dados.submissoesTotal).toBe(3);
    expect(dados.porStatus).toEqual([
      { status: "erro_aluno", quantidade: 1 },
      { status: "sucesso", quantidade: 2 },
    ]);
    expect(dados.totalAlunosAtivos).toBe(45);
    expect(dados.alunosAtivosPorTurma).toHaveLength(3);
    expect(dados.porUnidade).toEqual([
      expect.objectContaining({ unidade: "CEC", matriculasConfirmadas: 1, alunosAtivos: 35 }),
      expect.objectContaining({ unidade: "CEC Baby", matriculasConfirmadas: 1, alunosAtivos: 10 }),
    ]);
  });

  it("filtra por unidade e não devolve payload da submissão", async () => {
    const { fonte, chamadas } = fonteFake({ submissoes, ativos });
    const r = await roda(
      "buscar_matriculas_alunos_ativos",
      { ...periodoAgosto, unidade: "CEC Baby" },
      fonte,
    );
    expect(chamadas[0].filtro).toEqual({ unidades: ["CEC Baby"], ...periodoAgosto });
    expect((r.dados as { totalAlunosAtivos: number }).totalAlunosAtivos).toBe(10);
    expect(JSON.stringify(r.dados)).not.toMatch(/payload|cpf|aluno_nome|telefone|endereco/i);
  });
});

describe("buscar_atendimento_conversas", () => {
  const conversas: ConversaAtendimentoIA[] = [
    {
      unidade: "CEC",
      data: "2026-08-03",
      mensagensRecebidas: 4,
      mensagensEnviadas: 3,
      primeiraRespostaMinutos: 10,
    },
    {
      unidade: "CEC",
      data: "2026-08-04",
      mensagensRecebidas: 2,
      mensagensEnviadas: 2,
      primeiraRespostaMinutos: 20,
    },
    {
      unidade: "CEC Baby",
      data: "2026-08-05",
      mensagensRecebidas: 1,
      mensagensEnviadas: 0,
      primeiraRespostaMinutos: null,
    },
  ];

  it("soma o volume por unidade e calcula a média só das conversas com par", async () => {
    const { fonte } = fonteFake({ conversas });
    const r = await roda("buscar_atendimento_conversas", periodoAgosto, fonte);
    const dados = r.dados as {
      quantidadeConversas: number;
      mensagensRecebidas: number;
      mensagensEnviadas: number;
      tempoMedioPrimeiraRespostaMinutos: number | null;
      conversasComPrimeiraResposta: number;
      porUnidade: { unidade: string; tempoMedioPrimeiraRespostaMinutos: number | null }[];
    };
    expect(dados.quantidadeConversas).toBe(3);
    expect(dados.mensagensRecebidas).toBe(7);
    expect(dados.mensagensEnviadas).toBe(5);
    expect(dados.tempoMedioPrimeiraRespostaMinutos).toBe(15);
    expect(dados.conversasComPrimeiraResposta).toBe(2);
    expect(dados.porUnidade).toEqual([
      expect.objectContaining({ unidade: "CEC", tempoMedioPrimeiraRespostaMinutos: 15 }),
      expect.objectContaining({ unidade: "CEC Baby", tempoMedioPrimeiraRespostaMinutos: null }),
    ]);
  });

  it("devolve tempo indisponível (não estimado) quando não há par confiável", async () => {
    const { fonte } = fonteFake({ conversas: [conversas[2]] });
    const r = await roda("buscar_atendimento_conversas", periodoAgosto, fonte);
    const dados = r.dados as {
      tempoMedioPrimeiraRespostaMinutos: number | null;
      observacaoTempoResposta: string;
    };
    expect(dados.tempoMedioPrimeiraRespostaMinutos).toBeNull();
    expect(dados.observacaoTempoResposta).toContain("indisponível");
  });

  it("não devolve telefone, nome nem conteúdo de mensagem", async () => {
    const { fonte } = fonteFake({ conversas });
    const r = await roda("buscar_atendimento_conversas", periodoAgosto, fonte);
    expect(JSON.stringify(r.dados)).not.toMatch(/telefone|phone|wa_id|corpo|body|media|preview/i);
  });
});

describe("buscar_folha_rh", () => {
  const intervalo = { mesInicio: "2026-08", mesFim: "2026-09" };
  const contracheques: ContrachequeEnvioIA[] = [
    { unidade: "CEC", competencia: "2026-08", status: "enviado" },
    { unidade: "CEC", competencia: "2026-08", status: "enviado" },
    { unidade: "CEC", competencia: "2026-08", status: "falha" },
    { unidade: "CEC Baby", competencia: "2026-09", status: "enviado" },
    { unidade: "CEC", competencia: "2026-06", status: "enviado" },
  ];
  const folhasTransporte: FolhaTransporteIA[] = [
    { unidade: "CEC", mesReferencia: "2026-08", valorTotal: 1500 },
    { unidade: "CEC Baby", mesReferencia: "2026-08", valorTotal: 700 },
  ];
  const quadro: QuadroFuncionariosIA[] = [
    { unidade: "CEC", funcionariosAtivos: 20 },
    { unidade: "CEC Baby", funcionariosAtivos: 8 },
  ];

  it("agrega envios, competências, vale-transporte e quadro por unidade", async () => {
    const { fonte } = fonteFake({ contracheques, folhasTransporte, quadro });
    const r = await roda("buscar_folha_rh", intervalo, fonte);
    const dados = r.dados as {
      contrachequesEnviados: number;
      contrachequesPorStatus: { status: string; quantidade: number }[];
      contrachequesPorCompetencia: { competencia: string; quantidade: number }[];
      totalFolhaTransporte: number;
      funcionariosAtivos: number;
      porUnidade: { unidade: string; totalFolhaTransporte: number }[];
      observacaoFolhaSalarial: string;
    };
    expect(dados.contrachequesEnviados).toBe(4);
    expect(dados.contrachequesPorStatus).toEqual([
      { status: "enviado", quantidade: 3 },
      { status: "falha", quantidade: 1 },
    ]);
    expect(dados.contrachequesPorCompetencia).toEqual([
      { competencia: "2026-08", quantidade: 3 },
      { competencia: "2026-09", quantidade: 1 },
    ]);
    expect(dados.totalFolhaTransporte).toBe(2200);
    expect(dados.funcionariosAtivos).toBe(28);
    expect(dados.porUnidade).toEqual([
      expect.objectContaining({ unidade: "CEC", totalFolhaTransporte: 1500 }),
      expect.objectContaining({ unidade: "CEC Baby", totalFolhaTransporte: 700 }),
    ]);
    // Valor salarial não é persistido (só o PDF é fatiado e enviado).
    expect(dados.observacaoFolhaSalarial).toContain("indisponível");
  });

  it("filtra por unidade e não devolve dado cadastral de funcionário", async () => {
    const { fonte, chamadas } = fonteFake({ contracheques, folhasTransporte, quadro });
    const r = await roda("buscar_folha_rh", { ...intervalo, unidade: "CEC" }, fonte);
    expect(chamadas[0].filtro).toEqual({ unidades: ["CEC"], ...intervalo });
    expect((r.dados as { funcionariosAtivos: number }).funcionariosAtivos).toBe(20);
    expect(JSON.stringify(r.dados)).not.toMatch(/cpf|endereco|endereço|telefone|email|employee/i);
  });
});

describe("listar_consultas_disponiveis", () => {
  it("responde que não existe consulta e lista os temas cobertos", async () => {
    const { fonte, chamadas } = fonteFake({});
    const r = await roda("listar_consultas_disponiveis", { assunto: "previsão do tempo" }, fonte);
    const dados = r.dados as { resposta: string; temas: string[]; instrucao: string };
    expect(dados.resposta).toBe(RESPOSTA_SEM_CONSULTA);
    expect(dados.temas.length).toBeGreaterThanOrEqual(13);
    for (const tema of ["Cantina", "Rematrícula", "Esportes", "Uniformes", "Documentos", "RH"]) {
      expect(dados.temas.join(" | ")).toContain(tema);
    }
    expect(dados.instrucao).toMatch(/não tente responder por conhecimento próprio/);
    // O assunto é só rótulo de auditoria: nenhuma fonte de dados é consultada.
    expect(chamadas).toHaveLength(0);
  });

  it("não aceita o assunto como consulta (nada de SQL nem tabela)", () => {
    for (const args of [
      { assunto: "select * from alunos", tabela: "alunos" },
      { sql: "select 1" },
      { assunto: "" },
    ]) {
      expect(validarChamadaFerramenta("listar_consultas_disponiveis", args).ok).toBe(false);
    }
  });
});

describe("auditoria das ferramentas dos módulos", () => {
  const chamadasModulos: ChamadaFerramenta[] = [
    { nome: "buscar_recargas_cantina", args: periodoAgosto },
    { nome: "buscar_rematricula_material", args: {} },
    { nome: "buscar_esportes_repasses", args: { mesInicio: "2026-08", mesFim: "2026-08" } },
    { nome: "buscar_uniformes_estoque_pedidos", args: periodoAgosto },
    { nome: "buscar_documentos_emitidos", args: periodoAgosto },
    { nome: "buscar_matriculas_alunos_ativos", args: periodoAgosto },
    { nome: "buscar_atendimento_conversas", args: periodoAgosto },
    { nome: "buscar_folha_rh", args: { mesInicio: "2026-08", mesFim: "2026-08" } },
    { nome: "listar_consultas_disponiveis", args: {} },
  ];

  it("toda ferramenta disparada devolve nome, fonte e filtros para o log", async () => {
    const { fonte } = fonteFake({});
    expect(chamadasModulos.map((c) => c.nome)).toEqual([...NOMES_FERRAMENTAS_MODULOS]);
    for (const chamada of chamadasModulos) {
      const r = await executarFerramenta(chamada, fonte, escopo);
      expect(r.ferramenta).toBe(chamada.nome);
      expect(NOMES_FERRAMENTAS).toContain(r.ferramenta);
      expect(r.fonte.length).toBeGreaterThan(0);
      expect(r.erro).toBeUndefined();
    }
  });

  it("ferramenta que falha na leitura ainda identifica qual consulta rodou", async () => {
    const { fonte } = fonteFake({});
    const quebrada = {
      ...fonte,
      async recargasCantina() {
        throw new Error("PostgREST: relação inexistente");
      },
    };
    await expect(
      executarFerramenta(
        { nome: "buscar_recargas_cantina", args: periodoAgosto },
        quebrada,
        escopo,
      ),
    ).rejects.toThrow(/PostgREST/);
  });

  it("recusa unidade fora do escopo em ferramenta de módulo", async () => {
    const { fonte, chamadas } = fonteFake({ cantina: [] });
    const r = await roda(
      "buscar_recargas_cantina",
      { ...periodoAgosto, unidade: "Núcleo Belvedere" },
      fonte,
    );
    expect(r.erro).toContain("fora do escopo");
    expect(chamadas).toHaveLength(0);
  });
});

describe("lançamentos do extrato bancário", () => {
  const junhoAAgosto = { dataInicio: "2026-06-01", dataFim: "2026-08-31" };

  const extrato = [
    lancamento({ data: "2026-06-10", descricao: "CEMIG 06/2026", valor: 900 }),
    lancamento({ data: "2026-07-10", descricao: "CEMIG 07/2026", valor: 1000 }),
    lancamento({ data: "2026-08-10", descricao: "CEMIG 08/2026", valor: 1100 }),
    lancamento({
      data: "2026-08-15",
      descricao: "Vigilância Alfa",
      categoria: "Serviços",
      subcategoria: "Segurança",
      valor: 2000,
    }),
    lancamento({ unidade: "CEC Baby", data: "2026-08-12", descricao: "Copasa", valor: 300 }),
  ];

  it("filtra por unidade e período e agrupa a mesma descrição mês a mês", async () => {
    const { fonte, chamadas } = fonteFake({ extrato });
    const r = await roda(
      "buscar_lancamentos_extrato_bancario",
      { unidade: "CEC", ...junhoAAgosto },
      fonte,
    );
    expect(chamadas.find((c) => c.fn === "lancamentosExtrato")?.filtro).toMatchObject({
      unidades: ["CEC"],
      ...junhoAAgosto,
    });
    const dados = r.dados as {
      quantidadeLancamentos: number;
      totalSaidas: number;
      mesesAnalisados: string[];
      grupos: GrupoExtrato[];
    };
    expect(dados.quantidadeLancamentos).toBe(4);
    expect(dados.totalSaidas).toBe(5000);
    expect(dados.mesesAnalisados).toEqual(["2026-06", "2026-07", "2026-08"]);
    const cemig = dados.grupos.find((g) => g.descricao.startsWith("CEMIG"))!;
    // A numeração da descrição não quebra o agrupamento (CEMIG 06 = CEMIG 07).
    expect(cemig.quantidadeLancamentos).toBe(3);
    expect(cemig.mesesComLancamento).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(cemig.valorTotal).toBe(3000);
    expect(cemig.valorMedio).toBe(1000);
    expect(cemig.recorrenteNoExtrato).toBe(true);
    // Outra unidade não entra no recorte.
    expect(dados.grupos.some((g) => g.unidade === "CEC Baby")).toBe(false);
  });

  it("aponta a saída recorrente do banco que não tem despesa no Fluxo Futuro", async () => {
    const { fonte } = fonteFake({
      extrato,
      // O Fluxo Futuro tem a energia lançada, mas não a vigilância.
      despesas: [
        despesa({ mes: "2026-06-01", descricao: "CEMIG" }),
        despesa({ mes: "2026-07-01", descricao: "CEMIG" }),
        despesa({ mes: "2026-08-01", descricao: "CEMIG" }),
      ],
    });
    const r = await roda("buscar_lancamentos_extrato_bancario", junhoAAgosto, fonte);
    const dados = r.dados as {
      grupos: GrupoExtrato[];
      recorrentesSemFluxoFuturo: GrupoExtrato[];
    };
    expect(dados.grupos.find((g) => g.descricao.startsWith("CEMIG"))!.temDespesaNoFluxoFuturo).toBe(
      true,
    );
    expect(
      dados.grupos.find((g) => g.descricao === "Vigilância Alfa")!.temDespesaNoFluxoFuturo,
    ).toBe(false);
    // Só 1 mês de vigilância no período de 3 meses: não é recorrente ainda.
    expect(dados.recorrentesSemFluxoFuturo).toEqual([]);

    const { fonte: fonte2 } = fonteFake({
      extrato: [
        lancamento({ data: "2026-06-15", descricao: "Vigilância Alfa", valor: 2000 }),
        lancamento({ data: "2026-07-15", descricao: "Vigilância Alfa", valor: 2000 }),
        lancamento({ data: "2026-08-15", descricao: "Vigilância Alfa", valor: 2000 }),
      ],
      despesas: [],
    });
    const r2 = await roda("buscar_lancamentos_extrato_bancario", junhoAAgosto, fonte2);
    const dados2 = r2.dados as { recorrentesSemFluxoFuturo: GrupoExtrato[] };
    expect(dados2.recorrentesSemFluxoFuturo.map((g) => g.descricao)).toEqual(["Vigilância Alfa"]);
  });

  it("aceita minimoMeses e filtro de descrição, e informa a fonte", async () => {
    const { fonte } = fonteFake({ extrato });
    const r = await roda(
      "buscar_lancamentos_extrato_bancario",
      { ...junhoAAgosto, descricao: "vigilancia", minimoMeses: 1 },
      fonte,
    );
    const dados = r.dados as { grupos: GrupoExtrato[]; minimoMesesRecorrencia: number };
    expect(dados.minimoMesesRecorrencia).toBe(1);
    expect(dados.grupos.map((g) => g.descricao)).toEqual(["Vigilância Alfa"]);
    expect(dados.grupos[0].recorrenteNoExtrato).toBe(true);
    expect(r.fonte).toContain("Extrato bancário");
  });

  it("não aceita SQL, tabela nem argumento extra", () => {
    expect(
      validarChamadaFerramenta("buscar_lancamentos_extrato_bancario", {
        ...junhoAAgosto,
        sql: "select * from transactions",
      }).ok,
    ).toBe(false);
    expect(
      validarChamadaFerramenta("buscar_lancamentos_extrato_bancario", { dataInicio: "2026-08-01" })
        .ok,
    ).toBe(false);
  });
});

describe("roteamento obrigatório de consulta por assunto", () => {
  const perguntas = [
    "Quais despesas aparecem todo mês no extrato bancário, nas unidades do Vale do Sereno e Belvedere, mas não aparecem no fluxo futuro?",
    "o que saiu da conta em agosto?",
    "me mostra o extrato de julho",
    "quais lançamentos do banco não estão categorizados?",
    "quanto foi debitado da conta bancária em julho?",
  ];

  it("perguntas sobre extrato bancário exigem buscar_lancamentos_extrato_bancario", () => {
    for (const pergunta of perguntas) {
      expect(ferramentaObrigatoriaPara(pergunta)).toBe("buscar_lancamentos_extrato_bancario");
      const prompt = montarSystemPrompt(escopo, pergunta);
      expect(prompt).toContain("CONSULTA OBRIGATÓRIA NESTA PERGUNTA");
      expect(prompt).toContain("buscar_lancamentos_extrato_bancario");
    }
  });

  it("não impõe consulta a pergunta de outro assunto", () => {
    expect(ferramentaObrigatoriaPara("como está a inadimplência do trimestre?")).toBeNull();
    expect(montarSystemPrompt(escopo, "como está a inadimplência do trimestre?")).not.toContain(
      "CONSULTA OBRIGATÓRIA",
    );
  });

  it("o prompt separa o extrato do cadastro de despesas recorrentes", () => {
    const prompt = montarSystemPrompt(escopo);
    expect(prompt).toContain("`comparar_despesas_recorrentes` NÃO lê o extrato");
  });
});
