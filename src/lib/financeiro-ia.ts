// Análises com IA do Financeiro — camada pura (sem I/O).
//
// ARQUITETURA: a IA não responde por conhecimento próprio. Ela só escolhe uma
// ferramenta de uma lista FECHADA (`FERRAMENTAS_ANALISE`), o servidor executa a
// consulta real e devolve o resultado; só então a IA escreve o texto. Não existe
// ferramenta de SQL livre: qualquer consulta nova é um item novo desta lista.
//
// ESCOPO DE DADOS: nenhuma ferramenta devolve dado cadastral (nome, CPF,
// endereço, telefone) de aluno ou responsável. Inadimplência sai agregada por
// unidade/período — quantidade de boletos e valores, nunca quem deve.

import { z } from "zod";

// ─── Filtros e registros das fontes reais ────────────────────────────────────

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES_ISO = /^\d{4}-\d{2}$/;

export type StatusDespesa = "pending" | "scheduled" | "paid";

export type DespesaFluxo = {
  unidade: string;
  // Competência da despesa no Fluxo Futuro (YYYY-MM-DD, sempre dia 1).
  mes: string;
  descricao: string;
  categoria: string;
  subcategoria: string;
  valor: number;
  status: StatusDespesa;
  recorrente: boolean;
};

export type ReceitaRealizada = {
  unidade: string;
  data: string;
  categoria: string;
  subcategoria: string;
  valor: number;
};

export type ReceitaPrevista = {
  unidade: string;
  mes: string;
  quantidadeBoletos: number;
  valor: number;
};

export type SerieRecorrente = {
  unidade: string;
  descricao: string;
  categoria: string;
  subcategoria: string;
  valor: number;
  mesInicio: string;
  mesFim: string | null;
  mesesPulados: string[];
};

export type InadimplenciaAgregada = {
  unidade: string;
  quantidadeBoletos: number;
  quantidadeParcelas: number;
  valorTotal: number;
  valorAcordo: number;
};

export type FiltroPeriodo = {
  unidades: string[];
  dataInicio: string;
  dataFim: string;
  categoria?: string;
  subcategoria?: string;
};

// Fonte de dados injetada: em produção lê Supabase/Sponte; nos testes é um
// dublê. Manter a execução das ferramentas dependente só desta interface é o que
// permite testar cada consulta sem banco.
export interface FonteDadosFinanceiros {
  despesasFluxo(filtro: FiltroPeriodo): Promise<DespesaFluxo[]>;
  receitasRealizadas(filtro: FiltroPeriodo): Promise<ReceitaRealizada[]>;
  receitasPrevistas(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<ReceitaPrevista[]>;
  seriesRecorrentes(filtro: { unidades: string[] }): Promise<SerieRecorrente[]>;
  inadimplencia(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<InadimplenciaAgregada[]>;
}

export type EscopoAnalise = {
  // Unidades que o usuário autenticado pode ler (RBAC por unidade).
  unidadesPermitidas: string[];
  // Hoje em YYYY-MM-DD (fuso da escola), para a IA situar "mês atual".
  hoje: string;
};

// ─── Lista fechada de ferramentas ────────────────────────────────────────────

const FiltrosBase = {
  unidade: z.string().trim().min(1).max(80).optional(),
  categoria: z.string().trim().min(1).max(80).optional(),
  subcategoria: z.string().trim().min(1).max(80).optional(),
  dataInicio: z.string().regex(DATA_ISO),
  dataFim: z.string().regex(DATA_ISO),
};

// Janela máxima de cada consulta. O limite curto das consultas que passam pelo
// Sponte (uma chamada SOAP por dia de vencimento) é o que impede uma pergunta
// ampla de estourar o tempo da função serverless.
const JANELA_BANCO_DIAS = 731;
const JANELA_SPONTE_DIAS = 92;

function diasEntre(inicio: string, fim: string): number {
  return (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000;
}

function janela<T extends { dataInicio: string; dataFim: string }>(maxDias: number) {
  return (args: T, ctx: z.RefinementCtx) => {
    const dias = diasEntre(args.dataInicio, args.dataFim);
    if (dias < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dataFim é anterior a dataInicio",
        path: ["dataFim"],
      });
      return;
    }
    if (dias > maxDias) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `intervalo de ${Math.round(dias)} dias excede o máximo de ${maxDias} dias desta consulta; divida a pergunta em períodos menores`,
        path: ["dataFim"],
      });
    }
  };
}

export const DespesasFluxoArgsSchema = z
  .object({
    ...FiltrosBase,
    situacao: z.enum(["previstas", "pagas", "todas"]).optional(),
  })
  .strict()
  .superRefine(janela(JANELA_BANCO_DIAS));

export const ReceitasArgsSchema = z
  .object({
    ...FiltrosBase,
    situacao: z.enum(["previstas", "realizadas", "todas"]).optional(),
  })
  .strict()
  .superRefine(janela(JANELA_SPONTE_DIAS));

export const DivergenciasRecorrentesArgsSchema = z
  .object({
    unidade: z.string().trim().min(1).max(80).optional(),
    // Mês de referência (YYYY-MM) do qual se olha para trás; o padrão é o mês
    // corrente do servidor.
    mesReferencia: z.string().regex(MES_ISO).optional(),
  })
  .strict();

export const InadimplenciaArgsSchema = z
  .object({
    unidade: z.string().trim().min(1).max(80).optional(),
    dataInicio: z.string().regex(DATA_ISO),
    dataFim: z.string().regex(DATA_ISO),
  })
  .strict()
  .superRefine(janela(JANELA_SPONTE_DIAS));

export const SaldoProjetadoArgsSchema = z
  .object({
    unidade: z.string().trim().min(1).max(80).optional(),
    mesInicio: z.string().regex(MES_ISO),
    mesFim: z.string().regex(MES_ISO),
  })
  .strict()
  .superRefine((args, ctx) => {
    const meses = mesesDoIntervalo(args.mesInicio, args.mesFim);
    if (meses.length === 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mesFim é anterior a mesInicio",
        path: ["mesFim"],
      });
    else if (meses.length > 3)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "o saldo projetado aceita no máximo 3 meses por consulta (as receitas previstas vêm do Sponte); consulte em blocos de até 3 meses",
        path: ["mesFim"],
      });
  });

export const NOMES_FERRAMENTAS = [
  "buscar_despesas_fluxo_futuro",
  "buscar_receitas",
  "comparar_despesas_recorrentes",
  "buscar_inadimplencia",
  "calcular_saldo_projetado",
] as const;

export type NomeFerramenta = (typeof NOMES_FERRAMENTAS)[number];

export type DefinicaoFerramenta = {
  nome: NomeFerramenta;
  descricao: string;
  // Schema JSON enviado à Anthropic (documentação dos argumentos).
  schemaJson: Record<string, unknown>;
};

const propsPeriodo = {
  unidade: {
    type: "string",
    description:
      "Nome exato da unidade (ex.: CEC, CEC Baby, Núcleo Belvedere, Núcleo Vale do Sereno). Omita para consultar todas as unidades permitidas ao usuário.",
  },
  categoria: { type: "string", description: "Nome da categoria (centro de custo)." },
  subcategoria: { type: "string", description: "Nome da subcategoria." },
  dataInicio: { type: "string", description: "Início do intervalo, em YYYY-MM-DD." },
  dataFim: { type: "string", description: "Fim do intervalo, em YYYY-MM-DD." },
};

export const FERRAMENTAS_ANALISE: DefinicaoFerramenta[] = [
  {
    nome: "buscar_despesas_fluxo_futuro",
    descricao:
      "Despesas do Fluxo Futuro (previstas, agendadas e pagas), filtradas por unidade, categoria, subcategoria e intervalo de datas.",
    schemaJson: {
      type: "object",
      properties: {
        ...propsPeriodo,
        situacao: {
          type: "string",
          enum: ["previstas", "pagas", "todas"],
          description:
            "previstas = ainda não pagas (pendentes/agendadas); pagas = já quitadas; todas = ambas. Padrão: todas.",
        },
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_receitas",
    descricao:
      "Receitas previstas (parcelas em aberto no Sponte) e realizadas (entradas conciliadas no extrato), filtradas por unidade, categoria, subcategoria e intervalo de datas. As receitas realizadas saem agregadas por categoria/subcategoria e mês.",
    schemaJson: {
      type: "object",
      properties: {
        ...propsPeriodo,
        situacao: {
          type: "string",
          enum: ["previstas", "realizadas", "todas"],
          description: "Padrão: todas.",
        },
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "comparar_despesas_recorrentes",
    descricao:
      "Compara as despesas cadastradas como recorrentes (séries fixas) com o que de fato apareceu no Fluxo Futuro nos últimos 3 meses, apontando recorrente cadastrada e ausente no mês e despesa que se repete todo mês sem estar cadastrada como recorrente.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propsPeriodo.unidade,
        mesReferencia: {
          type: "string",
          description: "Mês final da janela de 3 meses, em YYYY-MM. Padrão: mês atual.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_inadimplencia",
    descricao:
      "Inadimplência agregada por unidade e período (quantidade de boletos/parcelas em aberto e valores, inclusive o valor renegociado em acordo). Não devolve nome, CPF nem qualquer dado de aluno ou responsável.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propsPeriodo.unidade,
        dataInicio: propsPeriodo.dataInicio,
        dataFim: propsPeriodo.dataFim,
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "calcular_saldo_projetado",
    descricao:
      "Saldo projetado (receitas previstas − despesas previstas) por unidade e por mês, no intervalo de meses informado.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propsPeriodo.unidade,
        mesInicio: { type: "string", description: "Primeiro mês do intervalo, em YYYY-MM." },
        mesFim: { type: "string", description: "Último mês do intervalo, em YYYY-MM." },
      },
      required: ["mesInicio", "mesFim"],
      additionalProperties: false,
    },
  },
];

export type ChamadaFerramenta =
  | { nome: "buscar_despesas_fluxo_futuro"; args: z.infer<typeof DespesasFluxoArgsSchema> }
  | { nome: "buscar_receitas"; args: z.infer<typeof ReceitasArgsSchema> }
  | {
      nome: "comparar_despesas_recorrentes";
      args: z.infer<typeof DivergenciasRecorrentesArgsSchema>;
    }
  | { nome: "buscar_inadimplencia"; args: z.infer<typeof InadimplenciaArgsSchema> }
  | { nome: "calcular_saldo_projetado"; args: z.infer<typeof SaldoProjetadoArgsSchema> };

export type ValidacaoChamada =
  | { ok: true; chamada: ChamadaFerramenta }
  | { ok: false; erro: string };

// Porta de entrada única das chamadas do modelo: nome na allowlist e argumentos
// no schema estrito da ferramenta. Nome desconhecido, argumento extra ou tipo
// errado são recusados aqui — nada chega à execução.
export function validarChamadaFerramenta(nome: string, args: unknown): ValidacaoChamada {
  if (!(NOMES_FERRAMENTAS as readonly string[]).includes(nome)) {
    return {
      ok: false,
      erro: `Ferramenta "${nome}" não existe. Só estas consultas estão disponíveis: ${NOMES_FERRAMENTAS.join(", ")}.`,
    };
  }
  const schema = {
    buscar_despesas_fluxo_futuro: DespesasFluxoArgsSchema,
    buscar_receitas: ReceitasArgsSchema,
    comparar_despesas_recorrentes: DivergenciasRecorrentesArgsSchema,
    buscar_inadimplencia: InadimplenciaArgsSchema,
    calcular_saldo_projetado: SaldoProjetadoArgsSchema,
  }[nome as NomeFerramenta];

  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    const detalhe = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, erro: `Argumentos inválidos para "${nome}" — ${detalhe}.` };
  }
  return { ok: true, chamada: { nome, args: parsed.data } as ChamadaFerramenta };
}

// ─── Utilitários de período ──────────────────────────────────────────────────

export function competencia(dataISO: string): string {
  return dataISO.slice(0, 7);
}

export function mesesDoIntervalo(mesInicio: string, mesFim: string): string[] {
  if (mesFim < mesInicio) return [];
  const meses: string[] = [];
  let [ano, mes] = mesInicio.split("-").map(Number);
  const limite = mesFim;
  // Teto defensivo de 36 meses: evita que um intervalo absurdo vire uma consulta
  // gigante ao Sponte.
  while (meses.length < 36) {
    const atual = `${ano}-${String(mes).padStart(2, "0")}`;
    if (atual > limite) break;
    meses.push(atual);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

export function primeiroDiaDoMes(mes: string): string {
  return `${mes}-01`;
}

export function ultimoDiaDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const dia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

export function mesAnterior(mes: string, delta: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const total = ano * 12 + (m - 1) - delta;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  return `${novoAno}-${String(novoMes).padStart(2, "0")}`;
}

function arred(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function chaveDescricao(descricao: string): string {
  return descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\d+/g, " ")
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

// ─── Resolução de unidades (RBAC) ────────────────────────────────────────────

export type ResolucaoUnidades = { ok: true; unidades: string[] } | { ok: false; erro: string };

// Uma unidade pedida fora da permissão do usuário não é silenciosamente ignorada
// nem substituída pelo consolidado: a ferramenta devolve erro, e a IA precisa
// dizer isso na resposta.
export function resolverUnidades(
  pedida: string | undefined,
  escopo: EscopoAnalise,
): ResolucaoUnidades {
  if (!pedida) return { ok: true, unidades: [...escopo.unidadesPermitidas] };
  const alvo = escopo.unidadesPermitidas.find(
    (u) => u.toLowerCase() === pedida.trim().toLowerCase(),
  );
  if (!alvo) {
    return {
      ok: false,
      erro: `Unidade "${pedida}" fora do escopo permitido para este usuário. Unidades disponíveis: ${escopo.unidadesPermitidas.join(", ") || "nenhuma"}.`,
    };
  }
  return { ok: true, unidades: [alvo] };
}

// ─── Agregações ──────────────────────────────────────────────────────────────

const LIMITE_LINHAS = 120;

export type LinhaDespesa = {
  unidade: string;
  mes: string;
  descricao: string;
  categoria: string;
  subcategoria: string;
  valor: number;
  status: StatusDespesa;
  recorrente: boolean;
};

export function agregarDespesas(despesas: DespesaFluxo[]) {
  const previsto = despesas.filter((d) => d.status !== "paid");
  const pago = despesas.filter((d) => d.status === "paid");
  const porCategoria = new Map<
    string,
    { categoria: string; subcategoria: string; valor: number }
  >();
  for (const d of despesas) {
    const chave = `${d.categoria}|${d.subcategoria}`;
    const atual = porCategoria.get(chave) ?? {
      categoria: d.categoria,
      subcategoria: d.subcategoria,
      valor: 0,
    };
    atual.valor = arred(atual.valor + d.valor);
    porCategoria.set(chave, atual);
  }
  const itens: LinhaDespesa[] = despesas
    .slice()
    .sort((a, b) => a.mes.localeCompare(b.mes) || b.valor - a.valor)
    .slice(0, LIMITE_LINHAS);
  return {
    quantidade: despesas.length,
    totalPrevisto: arred(previsto.reduce((s, d) => s + d.valor, 0)),
    totalPago: arred(pago.reduce((s, d) => s + d.valor, 0)),
    porCategoria: [...porCategoria.values()].sort((a, b) => b.valor - a.valor),
    itens,
    truncado: despesas.length > itens.length,
  };
}

// Receitas realizadas saem SEM descrição: a descrição do extrato bancário pode
// carregar o nome do pagador, e nome de responsável está fora do escopo.
export function agregarReceitasRealizadas(receitas: ReceitaRealizada[]) {
  const porMes = new Map<
    string,
    { mes: string; unidade: string; categoria: string; subcategoria: string; valor: number }
  >();
  for (const r of receitas) {
    const mes = competencia(r.data);
    const chave = `${r.unidade}|${mes}|${r.categoria}|${r.subcategoria}`;
    const atual = porMes.get(chave) ?? {
      mes,
      unidade: r.unidade,
      categoria: r.categoria,
      subcategoria: r.subcategoria,
      valor: 0,
    };
    atual.valor = arred(atual.valor + r.valor);
    porMes.set(chave, atual);
  }
  const linhas = [...porMes.values()].sort(
    (a, b) => a.mes.localeCompare(b.mes) || b.valor - a.valor,
  );
  return {
    total: arred(receitas.reduce((s, r) => s + r.valor, 0)),
    quantidadeLancamentos: receitas.length,
    porMesCategoria: linhas.slice(0, LIMITE_LINHAS),
    truncado: linhas.length > LIMITE_LINHAS,
  };
}

export function agregarReceitasPrevistas(previstas: ReceitaPrevista[]) {
  return {
    total: arred(previstas.reduce((s, r) => s + r.valor, 0)),
    quantidadeBoletos: previstas.reduce((s, r) => s + r.quantidadeBoletos, 0),
    porUnidadeMes: previstas
      .slice()
      .sort((a, b) => a.mes.localeCompare(b.mes) || a.unidade.localeCompare(b.unidade)),
  };
}

export function agregarInadimplencia(linhas: InadimplenciaAgregada[]) {
  return {
    totalEmAberto: arred(linhas.reduce((s, l) => s + l.valorTotal, 0)),
    totalSemAcordos: arred(linhas.reduce((s, l) => s + (l.valorTotal - l.valorAcordo), 0)),
    quantidadeBoletos: linhas.reduce((s, l) => s + l.quantidadeBoletos, 0),
    quantidadeParcelas: linhas.reduce((s, l) => s + l.quantidadeParcelas, 0),
    porUnidade: linhas
      .slice()
      .sort((a, b) => b.valorTotal - a.valorTotal)
      .map((l) => ({
        unidade: l.unidade,
        quantidadeBoletos: l.quantidadeBoletos,
        quantidadeParcelas: l.quantidadeParcelas,
        valorEmAberto: arred(l.valorTotal),
        valorRenegociadoAcordo: arred(l.valorAcordo),
      })),
  };
}

export type DivergenciaRecorrencia = {
  cadastradasAusentes: {
    unidade: string;
    descricao: string;
    categoria: string;
    valorCadastrado: number;
    mesesAusentes: string[];
  }[];
  recorrentesNaoCadastradas: {
    unidade: string;
    descricao: string;
    categoria: string;
    mesesPresentes: string[];
    valorMedio: number;
  }[];
  mesesAnalisados: string[];
};

// Divergência de recorrência nos meses informados, nos dois sentidos:
// cadastrada como fixa mas sem lançamento no mês, e lançamento repetido em
// todos os meses sem estar cadastrado como fixo. Meses explicitamente pulados na
// série (skipped_months) não contam como ausência.
export function compararRecorrentes(
  series: SerieRecorrente[],
  despesas: DespesaFluxo[],
  meses: string[],
): DivergenciaRecorrencia {
  const lancadas = new Map<
    string,
    { meses: Set<string>; valores: number[]; recorrente: boolean }
  >();
  for (const d of despesas) {
    const mes = competencia(d.mes);
    if (!meses.includes(mes)) continue;
    const chave = `${d.unidade}|${chaveDescricao(d.descricao)}`;
    const atual = lancadas.get(chave) ?? {
      meses: new Set<string>(),
      valores: [],
      recorrente: false,
    };
    atual.meses.add(mes);
    atual.valores.push(d.valor);
    atual.recorrente = atual.recorrente || d.recorrente;
    lancadas.set(chave, atual);
  }

  const cadastradasAusentes: DivergenciaRecorrencia["cadastradasAusentes"] = [];
  const chavesCadastradas = new Set<string>();
  for (const s of series) {
    const chave = `${s.unidade}|${chaveDescricao(s.descricao)}`;
    chavesCadastradas.add(chave);
    const presente = lancadas.get(chave)?.meses ?? new Set<string>();
    const pulados = new Set(s.mesesPulados.map(competencia));
    const ausentes = meses.filter((m) => {
      if (presente.has(m) || pulados.has(m)) return false;
      if (m < competencia(s.mesInicio)) return false;
      if (s.mesFim && m > competencia(s.mesFim)) return false;
      return true;
    });
    if (ausentes.length > 0) {
      cadastradasAusentes.push({
        unidade: s.unidade,
        descricao: s.descricao,
        categoria: s.categoria,
        valorCadastrado: arred(s.valor),
        mesesAusentes: ausentes,
      });
    }
  }

  const descricaoDe = new Map<string, { descricao: string; categoria: string }>();
  for (const d of despesas) {
    const chave = `${d.unidade}|${chaveDescricao(d.descricao)}`;
    if (!descricaoDe.has(chave))
      descricaoDe.set(chave, { descricao: d.descricao, categoria: d.categoria });
  }

  const recorrentesNaoCadastradas: DivergenciaRecorrencia["recorrentesNaoCadastradas"] = [];
  for (const [chave, dados] of lancadas) {
    if (chavesCadastradas.has(chave) || dados.recorrente) continue;
    // Padrão de recorrência: presente em TODOS os meses da janela (mínimo 2).
    if (meses.length < 2 || dados.meses.size < meses.length) continue;
    const info = descricaoDe.get(chave);
    recorrentesNaoCadastradas.push({
      unidade: chave.split("|")[0],
      descricao: info?.descricao ?? "",
      categoria: info?.categoria ?? "",
      mesesPresentes: [...dados.meses].sort(),
      valorMedio: arred(dados.valores.reduce((s, v) => s + v, 0) / dados.valores.length),
    });
  }

  return {
    cadastradasAusentes: cadastradasAusentes.sort((a, b) => a.descricao.localeCompare(b.descricao)),
    recorrentesNaoCadastradas: recorrentesNaoCadastradas.sort(
      (a, b) => b.valorMedio - a.valorMedio,
    ),
    mesesAnalisados: [...meses],
  };
}

export type LinhaSaldo = {
  unidade: string;
  mes: string;
  receitasPrevistas: number;
  despesasPrevistas: number;
  saldoProjetado: number;
};

// Saldo projetado = receitas previstas (parcelas em aberto no Sponte) − despesas
// previstas do Fluxo Futuro (o que ainda não foi pago), por unidade e mês.
export function calcularSaldoProjetado(
  receitas: ReceitaPrevista[],
  despesas: DespesaFluxo[],
  unidades: string[],
  meses: string[],
): LinhaSaldo[] {
  const linhas: LinhaSaldo[] = [];
  for (const unidade of unidades) {
    for (const mes of meses) {
      const receita = receitas
        .filter((r) => r.unidade === unidade && competencia(r.mes) === mes)
        .reduce((s, r) => s + r.valor, 0);
      const despesa = despesas
        .filter((d) => d.unidade === unidade && competencia(d.mes) === mes && d.status !== "paid")
        .reduce((s, d) => s + d.valor, 0);
      linhas.push({
        unidade,
        mes,
        receitasPrevistas: arred(receita),
        despesasPrevistas: arred(despesa),
        saldoProjetado: arred(receita - despesa),
      });
    }
  }
  return linhas;
}

// ─── Execução das ferramentas ────────────────────────────────────────────────

export type ResultadoFerramenta = {
  ferramenta: NomeFerramenta;
  fonte: string;
  filtros: Record<string, string>;
  erro?: string;
  dados?: unknown;
};

function filtrosTexto(args: Record<string, unknown>, unidades: string[]): Record<string, string> {
  const filtros: Record<string, string> = { unidades: unidades.join(", ") || "nenhuma" };
  for (const [k, v] of Object.entries(args)) {
    if (k === "unidade" || v === undefined) continue;
    filtros[k] = String(v);
  }
  return filtros;
}

export async function executarFerramenta(
  chamada: ChamadaFerramenta,
  fonte: FonteDadosFinanceiros,
  escopo: EscopoAnalise,
): Promise<ResultadoFerramenta> {
  const unidadesPedidas = resolverUnidades(chamada.args.unidade, escopo);
  if (!unidadesPedidas.ok) {
    return {
      ferramenta: chamada.nome,
      fonte: "—",
      filtros: { unidade: chamada.args.unidade ?? "" },
      erro: unidadesPedidas.erro,
    };
  }
  const unidades = unidadesPedidas.unidades;
  const filtros = filtrosTexto(chamada.args as Record<string, unknown>, unidades);

  switch (chamada.nome) {
    case "buscar_despesas_fluxo_futuro": {
      const { dataInicio, dataFim, categoria, subcategoria, situacao = "todas" } = chamada.args;
      const despesas = await fonte.despesasFluxo({
        unidades,
        dataInicio,
        dataFim,
        categoria,
        subcategoria,
      });
      const filtradas = despesas.filter((d) =>
        situacao === "todas"
          ? true
          : situacao === "pagas"
            ? d.status === "paid"
            : d.status !== "paid",
      );
      return {
        ferramenta: chamada.nome,
        fonte: "Fluxo Futuro (despesas previstas/agendadas/pagas do School Hub)",
        filtros,
        dados: agregarDespesas(filtradas),
      };
    }
    case "buscar_receitas": {
      const { dataInicio, dataFim, categoria, subcategoria, situacao = "todas" } = chamada.args;
      const querPrevistas = situacao === "todas" || situacao === "previstas";
      const querRealizadas = situacao === "todas" || situacao === "realizadas";
      const [previstas, realizadas] = await Promise.all([
        querPrevistas
          ? fonte.receitasPrevistas({ unidades, dataInicio, dataFim })
          : Promise.resolve([]),
        querRealizadas
          ? fonte.receitasRealizadas({ unidades, dataInicio, dataFim, categoria, subcategoria })
          : Promise.resolve([]),
      ]);
      return {
        ferramenta: chamada.nome,
        fonte:
          "Receitas previstas: parcelas em aberto no Sponte. Receitas realizadas: entradas do extrato bancário conciliadas no School Hub (agregadas, sem descrição do pagador)",
        filtros,
        dados: {
          previstas: querPrevistas ? agregarReceitasPrevistas(previstas) : null,
          realizadas: querRealizadas ? agregarReceitasRealizadas(realizadas) : null,
        },
      };
    }
    case "comparar_despesas_recorrentes": {
      const mesReferencia = chamada.args.mesReferencia ?? competencia(escopo.hoje);
      const meses = [2, 1, 0].map((d) => mesAnterior(mesReferencia, d));
      const [series, despesas] = await Promise.all([
        fonte.seriesRecorrentes({ unidades }),
        fonte.despesasFluxo({
          unidades,
          dataInicio: primeiroDiaDoMes(meses[0]),
          dataFim: ultimoDiaDoMes(meses[meses.length - 1]),
        }),
      ]);
      return {
        ferramenta: chamada.nome,
        fonte:
          "Cadastro de despesas fixas (recorrentes) × lançamentos do Fluxo Futuro nos 3 meses da janela",
        filtros: { ...filtros, mesesAnalisados: meses.join(", ") },
        dados: compararRecorrentes(series, despesas, meses),
      };
    }
    case "buscar_inadimplencia": {
      const { dataInicio, dataFim } = chamada.args;
      const linhas = await fonte.inadimplencia({ unidades, dataInicio, dataFim });
      return {
        ferramenta: chamada.nome,
        fonte: "Inadimplência do Sponte (boletos em aberto por vencimento), agregada por unidade",
        filtros,
        dados: agregarInadimplencia(linhas),
      };
    }
    case "calcular_saldo_projetado": {
      const { mesInicio, mesFim } = chamada.args;
      const meses = mesesDoIntervalo(mesInicio, mesFim);
      if (meses.length === 0) {
        return {
          ferramenta: chamada.nome,
          fonte: "—",
          filtros,
          erro: "Intervalo de meses inválido: mesFim é anterior a mesInicio.",
        };
      }
      const dataInicio = primeiroDiaDoMes(meses[0]);
      const dataFim = ultimoDiaDoMes(meses[meses.length - 1]);
      const [receitas, despesas] = await Promise.all([
        fonte.receitasPrevistas({ unidades, dataInicio, dataFim }),
        fonte.despesasFluxo({ unidades, dataInicio, dataFim }),
      ]);
      const linhas = calcularSaldoProjetado(receitas, despesas, unidades, meses);
      return {
        ferramenta: chamada.nome,
        fonte:
          "Receitas previstas do Sponte − despesas previstas do Fluxo Futuro (despesas pagas não entram)",
        filtros,
        dados: {
          linhas,
          totalReceitasPrevistas: arred(linhas.reduce((s, l) => s + l.receitasPrevistas, 0)),
          totalDespesasPrevistas: arred(linhas.reduce((s, l) => s + l.despesasPrevistas, 0)),
          saldoTotal: arred(linhas.reduce((s, l) => s + l.saldoProjetado, 0)),
        },
      };
    }
  }
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

export function montarSystemPrompt(escopo: EscopoAnalise): string {
  return [
    "Você é o analista financeiro do School Hub, um sistema de gestão de colégios brasileiros.",
    "Responda SEMPRE em português do Brasil.",
    "",
    "REGRA CENTRAL: você não sabe nada sobre as finanças desta escola por conhecimento próprio.",
    "Todo número que você escrever precisa ter vindo do resultado de uma das ferramentas desta conversa.",
    "Se a pergunta não puder ser respondida com as ferramentas disponíveis, diga exatamente o que falta",
    "e que essa consulta ainda não está liberada — nunca estime, complete ou invente valores.",
    "",
    `Hoje é ${escopo.hoje}. Unidades que este usuário pode consultar: ${escopo.unidadesPermitidas.join(", ") || "nenhuma"}.`,
    "Quando a pergunta não indicar a unidade, consulte todas as permitidas e diga isso na resposta.",
    "",
    "AO RESPONDER:",
    "- deixe explícito de onde vêm os números: unidade, período e a fonte informada no campo `fonte` do resultado;",
    "- use uma tabela em markdown (com | ) quando houver várias linhas comparáveis;",
    "- trate os valores como o que o sistema registrou até agora, não como verdade absoluta, e aponte quando o dado parecer incompleto;",
    "- não peça nem mencione dados de aluno ou responsável (nome, CPF, endereço, telefone): eles não estão disponíveis para esta análise;",
    "- seja objetivo: no máximo alguns parágrafos curtos mais a tabela, quando fizer sentido.",
  ].join("\n");
}

// ─── Renderização da resposta (texto + tabelas markdown) ─────────────────────

export type BlocoResposta =
  | { tipo: "texto"; texto: string }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] };

function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function separadorDeTabela(linha: string): boolean {
  return /^\|?[\s:-]+\|[\s:|-]*$/.test(linha.trim()) && linha.includes("-");
}

// A resposta da IA vem em markdown simples. Só tabelas de pipe são interpretadas;
// o resto é exibido como texto, sem HTML.
export function dividirResposta(texto: string): BlocoResposta[] {
  const blocos: BlocoResposta[] = [];
  const linhas = texto.split("\n");
  let buffer: string[] = [];

  const fecharTexto = () => {
    const conteudo = buffer.join("\n").trim();
    if (conteudo) blocos.push({ tipo: "texto", texto: conteudo });
    buffer = [];
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const proxima = linhas[i + 1] ?? "";
    const iniciaTabela =
      linha.trim().startsWith("|") && linha.includes("|", 1) && separadorDeTabela(proxima);
    if (!iniciaTabela) {
      buffer.push(linha);
      continue;
    }
    fecharTexto();
    const cabecalho = celulas(linha);
    const corpo: string[][] = [];
    i += 2;
    while (i < linhas.length && linhas[i].trim().startsWith("|")) {
      corpo.push(celulas(linhas[i]));
      i += 1;
    }
    i -= 1;
    blocos.push({ tipo: "tabela", cabecalho, linhas: corpo });
  }
  fecharTexto();
  return blocos;
}
