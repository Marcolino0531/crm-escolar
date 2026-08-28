// Rota TEMPORÁRIA de homologação da Rematrícula (Fase A), montada a partir do
// server entry (`src/server.ts`), antes do roteador da app:
//
//   POST /api/admin/test-material-pedagogico
//
// Serve para exercitar, contra o Sponte REAL do CEC, as duas escritas que a
// Fase B vai depender — e que nunca foram usadas em produção:
//
//   1. `InsertPlano` com nNumeroParcelas = 8 na categoria "Material
//      Pedagógico", com ajuste dos centavos da última parcela e conferência
//      via `GetParcelas`.
//   2. `UpdateAlunos3` / `UpdateResponsaveis2` alterando SOMENTE CEP e
//      telefone, com releitura campo a campo para provar que nada além disso
//      mudou.
//
// Travas desta rota:
//   • exige sessão de ADMINISTRADOR do School Hub (Bearer do Supabase + role);
//   • só opera na unidade CEC e só no aluno de nome exato
//     "Aluno Teste Homologação" — qualquer outro aluno é recusado;
//   • as credenciais saem de process.env em runtime e NUNCA são logadas,
//     devolvidas ou gravadas;
//   • a criação financeira é idempotente: com títulos de material já lançados
//     nos mesmos vencimentos, a rota devolve os IDs existentes em vez de
//     duplicar a cobrança;
//   • a API do Sponte NÃO tem método de exclusão de conta a receber
//     (só Insert/Update), então a resposta informa os IDs criados para
//     exclusão manual — a rota nunca reporta limpeza que não fez.
//
// Depois de validado o resultado, a rota é removida: é ferramenta de teste, não
// funcionalidade.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  atualizarParcelaSponte,
  coletarTitulosAluno,
  callSponte,
  checkFault,
  inserirPlanoSponte,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
  type TituloSponteAluno,
} from "@/lib/sponte.functions";
import {
  atualizarFichaAlunoSponte,
  atualizarFichaResponsavelSponte,
  lerFichaAlunoSponte,
  lerFichaResponsavelSponte,
} from "@/lib/sponte-cadastro.functions";
import {
  aplicarEdicao,
  camposAlterados,
  camposEsvaziados,
  divergenciasForaDaEdicao,
  CAMPOS_EDITAVEIS_ALUNO,
} from "@/lib/sponte-cadastro";
import {
  CATEGORIA_MATERIAL_SPONTE,
  parcelasMaterialLancamento,
  primeiroVencimentoMaterial,
  type ParcelaMaterial,
} from "@/lib/rematricula";

const ROTA = "/api/admin/test-material-pedagogico";

// Trava dura de escopo: a homologação roda só nesta unidade e neste aluno.
const UNIDADE_HOMOLOGACAO = "CEC";
const NOME_ALUNO_HOMOLOGACAO = "Aluno Teste Homologação";

// Marcador da observação — identifica os títulos criados pelo teste no Sponte.
const MARCADOR = "HOMOLOG-REMATRICULA-FASE-A";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hojeYMD(): string {
  // A Vercel roda em UTC; o dia de calendário do colégio é o de Brasília.
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─── Autorização: sessão do Supabase + role admin ───────────────────────────

// Resposta genérica de propósito: a rota não conta a um chamador não
// autenticado se o problema foi o token ou a falta de permissão.
async function autorizadoComoAdmin(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const token = header ? (/^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "") : "";
  if (!token) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return false;

  const { data: roles, error: erroRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (erroRoles) return false;

  return (roles ?? []).some((r) => (r as { role?: string }).role === "admin");
}

// ─── Localização do aluno de homologação ────────────────────────────────────

interface AlunoHomologacao {
  alunoId: string;
  nome: string;
  situacao: string;
  turma: string;
}

async function acharAlunoHomologacao(): Promise<
  { aluno: AlunoHomologacao } | { erro: string; candidatos?: number }
> {
  const creds = resolverCredenciais(UNIDADE_HOMOLOGACAO);
  if (!creds) {
    return {
      erro: `Credenciais da unidade ${UNIDADE_HOMOLOGACAO} não configuradas neste ambiente.`,
    };
  }

  let xml: string;
  try {
    xml = await callSponte(
      "GetAlunos",
      `Nome=${NOME_ALUNO_HOMOLOGACAO}`,
      creds.codigoCliente,
      creds.token,
    );
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao consultar o Sponte." };
  }
  const fault = checkFault(xml);
  if (fault) return { erro: fault };

  const alvo = normalizar(NOME_ALUNO_HOMOLOGACAO);
  const encontrados = parseXmlList(xml, "wsAluno")
    .filter((n) => parseXmlValue(n, "RetornoOperacao").startsWith("01"))
    .map((n) => ({
      alunoId: parseXmlValue(n, "AlunoID"),
      nome: parseXmlValue(n, "Nome"),
      situacao: parseXmlValue(n, "Situacao"),
      turma: parseXmlValue(n, "TurmaAtual"),
    }))
    // Nome EXATO: o filtro do Sponte é "contém", e um homônimo parcial não pode
    // receber cobrança de teste.
    .filter((a) => a.alunoId && normalizar(a.nome) === alvo);

  if (encontrados.length === 0) {
    return { erro: `Aluno "${NOME_ALUNO_HOMOLOGACAO}" não encontrado no ${UNIDADE_HOMOLOGACAO}.` };
  }
  if (encontrados.length > 1) {
    return {
      erro: `Mais de um aluno com o nome exato "${NOME_ALUNO_HOMOLOGACAO}" — teste abortado para não escrever no aluno errado.`,
      candidatos: encontrados.length,
    };
  }
  return { aluno: encontrados[0] };
}

// ─── Etapa 1: parcelamento do material ──────────────────────────────────────

interface ParcelaConferida {
  numero: number;
  contaReceberID: string;
  numeroParcela: string;
  vencimentoEsperado: string;
  vencimentoSponte: string;
  vencimentoOk: boolean;
  valorEsperado: number;
  valorSponte: number;
  valorOk: boolean;
}

function daCategoriaMaterial(t: TituloSponteAluno): boolean {
  return normalizar(t.categoria).includes(normalizar(CATEGORIA_MATERIAL_SPONTE));
}

async function rodarTesteFinanceiro(
  aluno: AlunoHomologacao,
  valorAnual: number,
  quantidade: number,
  ajustarUltimaParcela: boolean,
  ajustarVencimentos: boolean,
): Promise<Record<string, unknown>> {
  const titulosAntes = await coletarTitulosAluno(UNIDADE_HOMOLOGACAO, aluno.alunoId);
  if (titulosAntes.error || titulosAntes.indisponivel) {
    return {
      ok: false,
      etapa: "financeiro",
      error: titulosAntes.error ?? "Unidade sem integração Sponte.",
    };
  }

  const referencia = primeiroVencimentoMaterial(titulosAntes.titulos, hojeYMD());
  const cronograma = parcelasMaterialLancamento(valorAnual, quantidade, referencia.vencimento);
  const vencimentosEsperados = cronograma.map((p) => p.vencimento);

  // Idempotência: material já lançado nos mesmos vencimentos não é lançado de
  // novo (o Sponte aceitaria a duplicidade sem reclamar).
  const jaLancados = titulosAntes.titulos.filter(
    (t) => daCategoriaMaterial(t) && vencimentosEsperados.includes(t.vencimento),
  );
  if (jaLancados.length > 0) {
    return {
      ok: false,
      etapa: "financeiro",
      motivo: "material_ja_lancado",
      error:
        "Já existem títulos de material nos vencimentos deste cronograma — nada foi lançado para não duplicar a cobrança.",
      cronogramaEsperado: cronograma,
      titulosExistentes: jaLancados.map((t) => ({
        contaReceberID: t.contaReceberID,
        numeroParcela: t.numeroParcela,
        vencimento: t.vencimento,
        valor: t.valor,
        situacao: t.situacao,
      })),
    };
  }

  // Uma chamada só, com nNumeroParcelas = 8. Todas as parcelas saem com o valor
  // base (o InsertPlano não aceita valor por parcela); a diferença de centavos
  // vai para a última via UpdateParcela.
  const base = cronograma[0].valor;
  const observacao = `${MARCADOR} ${referencia.vencimento} ${quantidade}x`;
  const insercao = await inserirPlanoSponte({
    unidade: UNIDADE_HOMOLOGACAO,
    sponteAlunoId: aluno.alunoId,
    valor: base,
    vencimento: referencia.vencimento,
    categoria: CATEGORIA_MATERIAL_SPONTE,
    observacao,
    parcelas: quantidade,
    logTag: "[homologacao-rematricula]",
  });

  if (!insercao.ok) {
    return {
      ok: false,
      etapa: "financeiro",
      passo: "InsertPlano",
      error: insercao.error ?? "O Sponte não confirmou a criação do título.",
      retornoOperacao: insercao.retornoOperacao,
      cronogramaEsperado: cronograma,
    };
  }

  const contaReceberID = insercao.contaReceberID ?? "";
  const idsAntes = new Set(
    titulosAntes.titulos.map((t) => `${t.contaReceberID}#${t.numeroParcela}`),
  );

  const conferir = async (): Promise<{ criadas: TituloSponteAluno[]; error?: string }> => {
    const depois = await coletarTitulosAluno(UNIDADE_HOMOLOGACAO, aluno.alunoId);
    if (depois.error || depois.indisponivel) {
      return { criadas: [], error: depois.error ?? "Unidade sem integração Sponte." };
    }
    const criadas = depois.titulos.filter(
      (t) =>
        daCategoriaMaterial(t) &&
        !idsAntes.has(`${t.contaReceberID}#${t.numeroParcela}`) &&
        (contaReceberID ? t.contaReceberID === contaReceberID : true),
    );
    criadas.sort(
      (a, b) =>
        a.vencimento.localeCompare(b.vencimento) ||
        parseInt(a.numeroParcela, 10) - parseInt(b.numeroParcela, 10),
    );
    return { criadas };
  };

  const primeira = await conferir();
  if (primeira.error) {
    return {
      ok: false,
      etapa: "financeiro",
      passo: "GetParcelas",
      error: primeira.error,
      contaReceberID,
      aviso:
        "O título pode ter sido criado: confira o AlunoID no Sponte antes de repetir o teste (a rota não repete sozinha).",
    };
  }

  const criadas = primeira.criadas;
  const ajustes: Record<string, unknown>[] = [];

  // Ajuste dos centavos da última parcela e, se o Sponte não tiver empurrado
  // vencimento de fim de semana/feriado, das datas divergentes.
  if (criadas.length === quantidade) {
    const ultima = criadas[criadas.length - 1];
    const valorUltimaEsperado = cronograma[cronograma.length - 1].valor;
    if (
      ajustarUltimaParcela &&
      Math.round(ultima.valor * 100) !== Math.round(valorUltimaEsperado * 100)
    ) {
      const r = await atualizarParcelaSponte({
        unidade: UNIDADE_HOMOLOGACAO,
        contaReceberId: ultima.contaReceberID,
        numeroParcela: parseInt(ultima.numeroParcela, 10),
        valor: valorUltimaEsperado,
      });
      ajustes.push({
        tipo: "valor_ultima_parcela",
        contaReceberID: ultima.contaReceberID,
        numeroParcela: ultima.numeroParcela,
        de: ultima.valor,
        para: valorUltimaEsperado,
        ok: r.ok,
        error: r.error,
      });
    }
    if (ajustarVencimentos) {
      for (let i = 0; i < criadas.length; i++) {
        const esperado = cronograma[i].vencimento;
        if (criadas[i].vencimento === esperado) continue;
        const r = await atualizarParcelaSponte({
          unidade: UNIDADE_HOMOLOGACAO,
          contaReceberId: criadas[i].contaReceberID,
          numeroParcela: parseInt(criadas[i].numeroParcela, 10),
          vencimento: esperado,
        });
        ajustes.push({
          tipo: "vencimento",
          contaReceberID: criadas[i].contaReceberID,
          numeroParcela: criadas[i].numeroParcela,
          de: criadas[i].vencimento,
          para: esperado,
          ok: r.ok,
          error: r.error,
        });
      }
    }
  }

  const final = ajustes.length > 0 ? await conferir() : primeira;
  const parcelasFinais = final.criadas.length > 0 ? final.criadas : criadas;

  const conferencia: ParcelaConferida[] = parcelasFinais.map((t, i) => {
    const esperada: ParcelaMaterial | undefined = cronograma[i];
    return {
      numero: i + 1,
      contaReceberID: t.contaReceberID,
      numeroParcela: t.numeroParcela,
      vencimentoEsperado: esperada?.vencimento ?? "",
      vencimentoSponte: t.vencimento,
      vencimentoOk: !!esperada && esperada.vencimento === t.vencimento,
      valorEsperado: esperada?.valor ?? 0,
      valorSponte: t.valor,
      valorOk: !!esperada && Math.round(esperada.valor * 100) === Math.round(t.valor * 100),
    };
  });

  const somaSponte = parcelasFinais.reduce((acc, t) => acc + Math.round(t.valor * 100), 0) / 100;
  const quantidadeOk = parcelasFinais.length === quantidade;
  const valoresOk = conferencia.every((c) => c.valorOk);
  const vencimentosOk = conferencia.every((c) => c.vencimentoOk);
  const totalOk = Math.round(somaSponte * 100) === Math.round(valorAnual * 100);

  return {
    ok: quantidadeOk && valoresOk && vencimentosOk && totalOk,
    etapa: "financeiro",
    unidade: UNIDADE_HOMOLOGACAO,
    alunoId: aluno.alunoId,
    categoria: CATEGORIA_MATERIAL_SPONTE,
    chamada: { metodo: "InsertPlano", nNumeroParcelas: quantidade, nValorParcelas: base },
    contaReceberID,
    retornoOperacao: insercao.retornoOperacao,
    primeiroVencimento: referencia,
    valorAnual,
    parcelas: conferencia,
    ajustesAplicados: ajustes,
    resumo: {
      quantidadeCriada: parcelasFinais.length,
      quantidadeEsperada: quantidade,
      quantidadeOk,
      valoresOk,
      vencimentosOk,
      somaSponte,
      totalOk,
      ajusteCentavosUltimaParcela: {
        esperado: cronograma[cronograma.length - 1].valor,
        noSponte:
          parcelasFinais.length > 0 ? parcelasFinais[parcelasFinais.length - 1].valor : null,
      },
    },
    limpeza: {
      feita: false,
      motivo:
        "A API do Sponte não expõe método de exclusão de conta a receber (só Insert/Update) — os títulos abaixo precisam ser excluídos manualmente no Sponte.",
      contaReceberIDs: [...new Set(parcelasFinais.map((t) => t.contaReceberID))],
      marcadorObservacao: MARCADOR,
    },
  };
}

// ─── Etapa 2: sincronização cadastral ───────────────────────────────────────

interface EdicaoTeste {
  cep: string;
  telefone: string;
}

async function rodarTesteCadastralAluno(
  aluno: AlunoHomologacao,
  edicao: EdicaoTeste,
  restaurar: boolean,
): Promise<Record<string, unknown>> {
  const antes = await lerFichaAlunoSponte(UNIDADE_HOMOLOGACAO, aluno.alunoId);
  if (!antes.ficha) {
    return {
      ok: false,
      alvo: "aluno",
      passo: "GetAlunos",
      error: antes.error ?? "Unidade sem integração Sponte.",
    };
  }

  const original = antes.ficha;
  const aEnviar = aplicarEdicao(original, edicao, CAMPOS_EDITAVEIS_ALUNO);
  const esvaziados = camposEsvaziados(original, aEnviar);
  if (esvaziados.length > 0) {
    return {
      ok: false,
      alvo: "aluno",
      passo: "montagem_payload",
      error: "Payload esvaziaria campos preenchidos na leitura — escrita abortada.",
      campos: esvaziados,
    };
  }

  const alterados = camposAlterados(original, aEnviar);
  const escrita = await atualizarFichaAlunoSponte(UNIDADE_HOMOLOGACAO, aEnviar);
  if (!escrita.ok) {
    return {
      ok: false,
      alvo: "aluno",
      passo: "UpdateAlunos3",
      error: escrita.error,
      retornoOperacao: escrita.retornoOperacao,
      alterados,
    };
  }

  const depois = await lerFichaAlunoSponte(UNIDADE_HOMOLOGACAO, aluno.alunoId);
  if (!depois.ficha) {
    return {
      ok: false,
      alvo: "aluno",
      passo: "releitura",
      error: depois.error ?? "Falha ao reler a ficha.",
      alterados,
      restauracaoPendente: alterados,
    };
  }

  const editados = alterados.map((a) => a.campo);
  const divergencias = divergenciasForaDaEdicao(original, depois.ficha, editados);
  const aplicadas = editados.map((campo) => ({
    campo,
    enviado: String((aEnviar as unknown as Record<string, unknown>)[campo] ?? ""),
    noSponte: String((depois.ficha as unknown as Record<string, unknown>)[campo] ?? ""),
  }));

  // Restauração só quando a releitura provou que a escrita se comporta: com
  // divergência, o cadastro fica como está e o valor original é devolvido para
  // correção manual (a rota não tenta uma segunda escrita em cima de um método
  // que já se mostrou destrutivo).
  let restauracao: Record<string, unknown> = { feita: false };
  if (restaurar && divergencias.length === 0) {
    const volta = await atualizarFichaAlunoSponte(UNIDADE_HOMOLOGACAO, original);
    const rele = volta.ok ? await lerFichaAlunoSponte(UNIDADE_HOMOLOGACAO, aluno.alunoId) : null;
    const conferida =
      rele?.ficha != null && divergenciasForaDaEdicao(original, rele.ficha, []).length === 0;
    restauracao = {
      feita: volta.ok && conferida,
      confirmadaPorReleitura: conferida,
      error: volta.error,
      restauracaoPendente: volta.ok && conferida ? [] : alterados,
    };
  } else if (restaurar) {
    restauracao = {
      feita: false,
      motivo: "Releitura acusou divergência: nada foi reescrito.",
      restauracaoPendente: alterados,
    };
  }

  return {
    ok: divergencias.length === 0,
    alvo: "aluno",
    metodo: "UpdateAlunos3",
    retornoOperacao: escrita.retornoOperacao,
    camposEditados: aplicadas,
    // Vínculos: provam que os IDs foram repassados como lidos, não recalculados.
    vinculos: {
      responsavelFinanceiroIdAntes: original.responsavelFinanceiroId,
      responsavelFinanceiroIdDepois: depois.ficha.responsavelFinanceiroId,
      responsavelDidaticoIdAntes: original.responsavelDidaticoId,
      responsavelDidaticoIdDepois: depois.ficha.responsavelDidaticoId,
    },
    camposPreservados: Object.keys(original).length - editados.length,
    divergencias,
    restauracao,
  };
}

async function rodarTesteCadastralResponsavel(
  aluno: AlunoHomologacao,
  edicao: EdicaoTeste,
  restaurar: boolean,
): Promise<Record<string, unknown>> {
  const fichaAluno = await lerFichaAlunoSponte(UNIDADE_HOMOLOGACAO, aluno.alunoId);
  if (!fichaAluno.ficha) {
    return {
      ok: false,
      alvo: "responsavel",
      passo: "GetAlunos",
      error: fichaAluno.error ?? "Unidade sem integração Sponte.",
    };
  }
  const responsavelId = fichaAluno.ficha.responsavelFinanceiroId;
  if (!responsavelId) {
    return {
      ok: false,
      alvo: "responsavel",
      error: "Aluno de homologação sem responsável financeiro no Sponte.",
    };
  }

  const antes = await lerFichaResponsavelSponte(
    UNIDADE_HOMOLOGACAO,
    aluno.alunoId,
    responsavelId,
    fichaAluno.ficha.responsavelFinanceiroId,
    fichaAluno.ficha.responsavelDidaticoId,
  );
  if (!antes.ficha) {
    return {
      ok: false,
      alvo: "responsavel",
      passo: "GetResponsaveis",
      error: antes.error ?? "Unidade sem integração Sponte.",
    };
  }

  const original = antes.ficha;
  const aEnviar = aplicarEdicao(original, edicao, CAMPOS_EDITAVEIS_ALUNO);
  const esvaziados = camposEsvaziados(original, aEnviar);
  if (esvaziados.length > 0) {
    return {
      ok: false,
      alvo: "responsavel",
      passo: "montagem_payload",
      error: "Payload esvaziaria campos preenchidos na leitura — escrita abortada.",
      campos: esvaziados,
    };
  }

  const alterados = camposAlterados(original, aEnviar);
  const escrita = await atualizarFichaResponsavelSponte(UNIDADE_HOMOLOGACAO, aEnviar);
  if (!escrita.ok) {
    return {
      ok: false,
      alvo: "responsavel",
      passo: "UpdateResponsaveis2",
      error: escrita.error,
      retornoOperacao: escrita.retornoOperacao,
      alterados,
    };
  }

  const fichaAlunoDepois = await lerFichaAlunoSponte(UNIDADE_HOMOLOGACAO, aluno.alunoId);
  const depois = await lerFichaResponsavelSponte(
    UNIDADE_HOMOLOGACAO,
    aluno.alunoId,
    responsavelId,
    fichaAlunoDepois.ficha?.responsavelFinanceiroId ?? "",
    fichaAlunoDepois.ficha?.responsavelDidaticoId ?? "",
  );
  if (!depois.ficha) {
    return {
      ok: false,
      alvo: "responsavel",
      passo: "releitura",
      error: depois.error ?? "Falha ao reler a ficha.",
      alterados,
      restauracaoPendente: alterados,
    };
  }

  const editados = alterados.map((a) => a.campo);
  const divergencias = divergenciasForaDaEdicao(original, depois.ficha, editados);

  let restauracao: Record<string, unknown> = { feita: false };
  if (restaurar && divergencias.length === 0) {
    const volta = await atualizarFichaResponsavelSponte(UNIDADE_HOMOLOGACAO, original);
    const rele = volta.ok
      ? await lerFichaResponsavelSponte(
          UNIDADE_HOMOLOGACAO,
          aluno.alunoId,
          responsavelId,
          fichaAluno.ficha.responsavelFinanceiroId,
          fichaAluno.ficha.responsavelDidaticoId,
        )
      : null;
    const conferida =
      rele?.ficha != null && divergenciasForaDaEdicao(original, rele.ficha, []).length === 0;
    restauracao = {
      feita: volta.ok && conferida,
      confirmadaPorReleitura: conferida,
      error: volta.error,
      restauracaoPendente: volta.ok && conferida ? [] : alterados,
    };
  } else if (restaurar) {
    restauracao = {
      feita: false,
      motivo: "Releitura acusou divergência: nada foi reescrito.",
      restauracaoPendente: alterados,
    };
  }

  return {
    ok: divergencias.length === 0,
    alvo: "responsavel",
    metodo: "UpdateResponsaveis2",
    responsavelId,
    retornoOperacao: escrita.retornoOperacao,
    camposEditados: editados.map((campo) => ({
      campo,
      enviado: String((aEnviar as unknown as Record<string, unknown>)[campo] ?? ""),
      noSponte: String((depois.ficha as unknown as Record<string, unknown>)[campo] ?? ""),
    })),
    // O ponto crítico do UpdateResponsaveis2: os papéis do responsável não podem
    // ter mudado (quem recebe o boleto continua o mesmo).
    vinculos: {
      responsavelFinanceiroAntes: original.responsavelFinanceiro,
      responsavelFinanceiroDepois: depois.ficha.responsavelFinanceiro,
      responsavelDidaticoAntes: original.responsavelDidatico,
      responsavelDidaticoDepois: depois.ficha.responsavelDidatico,
      responsavelFinanceiroIdDoAlunoAntes: fichaAluno.ficha.responsavelFinanceiroId,
      responsavelFinanceiroIdDoAlunoDepois: fichaAlunoDepois.ficha?.responsavelFinanceiroId ?? "",
      parentescoAntes: original.parentesco,
      parentescoDepois: depois.ficha.parentesco,
    },
    divergencias,
    restauracao,
  };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

interface CorpoTeste {
  etapa?: "financeiro" | "cadastral" | "diagnostico";
  valorAnual?: number;
  parcelas?: number;
  ajustarUltimaParcela?: boolean;
  ajustarVencimentos?: boolean;
  alvoCadastral?: "aluno" | "responsavel";
  cep?: string;
  telefone?: string;
  restaurar?: boolean;
}

export async function handleRematriculaHomologacaoApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROTA) return null;
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  if (!(await autorizadoComoAdmin(request))) {
    return json({ error: "Não autorizado." }, 401);
  }

  let corpo: CorpoTeste = {};
  try {
    const bruto = await request.text();
    if (bruto.trim()) corpo = JSON.parse(bruto) as CorpoTeste;
  } catch {
    return json({ error: "Corpo inválido: esperado JSON." }, 400);
  }

  const localizado = await acharAlunoHomologacao();
  if ("erro" in localizado) return json({ ok: false, error: localizado.erro }, 422);
  const aluno = localizado.aluno;

  if (normalizar(aluno.situacao).includes("inativ")) {
    return json(
      {
        ok: false,
        error: `Aluno de homologação está com situação "${aluno.situacao}" no Sponte — teste abortado.`,
      },
      422,
    );
  }

  const etapa = corpo.etapa ?? "diagnostico";

  if (etapa === "diagnostico") {
    const titulos = await coletarTitulosAluno(UNIDADE_HOMOLOGACAO, aluno.alunoId);
    const referencia = titulos.titulos.length
      ? primeiroVencimentoMaterial(titulos.titulos, hojeYMD())
      : null;
    return json({
      ok: !titulos.error,
      etapa,
      unidade: UNIDADE_HOMOLOGACAO,
      aluno: { alunoId: aluno.alunoId, situacao: aluno.situacao, turma: aluno.turma },
      // Só datas/valores/categoria: nada de dado pessoal do cadastro aqui.
      titulosEmAberto: titulos.titulos
        .filter((t) => !t.quitada)
        .map((t) => ({
          contaReceberID: t.contaReceberID,
          numeroParcela: t.numeroParcela,
          vencimento: t.vencimento,
          categoria: t.categoria,
          valor: t.valor,
          saldo: t.saldo,
        })),
      primeiroVencimentoMaterial: referencia,
      error: titulos.error,
    });
  }

  if (etapa === "financeiro") {
    const valorAnual = typeof corpo.valorAnual === "number" ? corpo.valorAnual : 800;
    const parcelas = typeof corpo.parcelas === "number" ? corpo.parcelas : 8;
    if (!(valorAnual > 0) || parcelas < 1 || parcelas > 8) {
      return json(
        { ok: false, error: "valorAnual deve ser positivo e parcelas entre 1 e 8." },
        400,
      );
    }
    const resultado = await rodarTesteFinanceiro(
      aluno,
      valorAnual,
      parcelas,
      corpo.ajustarUltimaParcela !== false,
      corpo.ajustarVencimentos !== false,
    );
    return json(resultado);
  }

  if (etapa === "cadastral") {
    const cep = (corpo.cep ?? "").trim();
    const telefone = (corpo.telefone ?? "").trim();
    if (!cep || !telefone) {
      return json({ ok: false, error: "Informe cep e telefone de teste." }, 400);
    }
    const edicao = { cep, telefone };
    const restaurar = corpo.restaurar !== false;
    const resultado =
      corpo.alvoCadastral === "responsavel"
        ? await rodarTesteCadastralResponsavel(aluno, edicao, restaurar)
        : await rodarTesteCadastralAluno(aluno, edicao, restaurar);
    return json({ ...resultado, etapa, unidade: UNIDADE_HOMOLOGACAO, alunoId: aluno.alunoId });
  }

  return json({ error: "Etapa desconhecida." }, 400);
}
