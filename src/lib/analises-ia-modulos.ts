// Análises com IA — ferramentas dos módulos operacionais (camada pura, sem I/O).
//
// Extensão da lista FECHADA das Análises com IA do Financeiro
// (`financeiro-ia.ts`) para os demais módulos do School Hub. A arquitetura é a
// mesma: a IA só escolhe um nome desta lista, o servidor executa a consulta real
// pela `FonteDadosModulos` e devolve um agregado; não existe ferramenta de SQL
// livre e nenhum argumento aceita consulta, tabela ou código.
//
// ESCOPO DE DADOS: nenhuma ferramenta aqui devolve dado cadastral de aluno,
// responsável ou funcionário (nome, CPF, endereço, telefone, email) nem corpo de
// mensagem. Tudo sai como contagem, soma ou rótulo de turma/modalidade/produto.

import { z } from "zod";
import { STATUS_RECARGA_LABEL, type StatusRecarga } from "./cantina";
import {
  STATUS_ACOMPANHAMENTO_LABEL,
  type StatusAcompanhamento,
} from "./rematricula-acompanhamento";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES_ISO = /^\d{4}-\d{2}$/;

// ─── Registros das fontes reais ──────────────────────────────────────────────

export type RecargaCantinaIA = {
  unidade: string;
  // Data da solicitação (YYYY-MM-DD).
  data: string;
  status: StatusRecarga;
  valor: number;
};

export type LinhaRematriculaIA = {
  unidade: string;
  status: StatusAcompanhamento;
  // Parcelamento escolhido (1 a 8); null enquanto o responsável não escolheu.
  parcelas: number | null;
  valorAnual: number | null;
  anoLetivo: number | null;
};

export type RepasseEsporteIA = {
  unidade: string;
  modalidade: string;
  parceiro: string;
  tipoRepasse: "percentual" | "fixo";
  // Mês de referência do repasse (YYYY-MM).
  mesReferencia: string;
  valorArrecadado: number;
  valorRepasse: number;
  valorRetido: number;
  pago: boolean;
};

export type TurmaEsporteIA = {
  unidade: string;
  modalidade: string;
  turma: string;
  quantidadeAlunos: number;
};

export type ItemEstoqueUniformeIA = {
  loja: string;
  produto: string;
  tamanho: string;
  estoque: number;
  estoqueMinimo: number;
  pedidoRealizado: boolean;
};

export type PedidoUniformeIA = {
  loja: string;
  produto: string;
  tamanho: string;
  quantidade: number;
  receita: number;
};

export type TipoDocumentoIA =
  | "recibo"
  | "declaracao_debitos"
  | "declaracao_ir"
  | "termo_confissao_divida";

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumentoIA, string> = {
  recibo: "Recibo",
  declaracao_debitos: "Declaração de Inexistência de Débitos",
  declaracao_ir: "Declaração de Imposto de Renda",
  termo_confissao_divida: "Termo de Confissão de Dívida",
};

export type DocumentoEmitidoIA = {
  unidade: string;
  tipo: TipoDocumentoIA;
  data: string;
  valorTotal: number;
};

export type SubmissaoMatriculaIA = {
  unidade: string;
  // Status da submissão pública: "sucesso" é a matrícula confirmada no Sponte.
  status: string;
  data: string;
};

export type TurmaAtivosIA = {
  unidade: string;
  turma: string;
  quantidadeAlunos: number;
};

export type ConversaAtendimentoIA = {
  unidade: string;
  data: string;
  mensagensRecebidas: number;
  mensagensEnviadas: number;
  // Minutos entre a primeira mensagem recebida e a primeira resposta enviada.
  // null quando a conversa não tem esse par de timestamps (nunca é estimado).
  primeiraRespostaMinutos: number | null;
};

export type ContrachequeEnvioIA = {
  unidade: string;
  // Competência da folha (YYYY-MM).
  competencia: string;
  status: string;
};

export type FolhaTransporteIA = {
  unidade: string;
  mesReferencia: string;
  valorTotal: number;
};

export type QuadroFuncionariosIA = {
  unidade: string;
  funcionariosAtivos: number;
};

// Fonte injetada: em produção lê Supabase/Sponte/Nuvemshop
// (`analises-ia-modulos.server.ts`); nos testes é um dublê.
export interface FonteDadosModulos {
  recargasCantina(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<RecargaCantinaIA[]>;
  rematriculaMaterial(filtro: { unidades: string[]; anoLetivo?: number }): Promise<{
    linhas: LinhaRematriculaIA[];
    avisos: string[];
  }>;
  esportes(filtro: {
    unidades: string[];
    mesInicio: string;
    mesFim: string;
    modalidade?: string;
  }): Promise<{ repasses: RepasseEsporteIA[]; turmas: TurmaEsporteIA[] }>;
  uniformes(filtro: { unidades: string[]; dataInicio: string; dataFim: string }): Promise<{
    estoque: ItemEstoqueUniformeIA[];
    pedidos: PedidoUniformeIA[];
    avisos: string[];
  }>;
  documentosEmitidos(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
    tipo?: TipoDocumentoIA;
  }): Promise<DocumentoEmitidoIA[]>;
  matriculas(filtro: { unidades: string[]; dataInicio: string; dataFim: string }): Promise<{
    submissoes: SubmissaoMatriculaIA[];
    ativos: TurmaAtivosIA[];
    avisos: string[];
  }>;
  atendimento(filtro: {
    unidades: string[];
    dataInicio: string;
    dataFim: string;
  }): Promise<{ conversas: ConversaAtendimentoIA[] }>;
  folhaRh(filtro: { unidades: string[]; mesInicio: string; mesFim: string }): Promise<{
    contracheques: ContrachequeEnvioIA[];
    folhasTransporte: FolhaTransporteIA[];
    quadro: QuadroFuncionariosIA[];
  }>;
}

// ─── Schemas dos argumentos (estritos) ───────────────────────────────────────

const JANELA_DIAS_BANCO = 731;
const JANELA_MESES = 24;

const unidadeOpcional = z.string().trim().min(1).max(80).optional();

function diasEntre(inicio: string, fim: string): number {
  return (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000;
}

function janelaDatas<T extends { dataInicio: string; dataFim: string }>(maxDias: number) {
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

function janelaMeses<T extends { mesInicio: string; mesFim: string }>(
  args: T,
  ctx: z.RefinementCtx,
) {
  const meses = mesesDoIntervaloIA(args.mesInicio, args.mesFim);
  if (meses.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "mesFim é anterior a mesInicio",
      path: ["mesFim"],
    });
    return;
  }
  if (meses.length > JANELA_MESES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `esta consulta aceita no máximo ${JANELA_MESES} meses por vez`,
      path: ["mesFim"],
    });
  }
}

const periodoDatas = {
  unidade: unidadeOpcional,
  dataInicio: z.string().regex(DATA_ISO),
  dataFim: z.string().regex(DATA_ISO),
};

const periodoMeses = {
  unidade: unidadeOpcional,
  mesInicio: z.string().regex(MES_ISO),
  mesFim: z.string().regex(MES_ISO),
};

export const CantinaArgsSchema = z
  .object(periodoDatas)
  .strict()
  .superRefine(janelaDatas(JANELA_DIAS_BANCO));

export const RematriculaArgsSchema = z
  .object({
    unidade: unidadeOpcional,
    anoLetivo: z.number().int().min(2000).max(2100).optional(),
  })
  .strict();

export const EsportesArgsSchema = z
  .object({ ...periodoMeses, modalidade: z.string().trim().min(1).max(80).optional() })
  .strict()
  .superRefine(janelaMeses);

export const UniformesArgsSchema = z
  .object(periodoDatas)
  .strict()
  .superRefine(janelaDatas(JANELA_DIAS_BANCO));

export const DocumentosArgsSchema = z
  .object({
    ...periodoDatas,
    tipo: z
      .enum(["recibo", "declaracao_debitos", "declaracao_ir", "termo_confissao_divida"])
      .optional(),
  })
  .strict()
  .superRefine(janelaDatas(JANELA_DIAS_BANCO));

export const MatriculasArgsSchema = z
  .object(periodoDatas)
  .strict()
  .superRefine(janelaDatas(JANELA_DIAS_BANCO));

export const AtendimentoArgsSchema = z
  .object(periodoDatas)
  .strict()
  .superRefine(janelaDatas(JANELA_DIAS_BANCO));

export const FolhaRhArgsSchema = z.object(periodoMeses).strict().superRefine(janelaMeses);

export const ConsultasDisponiveisArgsSchema = z
  .object({
    // Só para a auditoria registrar sobre o que se perguntou fora do escopo.
    assunto: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const NOMES_FERRAMENTAS_MODULOS = [
  "buscar_recargas_cantina",
  "buscar_rematricula_material",
  "buscar_esportes_repasses",
  "buscar_uniformes_estoque_pedidos",
  "buscar_documentos_emitidos",
  "buscar_matriculas_alunos_ativos",
  "buscar_atendimento_conversas",
  "buscar_folha_rh",
  "listar_consultas_disponiveis",
] as const;

export type NomeFerramentaModulo = (typeof NOMES_FERRAMENTAS_MODULOS)[number];

const SCHEMAS_MODULOS = {
  buscar_recargas_cantina: CantinaArgsSchema,
  buscar_rematricula_material: RematriculaArgsSchema,
  buscar_esportes_repasses: EsportesArgsSchema,
  buscar_uniformes_estoque_pedidos: UniformesArgsSchema,
  buscar_documentos_emitidos: DocumentosArgsSchema,
  buscar_matriculas_alunos_ativos: MatriculasArgsSchema,
  buscar_atendimento_conversas: AtendimentoArgsSchema,
  buscar_folha_rh: FolhaRhArgsSchema,
  listar_consultas_disponiveis: ConsultasDisponiveisArgsSchema,
} as const;

export type ChamadaFerramentaModulo =
  | { nome: "buscar_recargas_cantina"; args: z.infer<typeof CantinaArgsSchema> }
  | { nome: "buscar_rematricula_material"; args: z.infer<typeof RematriculaArgsSchema> }
  | { nome: "buscar_esportes_repasses"; args: z.infer<typeof EsportesArgsSchema> }
  | {
      nome: "buscar_uniformes_estoque_pedidos";
      args: z.infer<typeof UniformesArgsSchema>;
    }
  | { nome: "buscar_documentos_emitidos"; args: z.infer<typeof DocumentosArgsSchema> }
  | {
      nome: "buscar_matriculas_alunos_ativos";
      args: z.infer<typeof MatriculasArgsSchema>;
    }
  | { nome: "buscar_atendimento_conversas"; args: z.infer<typeof AtendimentoArgsSchema> }
  | { nome: "buscar_folha_rh"; args: z.infer<typeof FolhaRhArgsSchema> }
  | {
      nome: "listar_consultas_disponiveis";
      args: z.infer<typeof ConsultasDisponiveisArgsSchema>;
    };

export function ehFerramentaModulo(nome: string): nome is NomeFerramentaModulo {
  return (NOMES_FERRAMENTAS_MODULOS as readonly string[]).includes(nome);
}

export function schemaFerramentaModulo(nome: NomeFerramentaModulo) {
  return SCHEMAS_MODULOS[nome];
}

// ─── Definições enviadas à Anthropic ─────────────────────────────────────────

export type DefinicaoFerramentaModulo = {
  nome: NomeFerramentaModulo;
  descricao: string;
  schemaJson: Record<string, unknown>;
};

const propUnidade = {
  type: "string",
  description:
    "Nome exato da unidade (ex.: CEC, CEC Baby, Núcleo Belvedere, Núcleo Vale do Sereno). Omita para consultar todas as unidades permitidas ao usuário.",
};
const propDataInicio = { type: "string", description: "Início do intervalo, em YYYY-MM-DD." };
const propDataFim = { type: "string", description: "Fim do intervalo, em YYYY-MM-DD." };
const propMesInicio = { type: "string", description: "Primeiro mês do intervalo, em YYYY-MM." };
const propMesFim = { type: "string", description: "Último mês do intervalo, em YYYY-MM." };

// Temas cobertos hoje pela lista fechada — a mesma lista que a ferramenta de
// descoberta devolve quando a pergunta não tem consulta correspondente.
export const TEMAS_DISPONIVEIS: string[] = [
  "Financeiro: despesas do Fluxo Futuro (previstas, agendadas e pagas)",
  "Financeiro: receitas previstas (Sponte) e realizadas (extrato conciliado)",
  "Financeiro: divergências de despesas recorrentes",
  "Financeiro: inadimplência agregada por unidade e período",
  "Financeiro: saldo projetado por unidade e mês",
  "Cantina: recargas solicitadas, efetivadas e lançadas no Sponte",
  "Rematrícula/Material Pedagógico: status, parcelamentos escolhidos e material a receber",
  "Esportes extracurriculares: repasses a parceiros e alunos por turma/modalidade",
  "Uniformes: estoque abaixo do mínimo e pedidos pagos na Nuvemshop",
  "Documentos: volume emitido por tipo (recibo, declarações, termo de confissão)",
  "Matrículas: submissões do formulário público e alunos ativos por turma",
  "Atendimento: volume de conversas de WhatsApp e tempo de primeira resposta",
  "RH: contracheques enviados, folhas de vale-transporte e quadro de funcionários ativos",
];

export const RESPOSTA_SEM_CONSULTA =
  "Não tenho uma consulta disponível para esse tipo de pergunta.";

export const FERRAMENTAS_MODULOS: DefinicaoFerramentaModulo[] = [
  {
    nome: "buscar_recargas_cantina",
    descricao:
      "Recargas do cartão da cantina solicitadas pelo portal público, com contagem e valor por status (pendente, recarga efetivada, lançada no Sponte), filtradas por unidade e período da solicitação. Não devolve dado de aluno ou responsável.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        dataInicio: propDataInicio,
        dataFim: propDataFim,
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_rematricula_material",
    descricao:
      "Situação da rematrícula por unidade: contagem de Não iniciado, Em andamento, Aguardando aprovação e Rematriculado (a base são os alunos ativos do Sponte), distribuição dos parcelamentos escolhidos (1x a 8x) e valor total de material pedagógico a receber por unidade/ano letivo.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        anoLetivo: {
          type: "integer",
          description:
            "Ano letivo de referência da rematrícula (ex.: 2027). Omita para considerar todos os anos letivos registrados.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_esportes_repasses",
    descricao:
      "Esportes extracurriculares: repasses a parceiros por modalidade e unidade no intervalo de meses (valor arrecadado, repassado e retido, separando repasse percentual de valor fixo mensal) e quantidade de alunos matriculados por turma/modalidade.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        modalidade: { type: "string", description: "Nome da modalidade (ex.: Judô, Ballet)." },
        mesInicio: propMesInicio,
        mesFim: propMesFim,
      },
      required: ["mesInicio", "mesFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_uniformes_estoque_pedidos",
    descricao:
      "Uniformes: peças com saldo abaixo do estoque mínimo configurado (por loja, produto e tamanho) e volume de pedidos pagos na Nuvemshop no período (quantidade e receita por peça).",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        dataInicio: propDataInicio,
        dataFim: propDataFim,
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_documentos_emitidos",
    descricao:
      "Volume de documentos oficiais emitidos por tipo (Recibo, Declaração de Inexistência de Débitos, Declaração de Imposto de Renda, Termo de Confissão de Dívida), por unidade e período de emissão.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        dataInicio: propDataInicio,
        dataFim: propDataFim,
        tipo: {
          type: "string",
          enum: ["recibo", "declaracao_debitos", "declaracao_ir", "termo_confissao_divida"],
          description: "Restringe a um tipo de documento. Omita para trazer todos.",
        },
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_matriculas_alunos_ativos",
    descricao:
      "Matrículas: quantidade de submissões do formulário público de matrícula no período, separadas por situação (confirmadas no Sponte, rejeitadas na validação, duplicadas), e quantidade de alunos ativos por turma em cada unidade.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        dataInicio: propDataInicio,
        dataFim: propDataFim,
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_atendimento_conversas",
    descricao:
      "Atendimento por WhatsApp: volume de conversas com atividade no período por unidade, mensagens recebidas e enviadas e tempo médio de primeira resposta (calculado dos horários das mensagens; quando não há esse par de horários, o tempo sai indisponível em vez de estimado). Não devolve telefone, nome nem conteúdo de mensagem.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        dataInicio: propDataInicio,
        dataFim: propDataFim,
      },
      required: ["dataInicio", "dataFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "buscar_folha_rh",
    descricao:
      "RH/folha: contracheques enviados por competência e situação do envio, valor total das folhas de vale-transporte e quadro de funcionários ativos, por unidade e intervalo de meses. Sai só agregado — sem nome, CPF, endereço, telefone ou email de funcionário.",
    schemaJson: {
      type: "object",
      properties: {
        unidade: propUnidade,
        mesInicio: propMesInicio,
        mesFim: propMesFim,
      },
      required: ["mesInicio", "mesFim"],
      additionalProperties: false,
    },
  },
  {
    nome: "listar_consultas_disponiveis",
    descricao:
      "Use SEMPRE que a pergunta não corresponder a nenhuma das outras consultas desta lista. Devolve os temas que as Análises com IA cobrem hoje, para você responder que não existe consulta disponível para aquele assunto em vez de tentar responder por conhecimento próprio.",
    schemaJson: {
      type: "object",
      properties: {
        assunto: {
          type: "string",
          description:
            "Assunto pedido pelo usuário, em poucas palavras (fica registrado na auditoria).",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

// ─── Utilitários ─────────────────────────────────────────────────────────────

function arred(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function mesesDoIntervaloIA(mesInicio: string, mesFim: string): string[] {
  if (mesFim < mesInicio) return [];
  const meses: string[] = [];
  let [ano, mes] = mesInicio.split("-").map(Number);
  while (meses.length <= JANELA_MESES) {
    const atual = `${ano}-${String(mes).padStart(2, "0")}`;
    if (atual > mesFim) break;
    meses.push(atual);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

// ─── Agregações ──────────────────────────────────────────────────────────────

export function agregarRecargasCantina(recargas: RecargaCantinaIA[]) {
  const statusPossiveis: StatusRecarga[] = ["pendente", "efetivada", "lancada_no_boleto"];
  const porStatus = statusPossiveis.map((status) => {
    const doStatus = recargas.filter((r) => r.status === status);
    return {
      status,
      rotulo: STATUS_RECARGA_LABEL[status],
      quantidade: doStatus.length,
      valor: arred(doStatus.reduce((s, r) => s + r.valor, 0)),
    };
  });
  const unidades = [...new Set(recargas.map((r) => r.unidade))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  return {
    // "Solicitadas" é o total pedido pelo portal, em qualquer status.
    quantidadeSolicitadas: recargas.length,
    valorSolicitado: arred(recargas.reduce((s, r) => s + r.valor, 0)),
    porStatus,
    porUnidade: unidades.map((unidade) => {
      const daUnidade = recargas.filter((r) => r.unidade === unidade);
      return {
        unidade,
        quantidadeSolicitadas: daUnidade.length,
        valorSolicitado: arred(daUnidade.reduce((s, r) => s + r.valor, 0)),
        porStatus: statusPossiveis.map((status) => ({
          status,
          quantidade: daUnidade.filter((r) => r.status === status).length,
          valor: arred(
            daUnidade.filter((r) => r.status === status).reduce((s, r) => s + r.valor, 0),
          ),
        })),
      };
    }),
  };
}

export function agregarRematricula(linhas: LinhaRematriculaIA[], avisos: string[]) {
  const statusPossiveis: StatusAcompanhamento[] = [
    "nao_iniciado",
    "em_andamento",
    "aguardando_aprovacao",
    "rematriculado",
  ];
  const respondidas = linhas.filter((l) => l.parcelas !== null);
  const distribuicaoParcelamentos = Array.from({ length: 8 }, (_, i) => i + 1).map((parcelas) => ({
    parcelas,
    quantidade: respondidas.filter((l) => l.parcelas === parcelas).length,
  }));
  const unidades = [...new Set(linhas.map((l) => l.unidade))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const totalAReceber = (alvo: LinhaRematriculaIA[]) =>
    arred(alvo.reduce((s, l) => s + (l.valorAnual ?? 0), 0));
  return {
    totalAlunosAtivos: linhas.length,
    porStatus: statusPossiveis.map((status) => ({
      status,
      rotulo: STATUS_ACOMPANHAMENTO_LABEL[status],
      quantidade: linhas.filter((l) => l.status === status).length,
    })),
    distribuicaoParcelamentos,
    // Material a receber = soma do valor anual das escolhas já confirmadas pelo
    // responsável (aguardando aprovação + já lançadas no Sponte).
    valorMaterialAReceber: totalAReceber(respondidas),
    porUnidade: unidades.map((unidade) => {
      const daUnidade = linhas.filter((l) => l.unidade === unidade);
      return {
        unidade,
        totalAlunosAtivos: daUnidade.length,
        porStatus: statusPossiveis.map((status) => ({
          status,
          quantidade: daUnidade.filter((l) => l.status === status).length,
        })),
        valorMaterialAReceber: totalAReceber(daUnidade.filter((l) => l.parcelas !== null)),
        anosLetivos: [...new Set(daUnidade.map((l) => l.anoLetivo).filter((a) => a !== null))],
      };
    }),
    avisos,
  };
}

export function agregarEsportes(repasses: RepasseEsporteIA[], turmas: TurmaEsporteIA[]) {
  const chave = (r: RepasseEsporteIA) => `${r.unidade}|${r.modalidade}|${r.parceiro}`;
  const porParceiro = new Map<
    string,
    {
      unidade: string;
      modalidade: string;
      parceiro: string;
      tipoRepasse: "percentual" | "fixo";
      meses: number;
      valorArrecadado: number;
      valorRepasse: number;
      valorRetido: number;
      repassesPagos: number;
    }
  >();
  for (const r of repasses) {
    const atual = porParceiro.get(chave(r)) ?? {
      unidade: r.unidade,
      modalidade: r.modalidade,
      parceiro: r.parceiro,
      tipoRepasse: r.tipoRepasse,
      meses: 0,
      valorArrecadado: 0,
      valorRepasse: 0,
      valorRetido: 0,
      repassesPagos: 0,
    };
    atual.meses += 1;
    atual.valorArrecadado = arred(atual.valorArrecadado + r.valorArrecadado);
    atual.valorRepasse = arred(atual.valorRepasse + r.valorRepasse);
    atual.valorRetido = arred(atual.valorRetido + r.valorRetido);
    if (r.pago) atual.repassesPagos += 1;
    porParceiro.set(chave(r), atual);
  }
  const soma = (alvo: RepasseEsporteIA[]) => arred(alvo.reduce((s, r) => s + r.valorRepasse, 0));
  return {
    totalArrecadado: arred(repasses.reduce((s, r) => s + r.valorArrecadado, 0)),
    totalRepassado: soma(repasses),
    totalRetido: arred(repasses.reduce((s, r) => s + r.valorRetido, 0)),
    totalRepassadoPercentual: soma(repasses.filter((r) => r.tipoRepasse === "percentual")),
    totalRepassadoFixo: soma(repasses.filter((r) => r.tipoRepasse === "fixo")),
    porParceiro: [...porParceiro.values()].sort((a, b) => b.valorRepasse - a.valorRepasse),
    alunosPorTurma: turmas
      .slice()
      .sort(
        (a, b) =>
          a.unidade.localeCompare(b.unidade, "pt-BR") ||
          a.modalidade.localeCompare(b.modalidade, "pt-BR") ||
          a.turma.localeCompare(b.turma, "pt-BR"),
      ),
    totalAlunosMatriculados: turmas.reduce((s, t) => s + t.quantidadeAlunos, 0),
  };
}

export function agregarUniformes(
  estoque: ItemEstoqueUniformeIA[],
  pedidos: PedidoUniformeIA[],
  avisos: string[],
) {
  const baixo = estoque.filter((i) => i.estoque < i.estoqueMinimo);
  const lojas = [...new Set(baixo.map((i) => i.loja))].sort();
  return {
    itensAbaixoDoMinimo: baixo.length,
    itensAbaixoDoMinimoSemPedido: baixo.filter((i) => !i.pedidoRealizado).length,
    porLoja: lojas.map((loja) => ({
      loja,
      itensAbaixoDoMinimo: baixo.filter((i) => i.loja === loja).length,
    })),
    itens: baixo
      .slice()
      .sort(
        (a, b) =>
          a.estoque - b.estoque ||
          a.produto.localeCompare(b.produto, "pt-BR") ||
          a.tamanho.localeCompare(b.tamanho, "pt-BR"),
      )
      .slice(0, 120),
    pedidos: {
      quantidadePecas: pedidos.reduce((s, p) => s + p.quantidade, 0),
      receita: arred(pedidos.reduce((s, p) => s + p.receita, 0)),
      porPeca: pedidos
        .slice()
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 120),
    },
    avisos,
  };
}

export function agregarDocumentos(documentos: DocumentoEmitidoIA[]) {
  const tipos = Object.keys(TIPO_DOCUMENTO_LABEL) as TipoDocumentoIA[];
  const unidades = [...new Set(documentos.map((d) => d.unidade))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  return {
    quantidadeTotal: documentos.length,
    porTipo: tipos.map((tipo) => ({
      tipo,
      rotulo: TIPO_DOCUMENTO_LABEL[tipo],
      quantidade: documentos.filter((d) => d.tipo === tipo).length,
      valorTotal: arred(
        documentos.filter((d) => d.tipo === tipo).reduce((s, d) => s + d.valorTotal, 0),
      ),
    })),
    porUnidade: unidades.map((unidade) => ({
      unidade,
      quantidade: documentos.filter((d) => d.unidade === unidade).length,
      porTipo: tipos
        .map((tipo) => ({
          tipo,
          quantidade: documentos.filter((d) => d.unidade === unidade && d.tipo === tipo).length,
        }))
        .filter((t) => t.quantidade > 0),
    })),
    // O envio em lote (Declaração de IR) dispara email na hora e não persiste o
    // resultado por destinatário: essa consulta conta documentos EMITIDOS.
    statusEnvioEmLote:
      "não disponível: o School Hub registra o documento emitido, não o resultado do email enviado em lote",
  };
}

export function agregarMatriculas(
  submissoes: SubmissaoMatriculaIA[],
  ativos: TurmaAtivosIA[],
  avisos: string[],
) {
  const status = [...new Set(submissoes.map((s) => s.status))].sort();
  const unidades = [
    ...new Set([...submissoes.map((s) => s.unidade), ...ativos.map((a) => a.unidade)]),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    // "Confirmadas" = submissão que virou aluno no Sponte (status "sucesso").
    matriculasConfirmadas: submissoes.filter((s) => s.status === "sucesso").length,
    submissoesTotal: submissoes.length,
    porStatus: status.map((s) => ({
      status: s,
      quantidade: submissoes.filter((x) => x.status === s).length,
    })),
    porUnidade: unidades.map((unidade) => ({
      unidade,
      matriculasConfirmadas: submissoes.filter(
        (s) => s.unidade === unidade && s.status === "sucesso",
      ).length,
      submissoesTotal: submissoes.filter((s) => s.unidade === unidade).length,
      alunosAtivos: ativos
        .filter((a) => a.unidade === unidade)
        .reduce((s, a) => s + a.quantidadeAlunos, 0),
    })),
    totalAlunosAtivos: ativos.reduce((s, a) => s + a.quantidadeAlunos, 0),
    alunosAtivosPorTurma: ativos
      .slice()
      .sort(
        (a, b) =>
          a.unidade.localeCompare(b.unidade, "pt-BR") || a.turma.localeCompare(b.turma, "pt-BR"),
      )
      .slice(0, 200),
    avisos,
  };
}

export function agregarAtendimento(conversas: ConversaAtendimentoIA[]) {
  const comResposta = conversas.filter((c) => c.primeiraRespostaMinutos !== null);
  const unidades = [...new Set(conversas.map((c) => c.unidade))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const media = (alvo: ConversaAtendimentoIA[]) => {
    const amostra = alvo.filter((c) => c.primeiraRespostaMinutos !== null);
    if (amostra.length === 0) return null;
    return arred(
      amostra.reduce((s, c) => s + (c.primeiraRespostaMinutos ?? 0), 0) / amostra.length,
    );
  };
  return {
    quantidadeConversas: conversas.length,
    mensagensRecebidas: conversas.reduce((s, c) => s + c.mensagensRecebidas, 0),
    mensagensEnviadas: conversas.reduce((s, c) => s + c.mensagensEnviadas, 0),
    tempoMedioPrimeiraRespostaMinutos: media(conversas),
    conversasComPrimeiraResposta: comResposta.length,
    // Sem par "mensagem recebida → primeira resposta" não existe métrica: a
    // ferramenta informa a ausência em vez de devolver um número inventado.
    observacaoTempoResposta:
      comResposta.length === 0
        ? "tempo médio de primeira resposta indisponível: nenhuma conversa do período tem mensagem recebida seguida de resposta enviada"
        : `média calculada sobre ${comResposta.length} de ${conversas.length} conversas (as demais não têm par mensagem recebida → resposta enviada)`,
    porUnidade: unidades.map((unidade) => {
      const daUnidade = conversas.filter((c) => c.unidade === unidade);
      return {
        unidade,
        quantidadeConversas: daUnidade.length,
        mensagensRecebidas: daUnidade.reduce((s, c) => s + c.mensagensRecebidas, 0),
        mensagensEnviadas: daUnidade.reduce((s, c) => s + c.mensagensEnviadas, 0),
        tempoMedioPrimeiraRespostaMinutos: media(daUnidade),
      };
    }),
  };
}

export function agregarFolhaRh(dados: {
  contracheques: ContrachequeEnvioIA[];
  folhasTransporte: FolhaTransporteIA[];
  quadro: QuadroFuncionariosIA[];
}) {
  const { contracheques, folhasTransporte, quadro } = dados;
  const status = [...new Set(contracheques.map((c) => c.status))].sort();
  const competencias = [...new Set(contracheques.map((c) => c.competencia))].sort();
  const unidades = [
    ...new Set([
      ...contracheques.map((c) => c.unidade),
      ...folhasTransporte.map((f) => f.unidade),
      ...quadro.map((q) => q.unidade),
    ]),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    contrachequesEnviados: contracheques.length,
    contrachequesPorStatus: status.map((s) => ({
      status: s,
      quantidade: contracheques.filter((c) => c.status === s).length,
    })),
    contrachequesPorCompetencia: competencias.map((c) => ({
      competencia: c,
      quantidade: contracheques.filter((x) => x.competencia === c).length,
    })),
    totalFolhaTransporte: arred(folhasTransporte.reduce((s, f) => s + f.valorTotal, 0)),
    folhasTransporte: folhasTransporte
      .slice()
      .sort((a, b) => a.mesReferencia.localeCompare(b.mesReferencia)),
    funcionariosAtivos: quadro.reduce((s, q) => s + q.funcionariosAtivos, 0),
    porUnidade: unidades.map((unidade) => ({
      unidade,
      contrachequesEnviados: contracheques.filter((c) => c.unidade === unidade).length,
      totalFolhaTransporte: arred(
        folhasTransporte.filter((f) => f.unidade === unidade).reduce((s, f) => s + f.valorTotal, 0),
      ),
      funcionariosAtivos: quadro
        .filter((q) => q.unidade === unidade)
        .reduce((s, q) => s + q.funcionariosAtivos, 0),
    })),
    // O contracheque chega em PDF do escritório de contabilidade e é apenas
    // fatiado e enviado: o valor bruto/líquido da folha salarial não é
    // persistido no School Hub, então não pode ser somado aqui.
    observacaoFolhaSalarial:
      "valor da folha de salários indisponível: o School Hub registra o envio do contracheque (PDF), não os valores; o único valor de folha persistido é o das folhas de vale-transporte",
  };
}

export function consultasDisponiveis() {
  return {
    resposta: RESPOSTA_SEM_CONSULTA,
    temas: [...TEMAS_DISPONIVEIS],
    instrucao:
      "Responda ao usuário que essa consulta ainda não está liberada, liste resumidamente os temas acima e não tente responder por conhecimento próprio nem estimar números.",
  };
}

// ─── Execução ────────────────────────────────────────────────────────────────

export type ResultadoFerramentaModulo = {
  fonte: string;
  erro?: string;
  dados?: unknown;
  // Filtros adicionais que só a execução conhece (ex.: meses derivados).
  filtrosExtra?: Record<string, string>;
};

// As unidades já vêm resolvidas pelo RBAC (`resolverUnidades`) do chamador: aqui
// nenhuma unidade é ampliada nem substituída.
export async function executarFerramentaModulo(
  chamada: ChamadaFerramentaModulo,
  fonte: FonteDadosModulos,
  ctx: { unidades: string[] },
): Promise<ResultadoFerramentaModulo> {
  const unidades = ctx.unidades;

  switch (chamada.nome) {
    case "buscar_recargas_cantina": {
      const { dataInicio, dataFim } = chamada.args;
      const recargas = await fonte.recargasCantina({ unidades, dataInicio, dataFim });
      return {
        fonte:
          "Recargas da cantina solicitadas no portal público (School Hub), por data da solicitação",
        dados: agregarRecargasCantina(recargas),
      };
    }
    case "buscar_rematricula_material": {
      const { anoLetivo } = chamada.args;
      const { linhas, avisos } = await fonte.rematriculaMaterial({ unidades, anoLetivo });
      return {
        fonte:
          "Alunos ativos do Sponte cruzados com acessos e escolhas de parcelamento do portal de Rematrícula",
        dados: agregarRematricula(linhas, avisos),
      };
    }
    case "buscar_esportes_repasses": {
      const { mesInicio, mesFim, modalidade } = chamada.args;
      const { repasses, turmas } = await fonte.esportes({
        unidades,
        mesInicio,
        mesFim,
        modalidade,
      });
      return {
        fonte: "Repasses e matrículas do módulo Esportes Extracurriculares (School Hub)",
        dados: agregarEsportes(repasses, turmas),
      };
    }
    case "buscar_uniformes_estoque_pedidos": {
      const { dataInicio, dataFim } = chamada.args;
      const { estoque, pedidos, avisos } = await fonte.uniformes({
        unidades,
        dataInicio,
        dataFim,
      });
      return {
        fonte:
          "Estoque espelhado da Nuvemshop no School Hub e pedidos pagos da Nuvemshop no período",
        dados: agregarUniformes(estoque, pedidos, avisos),
      };
    }
    case "buscar_documentos_emitidos": {
      const { dataInicio, dataFim, tipo } = chamada.args;
      const documentos = await fonte.documentosEmitidos({ unidades, dataInicio, dataFim, tipo });
      return {
        fonte: "Histórico de documentos emitidos no módulo Documentos (School Hub)",
        dados: agregarDocumentos(documentos),
      };
    }
    case "buscar_matriculas_alunos_ativos": {
      const { dataInicio, dataFim } = chamada.args;
      const { submissoes, ativos, avisos } = await fonte.matriculas({
        unidades,
        dataInicio,
        dataFim,
      });
      return {
        fonte:
          "Submissões do formulário público de matrícula (School Hub) e alunos ativos do Sponte por turma",
        dados: agregarMatriculas(submissoes, ativos, avisos),
      };
    }
    case "buscar_atendimento_conversas": {
      const { dataInicio, dataFim } = chamada.args;
      const { conversas } = await fonte.atendimento({ unidades, dataInicio, dataFim });
      return {
        fonte:
          "Conversas e horários das mensagens de WhatsApp do módulo Atendimento (sem telefone, nome ou conteúdo)",
        dados: agregarAtendimento(conversas),
      };
    }
    case "buscar_folha_rh": {
      const { mesInicio, mesFim } = chamada.args;
      const dados = await fonte.folhaRh({ unidades, mesInicio, mesFim });
      return {
        fonte:
          "Envios de contracheque, folhas de vale-transporte e quadro de funcionários do módulo RH (agregados)",
        dados: agregarFolhaRh(dados),
      };
    }
    case "listar_consultas_disponiveis":
      return {
        fonte: "Lista fechada de consultas das Análises com IA",
        dados: consultasDisponiveis(),
      };
  }
}
