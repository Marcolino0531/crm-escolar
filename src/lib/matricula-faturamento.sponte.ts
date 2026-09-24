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
  ROTULO_TIPO_LANCAMENTO,
  escolherPlanoDoAnoLetivo,
  montarPlanoFaturamento,
  parcelasComAjuste,
  statusGeralFaturamento,
  type ItemPlanoCurso,
  type LancamentoPlanejado,
  type PlanoCursoSponte,
  type TipoLancamentoMatricula,
} from "@/lib/matricula-faturamento";
import { cursoIdDaSerie } from "@/lib/matricula-turma";
import { buscarCursos } from "@/lib/matricula-turma.sponte";
import { chaveSerie } from "@/lib/rematricula";
import { valorMatricula } from "@/lib/rematricula-matricula";
import { valoresMatriculaDoAno } from "@/lib/rematricula.functions";
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

// Valor do material só do ano letivo da matrícula — nunca de outro ano.
export async function materialAnualDaSerie(
  unidade: string,
  serie: string,
  anoLetivo: number,
): Promise<{ valorAnual: number; serieCadastrada: string } | null> {
  if (!anoLetivo) return null;
  const { data } = await supabaseAdmin
    .from("material_pedagogico_series" as never)
    .select("serie, valor_anual")
    .eq("unidade", unidade)
    .eq("ano_letivo", anoLetivo)
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

// 'sem_plano' fica só no histórico de submissões antigas.
export type StatusFaturamento = "lancado" | "parcial" | "sem_lancamento" | "sem_plano" | "erro";

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
  serie: string;
  anoLetivo: number;
  dataMatricula: string;
  matriculaParcelas: number | null;
  matriculaPrimeiroVencimento: string | null;
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

  const ajustes = parcelasComAjuste(l);
  if (ajustes.length === 0) {
    return { ...base, status: "lancado", contaReceberId };
  }

  const falhas: string[] = [];
  for (const item of ajustes) {
    const ajuste = await atualizarParcelaSponte({
      unidade: entrada.unidade,
      contaReceberId,
      numeroParcela: item.numero,
      valor: item.valor,
      vencimento: item.vencimento,
      categoria: l.categoria,
      observacao: l.observacao,
      logTag: LOG_TAG,
    });
    if (!ajuste.ok) {
      falhas.push(
        `parcela ${item.numero} → ${item.valor.toFixed(2)} em ${item.vencimento} (${ajuste.error ?? "o Sponte não confirmou"})`,
      );
    }
  }

  if (falhas.length > 0) {
    const erro = `Cobrança criada (conta ${contaReceberId}), mas o ajuste de parcelas falhou: ${falhas.join("; ")}. Corrija no Sponte. NÃO lance novamente.`;
    await registrar(linhaId, { status: "ajuste_pendente", contaReceberId, erro });
    return { ...base, status: "ajuste_pendente", contaReceberId, erro };
  }

  return { ...base, status: "lancado", contaReceberId };
}

/** Plano do curso da série no Sponte; `erro` quando a leitura falhou (pendência só da mensalidade). */
async function planoDaSerie(
  creds: Credenciais,
  entrada: EntradaFaturamento,
): Promise<{ plano: PlanoCursoSponte | null; erro: string | null }> {
  try {
    const cursos = await buscarCursos(creds);
    const cursoId = cursoIdDaSerie(entrada.serie, cursos);
    if (cursoId === null) {
      return {
        plano: null,
        erro: `Nenhum curso do Sponte corresponde à série "${entrada.serie}".`,
      };
    }
    const planos = await buscarPlanosCurso(creds, cursoId);
    return { plano: escolherPlanoDoAnoLetivo(planos, entrada.anoLetivo), erro: null };
  } catch (e) {
    return {
      plano: null,
      erro: `Não foi possível ler o plano do curso no Sponte: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function valorMatriculaDaSerie(entrada: EntradaFaturamento): Promise<number | null> {
  try {
    const valores = await valoresMatriculaDoAno(entrada.unidade, entrada.anoLetivo);
    return valorMatricula(valores, entrada.serie);
  } catch (e) {
    console.error(`${LOG_TAG} falha ao ler o valor da Matrícula:`, e);
    return null;
  }
}

/**
 * Faturamento da matrícula nova assim que o aluno existe no Sponte (não depende
 * da turma): resolve o curso pela série, lê valores (plano, Matrícula, material,
 * opcionais), monta o cronograma por tipo e lança cada título de forma
 * independente. Nada aqui desfaz cadastro ou matrícula — o que falha volta como
 * pendência do próprio tipo.
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

  const [{ plano, erro: erroPlano }, matriculaValor, material, opcionais] = await Promise.all([
    planoDaSerie(creds, entrada),
    valorMatriculaDaSerie(entrada),
    materialAnualDaSerie(entrada.unidade, entrada.serie, entrada.anoLetivo),
    valoresOpcionaisDaUnidade(entrada.unidade),
  ]);

  const planejado = montarPlanoFaturamento({
    plano,
    anoLetivo: entrada.anoLetivo,
    dataMatricula: entrada.dataMatricula,
    serie: entrada.serie,
    matriculaValor,
    matriculaParcelas: entrada.matriculaParcelas,
    matriculaPrimeiroVencimento: entrada.matriculaPrimeiroVencimento,
    materialValorAnual: material?.valorAnual ?? null,
    materialParcelas: entrada.materialParcelas,
    refeicoes: entrada.refeicoes,
    semRefeicoes: entrada.semRefeicoes,
    valorRefeicao: opcionais.valorRefeicao,
    horarioEstendido: entrada.horarioEstendido,
    valorHoraExtraMensal: opcionais.valorHoraExtra,
  });

  const pendencias = planejado.pendencias.map((p) =>
    p.tipo === "mensalidade" && erroPlano
      ? `${ROTULO_TIPO_LANCAMENTO[p.tipo]}: ${erroPlano}`
      : `${ROTULO_TIPO_LANCAMENTO[p.tipo]}: ${p.motivo}`,
  );

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
    try {
      resultados.push(await lancar(entrada, l, linha.id));
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await registrar(linha.id, { status: "erro", erro });
      resultados.push({
        tipo: l.tipo,
        status: "erro",
        parcelas: l.parcelas,
        valorParcela: l.valorParcela,
        valorPrimeiraParcela: l.valorPrimeiraParcela,
        primeiroVencimento: l.primeiroVencimento,
        total: l.total,
        contaReceberId: null,
        erro,
      });
    }
  }

  const lancados = resultados.filter((r) => r.status === "lancado").length;
  const comProblema = resultados.length - lancados + planejado.pendencias.length;
  return {
    status: statusGeralFaturamento(lancados, comProblema),
    planoCursoId: plano?.planoCursoId ?? null,
    lancamentos: resultados,
    pendencias: [
      ...pendencias,
      ...resultados.flatMap((r) =>
        r.erro ? [`${ROTULO_TIPO_LANCAMENTO[r.tipo]}: ${r.erro}`] : [],
      ),
    ],
  };
}
