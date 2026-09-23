// Régua MANUAL de cobrança — server functions. Toda leitura/escrita passa pelo
// service role com RBAC do módulo financeiro_cobranca e RBAC por unidade
// (allowedSponteUnidades) validados AQUI. Nada grava em whatsapp_billing_logs.

import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BUCKET_COBRANCA,
  CATEGORIAS_ANEXO,
  MOTIVOS_ENCERRAMENTO,
  TOTAL_MENSAGENS,
  datasMensagens,
  montarDemonstrativo,
  prazoFinalNotificacao,
  responsavelKey,
  somenteDigitos,
  validarArquivoAnexo,
  validarEncerramento,
  validarRegistroMensagem,
  type AlunoCaso,
  type AnexoCaso,
  type CasoCompleto,
  type CasoResumo,
  type CategoriaAnexo,
  type DemonstrativoDebito,
  type EnderecoResponsavel,
  type MensagemCaso,
  type ParcelaAbertaAluno,
} from "@/lib/cobranca-casos";
import { buscarResponsavelPorCpf } from "@/lib/matriculas.sponte";
import {
  allowedSponteUnidades,
  callSponte,
  checkFault,
  classificarUnidade,
  coletarDividaAbertaAluno,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";
import { fetchAllRows } from "@/lib/supabase-paginate";

const VALIDADE_LINK = 60 * 60; // 1h
const LOG = "[cobrança manual]";

// ─── Permissões ──────────────────────────────────────────────────────────────

export async function exigirPermissao(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "financeiro_cobranca" } as never,
  );
  if (error) throw new Error(error.message);
  if (data) return;
  throw new Error(
    edicao
      ? "Você não tem permissão para editar a Cobrança."
      : "Você não tem permissão para ver a Cobrança.",
  );
}

export async function exigirUnidade(userId: string, unidade: string): Promise<void> {
  const allowed = await allowedSponteUnidades(userId);
  if (allowed !== null && !allowed.includes(unidade))
    throw new Error("Sem permissão para esta unidade.");
}

export function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// ─── Linhas do banco ─────────────────────────────────────────────────────────

type CasoRow = Omit<CasoCompleto, "valor_inicial"> & { valor_inicial: number | string };

const SELECT_CASO =
  "id, unidade, responsavel_key, responsavel_nome, responsavel_cpf, responsavel_telefone, responsavel_email, responsavel_endereco, alunos, debito_inicial, valor_inicial, status, iniciado_em, iniciado_por, notificacao_gerada_em, notificacao_recebida_em, prazo_final, documentacao_concluida, encerrado_em, encerrado_por, motivo_encerramento, observacao_encerramento";

function paraCaso(r: CasoRow): CasoCompleto {
  return {
    ...r,
    valor_inicial: Number(r.valor_inicial),
    alunos: (r.alunos ?? []) as AlunoCaso[],
    debito_inicial: r.debito_inicial ?? [],
    documentacao_concluida: r.documentacao_concluida ?? [],
  };
}

export async function carregarCasoRow(casoId: string): Promise<CasoCompleto> {
  const { data, error } = await supabaseAdmin
    .from("cobranca_casos" as never)
    .select(SELECT_CASO)
    .eq("id", casoId)
    .maybeSingle<CasoRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Cobrança não encontrada.");
  return paraCaso(data);
}

async function carregarMensagens(casoId: string): Promise<MensagemCaso[]> {
  const { data, error } = await supabaseAdmin
    .from("cobranca_mensagens" as never)
    .select("id, caso_id, ordem, data_prevista, enviada_em, enviada_por, print_path, fora_da_data")
    .eq("caso_id", casoId)
    .order("ordem")
    .returns<MensagemCaso[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function carregarAnexos(casoId: string): Promise<AnexoCaso[]> {
  const { data, error } = await supabaseAdmin
    .from("cobranca_anexos" as never)
    .select(
      "id, caso_id, categoria, nome_personalizado, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes, origem, created_by, created_at",
    )
    .eq("caso_id", casoId)
    .order("created_at")
    .returns<AnexoCaso[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function exigirAberto(caso: CasoCompleto): void {
  if (caso.status === "encerrado") throw new Error("Cobrança encerrada: somente leitura.");
}

export async function arquivoExiste(path: string): Promise<boolean> {
  const barra = path.lastIndexOf("/");
  const pasta = barra === -1 ? "" : path.slice(0, barra);
  const nome = path.slice(barra + 1);
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_COBRANCA)
    .list(pasta, { search: nome });
  if (error) return false;
  return (data ?? []).some((f) => f.name === nome);
}

export async function linkAssinado(path: string): Promise<string | null> {
  const { data } = await supabaseAdmin.storage
    .from(BUCKET_COBRANCA)
    .createSignedUrl(path, VALIDADE_LINK);
  return data?.signedUrl ?? null;
}

// ─── Sponte ──────────────────────────────────────────────────────────────────

interface AlunoSponte {
  alunoId: string;
  nome: string;
  turma: string;
  responsavelFinanceiroId: string;
}

async function lerAluno(unidade: string, alunoId: string): Promise<AlunoSponte | null> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return null;
  const xml = await callSponte("GetAlunos", `AlunoID=${alunoId}`, creds.codigoCliente, creds.token);
  if (checkFault(xml)) return null;
  const node = parseXmlList(xml, "wsAluno").find((n) =>
    parseXmlValue(n, "RetornoOperacao").startsWith("01"),
  );
  if (!node) return null;
  const turma = parseXmlValue(node, "TurmaAtual");
  // CEC e CEC Baby compartilham a base: só entra quem é da unidade da aba.
  if (creds.segmentaPorTurma && (classificarUnidade(turma) ?? "CEC") !== unidade) return null;
  return {
    alunoId,
    nome: parseXmlValue(node, "Nome"),
    turma,
    responsavelFinanceiroId: parseXmlValue(node, "ResponsavelFinanceiroID"),
  };
}

export interface ResponsavelCaso {
  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: EnderecoResponsavel;
}

async function lerResponsavelFinanceiro(
  unidade: string,
  alunoId: string,
): Promise<ResponsavelCaso | null> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return null;
  const xml = await callSponte(
    "GetResponsavelFinanceiro",
    `AlunoID=${alunoId}`,
    creds.codigoCliente,
    creds.token,
  );
  if (checkFault(xml)) return null;
  const r = parseXmlList(xml, "wsResponsavel").find((n) =>
    parseXmlValue(n, "RetornoOperacao").startsWith("01"),
  );
  if (!r) return null;
  const pick = (...tags: string[]): string => {
    for (const t of tags) {
      const v = parseXmlValue(r, t);
      if (v) return v;
    }
    return "";
  };
  return {
    nome: pick("Nome"),
    cpf: pick("CPFCNPJ", "CPF", "Cpf", "CPF_CNPJ"),
    telefone: pick("Celular", "Telefone"),
    email: pick("Email"),
    endereco: {
      endereco: pick("Endereco", "Logradouro"),
      numero: pick("NumeroEndereco", "Numero"),
      complemento: pick("ComplementoEndereco", "Complemento"),
      bairro: pick("Bairro"),
      cidade: pick("Cidade"),
      estado: pick("Estado", "UF"),
      cep: pick("CEP", "Cep"),
    },
  };
}

/**
 * Todos os alunos do responsável na MESMA unidade: GetResponsaveis por CPF
 * devolve os vínculos (irmãos) na base compartilhada; cada aluno é conferido
 * pela TurmaAtual para ficar só na unidade da aba. Sem CPF, fica só o aluno
 * pesquisado.
 */
async function alunosDoResponsavel(
  unidade: string,
  alunoBase: AlunoSponte,
  responsavel: ResponsavelCaso,
): Promise<AlunoCaso[]> {
  const alunos = new Map<string, AlunoCaso>([
    [alunoBase.alunoId, { aluno_id: alunoBase.alunoId, nome: alunoBase.nome }],
  ]);
  const creds = resolverCredenciais(unidade);
  if (creds && somenteDigitos(responsavel.cpf).length === 11) {
    try {
      const r = await buscarResponsavelPorCpf(responsavel.cpf, creds.codigoCliente, creds.token);
      for (const v of r?.vinculos ?? []) {
        const id = String(v.alunoId);
        if (alunos.has(id)) continue;
        const a = await lerAluno(unidade, id);
        // Só irmãos cujo responsável FINANCEIRO atual é o mesmo.
        if (
          a &&
          (!a.responsavelFinanceiroId ||
            !alunoBase.responsavelFinanceiroId ||
            a.responsavelFinanceiroId === alunoBase.responsavelFinanceiroId)
        )
          alunos.set(id, { aluno_id: id, nome: a.nome });
      }
    } catch (e) {
      console.error(`${LOG} GetResponsaveis por CPF falhou:`, e instanceof Error ? e.message : e);
    }
  }
  return [...alunos.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

async function parcelasAbertasDosAlunos(
  unidade: string,
  alunos: readonly AlunoCaso[],
): Promise<{ parcelas: ParcelaAbertaAluno[]; indisponivel: boolean }> {
  const parcelas: ParcelaAbertaAluno[] = [];
  let indisponivel = false;
  for (const a of alunos) {
    const divida = await coletarDividaAbertaAluno(unidade, a.aluno_id);
    if (!divida) {
      indisponivel = true;
      continue;
    }
    for (const b of divida.boletos) {
      parcelas.push({
        alunoId: a.aluno_id,
        alunoNome: a.nome,
        descricao: b.categorias.length ? b.categorias.join(" + ") : "Parcela",
        vencimento: b.vencimento,
        saldo: b.saldo,
      });
    }
  }
  return { parcelas, indisponivel };
}

// ─── Listagem ────────────────────────────────────────────────────────────────

const UnidadeSchema = z.object({ unidade: z.string().min(1) });
// `unidade` ausente = consolidado do seletor global: todas as unidades
// permitidas ao usuário.
const ListarSchema = z.object({ unidade: z.string().min(1).nullable().optional() });

export interface CasoLista extends CasoResumo {
  mensagens: Pick<MensagemCaso, "ordem" | "enviada_em">[];
  hojeYMD: string;
}

export const listarCasosCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListarSchema.parse(i))
  .handler(async ({ data, context }): Promise<CasoLista[]> => {
    await exigirPermissao(context.userId, false);
    const unidade = data.unidade ?? null;
    if (unidade) await exigirUnidade(context.userId, unidade);
    const permitidas = await allowedSponteUnidades(context.userId);
    if (!unidade && permitidas !== null && permitidas.length === 0) return [];
    const rows = await fetchAllRows<CasoRow>((from, to) => {
      let q = supabaseAdmin.from("cobranca_casos" as never).select(SELECT_CASO);
      if (unidade) q = q.eq("unidade", unidade);
      else if (permitidas !== null) q = q.in("unidade", permitidas);
      return q.order("iniciado_em", { ascending: false }).range(from, to).returns<CasoRow[]>();
    });
    const ids = rows.map((r) => r.id);
    type MsgLeve = Pick<MensagemCaso, "caso_id" | "ordem" | "enviada_em">;
    const msgs = ids.length
      ? await fetchAllRows<MsgLeve>((from, to) =>
          supabaseAdmin
            .from("cobranca_mensagens" as never)
            .select("caso_id, ordem, enviada_em")
            .in("caso_id", ids)
            .order("ordem")
            .range(from, to)
            .returns<MsgLeve[]>(),
        )
      : [];
    const porCaso = new Map<string, Pick<MensagemCaso, "ordem" | "enviada_em">[]>();
    for (const m of msgs) {
      const lista = porCaso.get(m.caso_id) ?? [];
      lista.push({ ordem: m.ordem, enviada_em: m.enviada_em });
      porCaso.set(m.caso_id, lista);
    }
    const hoje = hojeYMD();
    return rows.map((r) => ({
      ...paraCaso(r),
      mensagens: porCaso.get(r.id) ?? [],
      hojeYMD: hoje,
    }));
  });

// ─── Iniciar cobrança ────────────────────────────────────────────────────────

const PrepararSchema = z.object({ unidade: z.string().min(1), alunoId: z.string().min(1) });

export interface PreviaCobranca {
  responsavel: ResponsavelCaso;
  alunos: AlunoCaso[];
  demonstrativo: DemonstrativoDebito;
  /** Caso ativo já existente para o responsável nesta unidade. */
  casoAtivoId: string | null;
  /** Sponte indisponível para algum aluno (parcelas podem estar incompletas). */
  indisponivel: boolean;
  datasPrevistas: string[];
}

async function montarPrevia(unidade: string, alunoId: string): Promise<PreviaCobranca> {
  const aluno = await lerAluno(unidade, alunoId);
  if (!aluno) throw new Error("Aluno não encontrado nesta unidade do Sponte.");
  const responsavel = await lerResponsavelFinanceiro(unidade, alunoId);
  if (!responsavel?.nome) throw new Error("O aluno não tem responsável financeiro no Sponte.");
  const alunos = await alunosDoResponsavel(unidade, aluno, responsavel);
  const { parcelas, indisponivel } = await parcelasAbertasDosAlunos(unidade, alunos);
  const hoje = hojeYMD();
  const demonstrativo = montarDemonstrativo(parcelas, hoje);

  const key = responsavelKey(responsavel.cpf, responsavel.nome);
  const { data: ativo } = await supabaseAdmin
    .from("cobranca_casos" as never)
    .select("id")
    .eq("unidade", unidade)
    .eq("responsavel_key", key)
    .neq("status", "encerrado")
    .maybeSingle<{ id: string }>();

  return {
    responsavel,
    alunos,
    demonstrativo,
    casoAtivoId: ativo?.id ?? null,
    indisponivel,
    datasPrevistas: datasMensagens(hoje),
  };
}

export const prepararCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PrepararSchema.parse(i))
  .handler(async ({ data, context }): Promise<PreviaCobranca> => {
    await exigirPermissao(context.userId, true);
    await exigirUnidade(context.userId, data.unidade);
    return montarPrevia(data.unidade, data.alunoId);
  });

export const iniciarCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PrepararSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ casoId: string }> => {
    await exigirPermissao(context.userId, true);
    await exigirUnidade(context.userId, data.unidade);
    // Recalcula no servidor: nunca confia nos valores vindos da tela.
    const previa = await montarPrevia(data.unidade, data.alunoId);
    if (previa.casoAtivoId) throw new Error("Já existe uma cobrança ativa para este responsável.");
    if (previa.indisponivel) throw new Error("Sponte indisponível: tente novamente em instantes.");
    if (previa.demonstrativo.parcelas.length === 0)
      throw new Error("Nenhuma parcela vencida: não é possível iniciar a cobrança.");

    const { responsavel } = previa;
    const { data: caso, error } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .insert({
        unidade: data.unidade,
        responsavel_key: responsavelKey(responsavel.cpf, responsavel.nome),
        responsavel_nome: responsavel.nome,
        responsavel_cpf: somenteDigitos(responsavel.cpf) || null,
        responsavel_telefone: responsavel.telefone || null,
        responsavel_email: responsavel.email || null,
        responsavel_endereco: responsavel.endereco,
        alunos: previa.alunos,
        debito_inicial: previa.demonstrativo.parcelas,
        valor_inicial: previa.demonstrativo.total,
        status: "mensagens",
        iniciado_por: context.userId,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (error || !caso) {
      if (error?.code === "23505")
        throw new Error("Já existe uma cobrança ativa para este responsável.");
      throw new Error(error?.message ?? "Falha ao criar a cobrança.");
    }

    const { error: errMsg } = await supabaseAdmin.from("cobranca_mensagens" as never).insert(
      previa.datasPrevistas.map((d, i) => ({
        caso_id: caso.id,
        ordem: i + 1,
        data_prevista: d,
      })) as never,
    );
    if (errMsg) throw new Error(errMsg.message);
    return { casoId: caso.id };
  });

// ─── Caso completo ───────────────────────────────────────────────────────────

const CasoIdSchema = z.object({ casoId: z.string().uuid() });

export interface AnexoComLink extends AnexoCaso {
  url: string | null;
}

export interface MensagemComLink extends MensagemCaso {
  print_url: string | null;
}

export interface CasoDetalhe {
  caso: CasoCompleto;
  mensagens: MensagemComLink[];
  anexos: AnexoComLink[];
  hojeYMD: string;
}

async function montarDetalhe(casoId: string): Promise<CasoDetalhe> {
  const caso = await carregarCasoRow(casoId);
  const [mensagens, anexos] = await Promise.all([
    carregarMensagens(casoId),
    carregarAnexos(casoId),
  ]);
  const mensagensComLink: MensagemComLink[] = [];
  for (const m of mensagens)
    mensagensComLink.push({
      ...m,
      print_url: m.print_path ? await linkAssinado(m.print_path) : null,
    });
  const anexosComLink: AnexoComLink[] = [];
  for (const a of anexos) anexosComLink.push({ ...a, url: await linkAssinado(a.storage_path) });
  return { caso, mensagens: mensagensComLink, anexos: anexosComLink, hojeYMD: hojeYMD() };
}

export const carregarCasoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CasoIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<CasoDetalhe> => {
    await exigirPermissao(context.userId, false);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    return montarDetalhe(data.casoId);
  });

// ─── Uploads ─────────────────────────────────────────────────────────────────

const ArquivoSchema = z.object({
  nomeArquivo: z.string().min(1).max(200),
  tipoArquivo: z.string().min(1),
  tamanhoBytes: z.number().int().nonnegative(),
});

const AssinarUploadSchema = CasoIdSchema.extend({ arquivo: ArquivoSchema });

function extensao(nome: string, tipo: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome);
  if (m) return m[1].toLowerCase();
  return tipo === "application/pdf" ? "pdf" : (tipo.split("/")[1] ?? "bin");
}

/** URL assinada de upload no bucket privado; o arquivo é registrado depois. */
export const assinarUploadCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AssinarUploadSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ path: string; token: string }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    const invalido = validarArquivoAnexo(data.arquivo.tipoArquivo, data.arquivo.tamanhoBytes);
    if (invalido) throw new Error(invalido);
    const path = `${caso.id}/${randomUUID()}.${extensao(data.arquivo.nomeArquivo, data.arquivo.tipoArquivo)}`;
    const { data: assinado, error } = await supabaseAdmin.storage
      .from(BUCKET_COBRANCA)
      .createSignedUploadUrl(path);
    if (error || !assinado) throw new Error(error?.message ?? "Falha ao preparar o upload.");
    return { path: assinado.path, token: assinado.token };
  });

interface ArquivoEnviado {
  path: string;
  nomeArquivo: string;
  tipoArquivo: string;
  tamanhoBytes: number;
}

const ArquivoEnviadoSchema = ArquivoSchema.extend({ path: z.string().min(1) });

async function inserirAnexo(
  caso: CasoCompleto,
  categoria: CategoriaAnexo,
  arquivo: ArquivoEnviado,
  origem: AnexoCaso["origem"],
  userId: string,
  nomePersonalizado: string | null = null,
): Promise<string> {
  if (!arquivo.path.startsWith(`${caso.id}/`)) throw new Error("Caminho do arquivo inválido.");
  if (!(await arquivoExiste(arquivo.path)))
    throw new Error("Arquivo não encontrado no armazenamento.");
  const { data, error } = await supabaseAdmin
    .from("cobranca_anexos" as never)
    .insert({
      caso_id: caso.id,
      categoria,
      nome_personalizado: nomePersonalizado,
      storage_path: arquivo.path,
      nome_arquivo: arquivo.nomeArquivo,
      tipo_arquivo: arquivo.tipoArquivo,
      tamanho_bytes: arquivo.tamanhoBytes,
      origem,
      created_by: userId,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(error?.message ?? "Falha ao registrar o anexo.");
  return data.id;
}

// ─── Mensagens ───────────────────────────────────────────────────────────────

const RegistrarMensagemSchema = CasoIdSchema.extend({
  ordem: z.number().int().min(1).max(TOTAL_MENSAGENS),
  print: ArquivoEnviadoSchema,
});

export const registrarMensagemCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RegistrarMensagemSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    if (caso.status !== "mensagens") throw new Error("A etapa de mensagens já foi concluída.");
    const mensagens = await carregarMensagens(caso.id);
    const invalido = validarRegistroMensagem(mensagens, data.ordem, true);
    if (invalido) throw new Error(invalido);
    if (!data.print.path.startsWith(`${caso.id}/`)) throw new Error("Caminho do print inválido.");
    if (!(await arquivoExiste(data.print.path)))
      throw new Error("Print não encontrado no armazenamento.");

    const alvo = mensagens.find((m) => m.ordem === data.ordem)!;
    const hoje = hojeYMD();
    const { error } = await supabaseAdmin
      .from("cobranca_mensagens" as never)
      .update({
        enviada_em: new Date().toISOString(),
        enviada_por: context.userId,
        print_path: data.print.path,
        fora_da_data: hoje !== alvo.data_prevista,
      } as never)
      .eq("id", alvo.id);
    if (error) throw new Error(error.message);

    let status: CasoCompleto["status"] = caso.status;
    if (data.ordem === TOTAL_MENSAGENS) {
      status = "notificacao";
      const { error: e2 } = await supabaseAdmin
        .from("cobranca_casos" as never)
        .update({ status } as never)
        .eq("id", caso.id);
      if (e2) throw new Error(e2.message);
    }
    return { status };
  });

// ─── Notificação ─────────────────────────────────────────────────────────────

export const listarCasosParaNotificacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UnidadeSchema.parse(i))
  .handler(async ({ data, context }): Promise<CasoResumo[]> => {
    await exigirPermissao(context.userId, true);
    await exigirUnidade(context.userId, data.unidade);
    const rows = await fetchAllRows<CasoRow>((from, to) =>
      supabaseAdmin
        .from("cobranca_casos" as never)
        .select(SELECT_CASO)
        .eq("unidade", data.unidade)
        .in("status", ["notificacao", "aguardando_prazo"])
        .order("iniciado_em", { ascending: false })
        .range(from, to)
        .returns<CasoRow[]>(),
    );
    return rows.map(paraCaso);
  });

const DebitoAtualSchema = CasoIdSchema.extend({
  dataBase: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export interface DebitoAtualCaso {
  caso: CasoCompleto;
  mensagens: MensagemCaso[];
  demonstrativo: DemonstrativoDebito;
  indisponivel: boolean;
}

/** Parcelas em aberto ATUAIS no Sponte de todos os alunos do caso, atualizadas na data-base. */
export const debitoAtualCaso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DebitoAtualSchema.parse(i))
  .handler(async ({ data, context }): Promise<DebitoAtualCaso> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    const mensagens = await carregarMensagens(caso.id);
    const { parcelas, indisponivel } = await parcelasAbertasDosAlunos(caso.unidade, caso.alunos);
    return {
      caso,
      mensagens,
      demonstrativo: montarDemonstrativo(parcelas, data.dataBase ?? hojeYMD()),
      indisponivel,
    };
  });

/** Grava notificacao_gerada_em na PRIMEIRA emissão (as demais não alteram). */
export const marcarNotificacaoGerada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CasoIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ notificacao_gerada_em: string }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    if (caso.notificacao_gerada_em) return { notificacao_gerada_em: caso.notificacao_gerada_em };
    const agora = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .update({ notificacao_gerada_em: agora } as never)
      .eq("id", caso.id)
      .is("notificacao_gerada_em", null);
    if (error) throw new Error(error.message);
    return { notificacao_gerada_em: agora };
  });

const RegistrarNotificacaoSchema = CasoIdSchema.extend({
  notificacao: ArquivoEnviadoSchema,
  print: ArquivoEnviadoSchema,
  recebidaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const registrarEnvioNotificacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RegistrarNotificacaoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ prazo_final: string }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    if (caso.status !== "notificacao")
      throw new Error("O envio da notificação só pode ser registrado na etapa Notificação.");
    if (data.recebidaEm > hojeYMD()) throw new Error("A data de recebimento não pode ser futura.");

    await inserirAnexo(caso, "notificacao_enviada", data.notificacao, "upload", context.userId);
    await inserirAnexo(caso, "print_notificacao", data.print, "upload", context.userId);

    const prazo = prazoFinalNotificacao(data.recebidaEm);
    const { error } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .update({
        notificacao_recebida_em: data.recebidaEm,
        prazo_final: prazo,
        status: "aguardando_prazo",
        notificacao_gerada_em: caso.notificacao_gerada_em ?? new Date().toISOString(),
      } as never)
      .eq("id", caso.id);
    if (error) throw new Error(error.message);
    return { prazo_final: prazo };
  });

// ─── Documentação ────────────────────────────────────────────────────────────

const CategoriaSchema = z.enum(CATEGORIAS_ANEXO);

const RegistrarAnexoSchema = CasoIdSchema.extend({
  categoria: CategoriaSchema,
  nomePersonalizado: z.string().max(120).optional(),
  arquivo: ArquivoEnviadoSchema,
  origem: z.enum(["upload", "gerado"]).default("upload"),
});

export const registrarAnexoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RegistrarAnexoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ anexoId: string }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    if (data.categoria === "outro" && !data.nomePersonalizado?.trim())
      throw new Error("Informe o nome do documento.");
    const anexoId = await inserirAnexo(
      caso,
      data.categoria,
      data.arquivo,
      data.origem,
      context.userId,
      data.nomePersonalizado?.trim() || null,
    );
    return { anexoId };
  });

const RemoverAnexoSchema = z.object({ anexoId: z.string().uuid() });

export const removerAnexoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RemoverAnexoSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    const { data: anexo, error } = await supabaseAdmin
      .from("cobranca_anexos" as never)
      .select("id, caso_id, categoria, storage_path")
      .eq("id", data.anexoId)
      .maybeSingle<{
        id: string;
        caso_id: string;
        categoria: CategoriaAnexo;
        storage_path: string;
      }>();
    if (error) throw new Error(error.message);
    if (!anexo) throw new Error("Anexo não encontrado.");
    const caso = await carregarCasoRow(anexo.caso_id);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    if (anexo.categoria === "notificacao_enviada" || anexo.categoria === "print_notificacao")
      throw new Error("Os arquivos da notificação enviada não podem ser removidos.");
    const { error: e2 } = await supabaseAdmin
      .from("cobranca_anexos" as never)
      .delete()
      .eq("id", anexo.id);
    if (e2) throw new Error(e2.message);
    await supabaseAdmin.storage.from(BUCKET_COBRANCA).remove([anexo.storage_path]);
    return { ok: true };
  });

const MarcarDocSchema = CasoIdSchema.extend({ categoria: CategoriaSchema, concluido: z.boolean() });

export const marcarDocumentacaoCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MarcarDocSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ documentacao_concluida: CategoriaAnexo[] }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    const set = new Set(caso.documentacao_concluida);
    if (data.concluido) set.add(data.categoria);
    else set.delete(data.categoria);
    const lista = [...set];
    const { error } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .update({ documentacao_concluida: lista } as never)
      .eq("id", caso.id);
    if (error) throw new Error(error.message);
    return { documentacao_concluida: lista };
  });

// Documentos dos alunos do caso no cadastro de matrícula (bucket matricula-documentos).
export interface DocumentoMatriculaDisponivel {
  id: string;
  alunoNome: string;
  documento: string;
  nomeArquivo: string;
  tipoArquivo: string;
  tamanhoBytes: number;
}

interface MatriculaDocRow {
  id: string;
  sponte_aluno_id: number | null;
  documento: string;
  storage_path: string;
  nome_arquivo: string;
  tipo_arquivo: string;
  tamanho_bytes: number;
}

export const documentosMatriculaDoCaso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CasoIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<DocumentoMatriculaDisponivel[]> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    const ids = caso.alunos.map((a) => Number(a.aluno_id)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return [];
    const { data: rows, error } = await supabaseAdmin
      .from("matricula_documentos" as never)
      .select(
        "id, sponte_aluno_id, documento, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes",
      )
      .eq("unidade", caso.unidade)
      .in("sponte_aluno_id", ids)
      .returns<MatriculaDocRow[]>();
    if (error) throw new Error(error.message);
    const nomePorId = new Map(caso.alunos.map((a) => [a.aluno_id, a.nome]));
    return (rows ?? []).map((r) => ({
      id: r.id,
      alunoNome: nomePorId.get(String(r.sponte_aluno_id)) ?? "",
      documento: r.documento,
      nomeArquivo: r.nome_arquivo,
      tipoArquivo: r.tipo_arquivo,
      tamanhoBytes: r.tamanho_bytes,
    }));
  });

const CopiarDocSchema = CasoIdSchema.extend({ documentoIds: z.array(z.string().uuid()).min(1) });

/** Copia arquivos de matricula-documentos para cobranca-casos (origem 'sistema'). */
export const copiarDocumentosMatricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CopiarDocSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ copiados: number }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    const ids = caso.alunos.map((a) => Number(a.aluno_id));
    const { data: rows, error } = await supabaseAdmin
      .from("matricula_documentos" as never)
      .select(
        "id, sponte_aluno_id, documento, storage_path, nome_arquivo, tipo_arquivo, tamanho_bytes",
      )
      .eq("unidade", caso.unidade)
      .in("sponte_aluno_id", ids)
      .in("id", data.documentoIds)
      .returns<MatriculaDocRow[]>();
    if (error) throw new Error(error.message);
    let copiados = 0;
    for (const r of rows ?? []) {
      const destino = `${caso.id}/${randomUUID()}.${extensao(r.nome_arquivo, r.tipo_arquivo)}`;
      const { error: eCopy } = await supabaseAdmin.storage
        .from("matricula-documentos")
        .copy(r.storage_path, destino, { destinationBucket: BUCKET_COBRANCA });
      if (eCopy) {
        console.error(`${LOG} cópia de documento de matrícula falhou:`, eCopy.message);
        continue;
      }
      await inserirAnexo(
        caso,
        "docs_responsavel",
        {
          path: destino,
          nomeArquivo: r.nome_arquivo,
          tipoArquivo: r.tipo_arquivo,
          tamanhoBytes: r.tamanho_bytes,
        },
        "sistema",
        context.userId,
        r.documento,
      );
      copiados++;
    }
    return { copiados };
  });

// ─── Encerramento ────────────────────────────────────────────────────────────

const EncerrarSchema = CasoIdSchema.extend({
  motivo: z.enum(MOTIVOS_ENCERRAMENTO.map((m) => m.id) as [string, ...string[]]),
  observacao: z.string().max(2000).default(""),
});

export const encerrarCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EncerrarSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissao(context.userId, true);
    const caso = await carregarCasoRow(data.casoId);
    await exigirUnidade(context.userId, caso.unidade);
    exigirAberto(caso);
    const invalido = validarEncerramento(data.motivo, data.observacao);
    if (invalido) throw new Error(invalido);
    const { error } = await supabaseAdmin
      .from("cobranca_casos" as never)
      .update({
        status: "encerrado",
        encerrado_em: new Date().toISOString(),
        encerrado_por: context.userId,
        motivo_encerramento: data.motivo,
        observacao_encerramento: data.observacao.trim() || null,
      } as never)
      .eq("id", caso.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
