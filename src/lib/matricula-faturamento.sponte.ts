// Transporte do faturamento automático da matrícula nova (Fase 3).
//
// Leitura: GetPlanosCursos devolve os planos do curso (um por ano letivo, com
// situação, padrão, valores, quantidades e datas). Escrita: InsertPlano cria
// cada título e UpdateParcela corrige a sobra de centavos na 1ª parcela — o
// mesmo mecanismo já homologado na Rematrícula.
//
// Cada título tem uma linha própria em `matricula_faturamento_lancamentos`,
// reivindicada ANTES da chamada externa e atualizada com o ContaReceberID
// assim que o Sponte confirma. Isso é o que torna o retry seguro: título já
// confirmado nunca é criado de novo, e falha parcial fica registrada em vez de
// desfazer o que já existe.

import {
  ITEM_PLANO_VAZIO,
  escolherPlanoDoAnoLetivo,
  montarPlanoFaturamento,
  type ItemPlanoCurso,
  type LancamentoPlanejado,
  type PlanoCursoSponte,
  type TipoLancamentoMatricula,
} from "@/lib/matricula-faturamento";
import { chaveSerie } from "@/lib/rematricula";
import type { RefeicoesRotina } from "@/lib/matricula-form";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  atualizarParcelaSponte,
  callSponteMethod,
  checkFault,
  inserirPlanoSponte,
  paraYMD,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";

const LOG_TAG = "[Matrícula][Faturamento]";

interface Credenciais {
  codigoCliente: string;
  token: string;
}

function inteiro(item: string, tag: string): number {
  const n = parseInt(parseXmlValue(item, tag), 10);
  return Number.isFinite(n) ? n : 0;
}

function decimal(item: string, tag: string): number {
  const bruto = parseXmlValue(item, tag).replace(",", ".");
  const n = Number.parseFloat(bruto);
  return Number.isFinite(n) ? n : 0;
}

function itemPlano(
  item: string,
  sufixo: "Mensalidade" | "Material" | "Matricula" | "Outros",
  tagPlanoConta: string,
  tagDescricao: string,
): ItemPlanoCurso {
  return {
    ...ITEM_PLANO_VAZIO,
    parcelas: inteiro(item, `NumeroParcelas${sufixo}`),
    valorParcela: decimal(item, `ValorParcela${sufixo}`),
    dataInicial: paraYMD(parseXmlValue(item, `DataInicial${sufixo}`)) ?? "",
    planoContaId: inteiro(item, tagPlanoConta),
    descricaoPlanoConta: parseXmlValue(item, tagDescricao),
  };
}

export async function buscarPlanosCurso(
  creds: Credenciais,
  cursoId: number,
): Promise<PlanoCursoSponte[]> {
  const xml = await callSponteMethod(
    "GetPlanosCursos",
    `<nCursoID>${cursoId}</nCursoID><sParametrosBusca></sParametrosBusca>`,
    creds.codigoCliente,
    creds.token,
  );
  const falha = checkFault(xml);
  if (falha) throw new Error(`GetPlanosCursos: ${falha}`);

  return parseXmlList(xml, "PlanoCurso").flatMap((item) => {
    const planoCursoId = inteiro(item, "PlanoCursoID");
    if (planoCursoId <= 0) return [];
    return [
      {
        cursoId: inteiro(item, "CursoID") || cursoId,
        planoCursoId,
        descricaoPlano: parseXmlValue(item, "DescricaoPlano"),
        ativo: inteiro(item, "Situacao") === 1,
        padrao: inteiro(item, "Padrao") === 1,
        matricula: itemPlano(item, "Matricula", "PlanoContaIDMatricula", "DescricaoPlanoMatricula"),
        mensalidade: itemPlano(
          item,
          "Mensalidade",
          "PlanoContaIDMensalidade",
          "DescricaoPlanoContaMensalidade",
        ),
        material: itemPlano(item, "Material", "PlanoContaIDMaterial", "DescricaoPlanoMaterial"),
        outros: itemPlano(item, "Outros", "PlanoContaIDOutros", "DescricaoPlanoOutros"),
      },
    ];
  });
}

// ─── Configurações locais ───────────────────────────────────────────────────

export interface ValoresOpcionaisUnidade {
  valorRefeicao: number | null;
  valorHoraExtra: number | null;
}

export async function valoresOpcionaisDaUnidade(unidade: string): Promise<ValoresOpcionaisUnidade> {
  const { data } = await supabaseAdmin
    .from("unidade_valores_opcionais" as never)
    .select("valor_refeicao, valor_hora_extra")
    .eq("unidade", unidade)
    .maybeSingle<{ valor_refeicao: number; valor_hora_extra: number }>();
  if (!data) return { valorRefeicao: null, valorHoraExtra: null };
  const refeicao = Number(data.valor_refeicao);
  const horaExtra = Number(data.valor_hora_extra);
  return {
    valorRefeicao: Math.round(refeicao * 100) > 0 ? refeicao : null,
    valorHoraExtra: Math.round(horaExtra * 100) > 0 ? horaExtra : null,
  };
}

export async function materialAnualDaSerie(
  unidade: string,
  serie: string,
): Promise<{ valorAnual: number; serieCadastrada: string } | null> {
  const { data } = await supabaseAdmin
    .from("material_pedagogico_series" as never)
    .select("serie, valor_anual")
    .eq("unidade", unidade)
    .eq("serie_chave", chaveSerie(serie))
    .maybeSingle<{ serie: string; valor_anual: number }>();
  if (!data) return null;
  return { valorAnual: Number(data.valor_anual), serieCadastrada: data.serie };
}

// ─── Execução idempotente ───────────────────────────────────────────────────

export type StatusLancamento = "pendente" | "lancado" | "ajuste_pendente" | "erro";

interface LinhaLancamento {
  id: string;
  tipo: string;
  status: string;
  sponte_conta_receber_id: string | null;
}

export interface ResultadoLancamento {
  tipo: TipoLancamentoMatricula;
  status: StatusLancamento;
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  primeiroVencimento: string;
  total: number;
  contaReceberId: string | null;
  erro: string | null;
}

export type StatusFaturamento = "lancado" | "parcial" | "sem_plano" | "erro";

export interface ResultadoFaturamento {
  status: StatusFaturamento;
  planoCursoId: number | null;
  lancamentos: ResultadoLancamento[];
  pendencias: string[];
}

export interface EntradaFaturamento {
  submissionId: string;
  unidade: string;
  alunoId: number;
  cursoId: number;
  serie: string;
  anoLetivo: number;
  dataMatricula: string;
  materialParcelas: number | null;
  refeicoes: RefeicoesRotina;
  semRefeicoes: boolean;
  horarioEstendido: boolean;
}

async function linhasExistentes(submissionId: string): Promise<LinhaLancamento[]> {
  const { data } = await supabaseAdmin
    .from("matricula_faturamento_lancamentos" as never)
    .select("id, tipo, status, sponte_conta_receber_id")
    .eq("submission_id", submissionId)
    .returns<LinhaLancamento[]>();
  return data ?? [];
}

/**
 * Reivindica a linha do tipo antes de qualquer chamada ao Sponte. Devolve null
 * quando o título já foi confirmado (retry não pode lançar de novo).
 */
async function reivindicar(
  entrada: EntradaFaturamento,
  l: LancamentoPlanejado,
  existente: LinhaLancamento | undefined,
): Promise<{ id: string } | null> {
  if (existente && existente.sponte_conta_receber_id) return null;

  const linha = {
    submission_id: entrada.submissionId,
    unidade: entrada.unidade,
    sponte_aluno_id: String(entrada.alunoId),
    tipo: l.tipo,
    categoria: l.categoria,
    parcelas: l.parcelas,
    valor_parcela: l.valorParcela,
    valor_primeira_parcela: l.valorPrimeiraParcela,
    primeiro_vencimento: l.primeiroVencimento,
    total: l.total,
    observacao: l.observacao,
    status: "pendente",
    erro: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("matricula_faturamento_lancamentos" as never)
    .upsert(linha as never, { onConflict: "submission_id,tipo" })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    console.error(`${LOG_TAG} falha ao reivindicar o lançamento ${l.tipo}:`, error?.message);
    return null;
  }
  return data;
}

async function registrar(
  id: string,
  campos: {
    status: StatusLancamento;
    contaReceberId?: string | null;
    retornoOperacao?: string | null;
    erro?: string | null;
  },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("matricula_faturamento_lancamentos" as never)
    .update({
      status: campos.status,
      sponte_conta_receber_id: campos.contaReceberId ?? null,
      retorno_operacao: campos.retornoOperacao ?? null,
      erro: campos.erro ?? null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  if (error) console.error(`${LOG_TAG} falha ao gravar o log do lançamento:`, error.message);
}

async function lancar(
  entrada: EntradaFaturamento,
  l: LancamentoPlanejado,
  linhaId: string,
): Promise<ResultadoLancamento> {
  const base: ResultadoLancamento = {
    tipo: l.tipo,
    status: "erro",
    parcelas: l.parcelas,
    valorParcela: l.valorParcela,
    valorPrimeiraParcela: l.valorPrimeiraParcela,
    primeiroVencimento: l.primeiroVencimento,
    total: l.total,
    contaReceberId: null,
    erro: null,
  };

  const inserido = await inserirPlanoSponte({
    unidade: entrada.unidade,
    sponteAlunoId: String(entrada.alunoId),
    valor: l.valorParcela,
    vencimento: l.primeiroVencimento,
    categoria: l.categoria,
    observacao: l.observacao,
    logTag: LOG_TAG,
    parcelas: l.parcelas,
  });

  if (!inserido.ok || !inserido.contaReceberID) {
    const erro =
      inserido.error ??
      (inserido.indisponivel
        ? `Unidade "${entrada.unidade}" sem integração Sponte configurada.`
        : "O Sponte não confirmou a criação da cobrança.");
    await registrar(linhaId, { status: "erro", erro, retornoOperacao: inserido.retornoOperacao });
    return { ...base, erro };
  }

  // O título já existe: gravar o ID antes do ajuste garante que o retry não
  // crie um segundo.
  const contaReceberId = inserido.contaReceberID;
  await registrar(linhaId, {
    status: "lancado",
    contaReceberId,
    retornoOperacao: inserido.retornoOperacao,
  });

  if (!l.ajustaPrimeira) {
    return { ...base, status: "lancado", contaReceberId };
  }

  const ajuste = await atualizarParcelaSponte({
    unidade: entrada.unidade,
    contaReceberId,
    numeroParcela: 1,
    valor: l.valorPrimeiraParcela,
    vencimento: l.primeiroVencimento,
    categoria: l.categoria,
    observacao: l.observacao,
    logTag: LOG_TAG,
  });

  if (!ajuste.ok) {
    const erro = `Cobrança criada (conta ${contaReceberId}), mas o ajuste da 1ª parcela falhou: ${ajuste.error ?? "o Sponte não confirmou"}. Corrija a 1ª parcela para ${l.valorPrimeiraParcela.toFixed(2)} no Sponte. NÃO lance novamente.`;
    await registrar(linhaId, { status: "ajuste_pendente", contaReceberId, erro });
    return { ...base, status: "ajuste_pendente", contaReceberId, erro };
  }

  return { ...base, status: "lancado", contaReceberId };
}

/**
 * Faturamento completo da matrícula formalizada: lê o plano do Sponte, monta o
 * cronograma e lança cada título. Nada aqui desfaz cadastro ou matrícula — o
 * que falha volta como pendência auditável.
 */
export async function faturarMatricula(entrada: EntradaFaturamento): Promise<ResultadoFaturamento> {
  const creds = resolverCredenciais(entrada.unidade);
  if (!creds) {
    return {
      status: "erro",
      planoCursoId: null,
      lancamentos: [],
      pendencias: [`Unidade "${entrada.unidade}" não tem integração Sponte configurada.`],
    };
  }

  let planos: PlanoCursoSponte[];
  try {
    planos = await buscarPlanosCurso(creds, entrada.cursoId);
  } catch (e) {
    return {
      status: "erro",
      planoCursoId: null,
      lancamentos: [],
      pendencias: [
        `Não foi possível ler os planos do curso no Sponte: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  const plano = escolherPlanoDoAnoLetivo(planos, entrada.anoLetivo);
  if (!plano) {
    return {
      status: "sem_plano",
      planoCursoId: null,
      lancamentos: [],
      pendencias: [
        `Nenhum plano de ${entrada.anoLetivo} cadastrado no Sponte para o curso da série "${entrada.serie}". Lance as cobranças manualmente.`,
      ],
    };
  }

  const [material, opcionais] = await Promise.all([
    materialAnualDaSerie(entrada.unidade, entrada.serie),
    valoresOpcionaisDaUnidade(entrada.unidade),
  ]);

  const planejado = montarPlanoFaturamento({
    plano,
    anoLetivo: entrada.anoLetivo,
    dataMatricula: entrada.dataMatricula,
    serie: entrada.serie,
    materialValorAnual: material?.valorAnual ?? null,
    materialParcelas: entrada.materialParcelas,
    refeicoes: entrada.refeicoes,
    semRefeicoes: entrada.semRefeicoes,
    valorRefeicao: opcionais.valorRefeicao,
    horarioEstendido: entrada.horarioEstendido,
    valorHoraExtraMensal: opcionais.valorHoraExtra,
  });

  if (planejado.lancamentos.length === 0) {
    return {
      status: "sem_plano",
      planoCursoId: plano.planoCursoId,
      lancamentos: [],
      pendencias: planejado.pendencias,
    };
  }

  const existentes = await linhasExistentes(entrada.submissionId);
  const resultados: ResultadoLancamento[] = [];

  for (const l of planejado.lancamentos) {
    const existente = existentes.find((linha) => linha.tipo === l.tipo);
    const linha = await reivindicar(entrada, l, existente);
    if (!linha) {
      if (existente?.sponte_conta_receber_id) {
        resultados.push({
          tipo: l.tipo,
          status: existente.status === "ajuste_pendente" ? "ajuste_pendente" : "lancado",
          parcelas: l.parcelas,
          valorParcela: l.valorParcela,
          valorPrimeiraParcela: l.valorPrimeiraParcela,
          primeiroVencimento: l.primeiroVencimento,
          total: l.total,
          contaReceberId: existente.sponte_conta_receber_id,
          erro: null,
        });
        continue;
      }
      resultados.push({
        tipo: l.tipo,
        status: "erro",
        parcelas: l.parcelas,
        valorParcela: l.valorParcela,
        valorPrimeiraParcela: l.valorPrimeiraParcela,
        primeiroVencimento: l.primeiroVencimento,
        total: l.total,
        contaReceberId: null,
        erro: "Não foi possível registrar o lançamento no School Hub — nada foi enviado ao Sponte.",
      });
      continue;
    }
    resultados.push(await lancar(entrada, l, linha.id));
  }

  const falhou = resultados.some((r) => r.status !== "lancado");
  return {
    status: falhou ? "parcial" : "lancado",
    planoCursoId: plano.planoCursoId,
    lancamentos: resultados,
    pendencias: [
      ...planejado.pendencias,
      ...resultados.flatMap((r) => (r.erro ? [`${r.tipo}: ${r.erro}`] : [])),
    ],
  };
}
