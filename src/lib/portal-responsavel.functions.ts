// Portal do Responsável — server functions (rota pública /portal).
//
// Nenhuma função aqui usa a autenticação interna: a identidade vem do CPF do
// responsável (consultado no Sponte) e de uma sessão temporária multi-aluno.
// Toda operação sobre um aluno valida (unidade, alunoId) contra a lista da
// sessão ANTES de tocar no Sponte ou no banco.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getResendConfig, sendEmail } from "@/lib/agenda.email";
import { cpfValido, normalizarCpf } from "@/lib/cantina";
import { buscarResponsavelPorCpf } from "@/lib/matriculas.sponte";
import {
  buscarLinhaDigitavelPorUnidade,
  coletarCadastroAluno,
  coletarDividaAbertaAluno,
  coletarTitulosAluno,
  credenciaisDistintas,
} from "@/lib/sponte.functions";
import { anoVigenteConfigurado, BASE_URL_PORTAL } from "@/lib/rematricula.functions";
import {
  MENSAGEM_FALHA_ENVIO_LINK,
  MENSAGEM_LIMITE_LINKS,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_SESSAO_EXPIRADA,
  excedeuLimiteLinks,
  expiracaoLink,
  expiracaoSessao,
  inicioJanelaLinks,
  mascararEmail,
  mensagemLinkEnviadoPara,
  validarLinkMagico,
} from "@/lib/rematricula";
import {
  MENSAGEM_CPF_NAO_LOCALIZADO,
  MENSAGEM_SEM_ALUNO_ATIVO,
  alunoDaSessao,
  assuntoEmailPortal,
  corpoEmailPortal,
  emailDoResponsavel,
  filtrarAlunosAtivos,
  nomeDoResponsavel,
  statusContratoPortal,
  unirVinculos,
  urlLinkPortal,
  type AlunoPortal,
  type MatriculaAtiva,
  type RetornoCredencial,
  type StatusContratoPortal,
} from "@/lib/portal-responsavel";
import { valorAtualizadoParcela } from "@/lib/billing-debt";
import { comporLinhasDigitaveis, type ItemBoletoLinha } from "@/lib/billing-recurrence";
import { signatariosDoDocumento } from "@/lib/contrato-matricula.functions";
import type { SignatarioPersistido } from "@/lib/zapsign.persist";
import { detalharDocumento } from "@/lib/zapsign.server";
import {
  pendenciasEmAberto,
  type PendenciasAluno,
  type ResponsavelDeclaracao,
} from "@/lib/declaracoes";
import { pagamentosIR, type ParcelaIR } from "@/lib/imposto-renda";
import { DOCUMENTOS_BUCKET, paraColegioRecibo, type ColegioRow } from "@/lib/colegios";
import type { AlunoRecibo, ColegioRecibo } from "@/lib/recibos";
import type { TermoConfissaoSnapshot } from "@/lib/confissao-divida";

const LOG_TAG = "[portal]";
const T_PEDIDOS = "portal_link_pedidos" as never;
const T_LINKS = "portal_links" as never;
const T_SESSOES = "portal_sessoes" as never;
const T_CONTRATOS = "contratos_matricula" as never;
const T_DOCS = "zapsign_documentos" as never;
const T_RECIBOS = "documentos_recibos" as never;
const AMBIENTE_ZAPSIGN = "producao";
const AUTOR_PORTAL = "Portal do Responsável";

// Namespaces próprios: o mesmo CPF gera hashes diferentes dos da Rematrícula.
function hashCpf(cpfDigitos: string): string {
  return createHash("sha256").update(`portal:${cpfDigitos}`).digest("hex");
}
function hashLink(token: string): string {
  return createHash("sha256").update(`portal-link:${token}`).digest("hex");
}
function hashSessao(token: string): string {
  return createHash("sha256").update(`portal-sessao:${token}`).digest("hex");
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// ─── Descoberta dos alunos ──────────────────────────────────────────────────

async function consultarCredenciais(cpf: string): Promise<RetornoCredencial[]> {
  const retornos = await Promise.all(
    credenciaisDistintas().map(
      async ({ unidades, codigoCliente, token }): Promise<RetornoCredencial | null> => {
        try {
          const r = await buscarResponsavelPorCpf(cpf, codigoCliente, token);
          if (!r) return null;
          return {
            unidades,
            alunoIds: r.vinculos.map((v) => v.alunoId),
            responsavelNome: r.nome,
            email: r.email,
          };
        } catch (e) {
          console.error(
            `${LOG_TAG} GetResponsaveis falhou em ${unidades.join("/")}: ${
              e instanceof Error ? e.message : "erro"
            }`,
          );
          return null;
        }
      },
    ),
  );
  return retornos.filter((r): r is RetornoCredencial => r !== null);
}

interface StudentRow {
  sponte_aluno_id: string | null;
  name: string;
  school_id: string;
  diario_matriculas_ano: { turma_nome: string; ativo: boolean; ano_letivo: number }[] | null;
}

async function matriculasAtivas(
  alunoIds: readonly string[],
  ano: number,
): Promise<MatriculaAtiva[]> {
  if (alunoIds.length === 0) return [];
  const { data: schools } = await supabaseAdmin
    .from("schools")
    .select("id, name")
    .returns<{ id: string; name: string }[]>();
  const nomePorSchool = new Map((schools ?? []).map((s) => [s.id, s.name]));

  const { data: rows, error } = await supabaseAdmin
    .from("diario_students" as never)
    .select(
      "sponte_aluno_id, name, school_id, diario_matriculas_ano!inner(turma_nome, ativo, ano_letivo)",
    )
    .in("sponte_aluno_id", alunoIds)
    .eq("diario_matriculas_ano.ano_letivo", ano)
    .eq("diario_matriculas_ano.ativo", true)
    .returns<StudentRow[]>();
  if (error) {
    console.error(`${LOG_TAG} leitura de diario_matriculas_ano: ${error.message}`);
    return [];
  }
  const saida: MatriculaAtiva[] = [];
  for (const r of rows ?? []) {
    const unidade = nomePorSchool.get(r.school_id);
    if (!unidade || !r.sponte_aluno_id) continue;
    const m = (r.diario_matriculas_ano ?? []).find((x) => x.ativo && Number(x.ano_letivo) === ano);
    if (!m) continue;
    saida.push({ unidade, alunoId: String(r.sponte_aluno_id), nome: r.name, turma: m.turma_nome });
  }
  return saida;
}

// ─── Link mágico ────────────────────────────────────────────────────────────

const SolicitarLinkSchema = z.object({ cpf: z.string().min(1) });

export interface SolicitarLinkPortalResult {
  ok: boolean;
  mensagem: string;
}

// A resposta para CPF inexistente, responsável sem email e falha do Sponte é a
// MESMA ("CPF não localizado"): o portal é público e não pode servir de
// consulta de cadastro. A exceção explícita é "nenhum aluno ativo" — o CPF
// existe, mas não há o que mostrar neste ano.
export const solicitarLinkPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SolicitarLinkSchema.parse(input))
  .handler(async ({ data }): Promise<SolicitarLinkPortalResult> => {
    const cpf = normalizarCpf(data.cpf);
    const naoLocalizado = { ok: false, mensagem: MENSAGEM_CPF_NAO_LOCALIZADO };
    if (!cpfValido(cpf)) return naoLocalizado;

    const cpfHash = hashCpf(cpf);
    const agora = new Date().toISOString();

    const { data: pedidos } = await supabaseAdmin
      .from(T_PEDIDOS)
      .select("criado_em")
      .eq("cpf_hash", cpfHash)
      .gte("criado_em", inicioJanelaLinks(agora))
      .returns<{ criado_em: string }[]>();
    if (
      excedeuLimiteLinks(
        (pedidos ?? []).map((p) => p.criado_em),
        agora,
      )
    ) {
      return { ok: false, mensagem: MENSAGEM_LIMITE_LINKS };
    }
    await supabaseAdmin.from(T_PEDIDOS).insert({ cpf_hash: cpfHash, criado_em: agora } as never);

    const cfg = getResendConfig();
    if (!cfg) {
      console.error(`${LOG_TAG} RESEND_API_KEY/RESEND_FROM ausentes; nenhum link enviado.`);
      return naoLocalizado;
    }

    const retornos = await consultarCredenciais(cpf);
    if (retornos.length === 0) return naoLocalizado;

    const candidatos = unirVinculos(retornos);
    const ano = await anoVigenteConfigurado();
    const alunos = filtrarAlunosAtivos(
      candidatos,
      await matriculasAtivas(
        candidatos.map((c) => c.alunoId),
        ano,
      ),
    );
    if (alunos.length === 0) return { ok: false, mensagem: MENSAGEM_SEM_ALUNO_ATIVO };

    const email = emailDoResponsavel(retornos);
    if (!email) {
      console.warn(`${LOG_TAG} responsável sem email no Sponte (cpf_hash ${cpfHash}).`);
      return naoLocalizado;
    }
    const responsavelNome = nomeDoResponsavel(retornos);

    const token = randomBytes(32).toString("hex");
    const { error: erroGrava } = await supabaseAdmin.from(T_LINKS).insert({
      token_hash: hashLink(token),
      cpf_hash: cpfHash,
      alunos,
      ano_letivo: ano,
      responsavel_nome: responsavelNome,
      criado_em: agora,
      expira_em: expiracaoLink(agora),
      usado_em: null,
    } as never);
    if (erroGrava) {
      console.error(`${LOG_TAG} falha ao registrar o link: ${erroGrava.message}`);
      return { ok: false, mensagem: MENSAGEM_FALHA_ENVIO_LINK };
    }

    const emailMascarado = mascararEmail(email);
    const corpo = corpoEmailPortal({
      responsavelNome,
      alunos,
      url: urlLinkPortal(BASE_URL_PORTAL, token),
      emailMascarado,
    });
    let aceito = false;
    try {
      await sendEmail(cfg, {
        to: [email],
        subject: assuntoEmailPortal(),
        html: corpo.html,
        text: corpo.text,
      });
      aceito = true;
    } catch (e) {
      console.error(
        `${LOG_TAG} falha ao enviar o link: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      );
      await supabaseAdmin.from(T_LINKS).delete().eq("token_hash", hashLink(token));
    }

    await supabaseAdmin.from(T_LINKS).delete().lt("expira_em", agora);
    await supabaseAdmin.from(T_PEDIDOS).delete().lt("criado_em", inicioJanelaLinks(agora));

    return aceito
      ? { ok: true, mensagem: mensagemLinkEnviadoPara(emailMascarado) }
      : { ok: false, mensagem: MENSAGEM_FALHA_ENVIO_LINK };
  });

const TokenSchema = z.object({ token: z.string().min(16) });

export interface SessaoPortalCliente {
  token: string;
  expiraEm: string;
  anoLetivo: number;
  responsavelNome: string;
  alunos: AlunoPortal[];
}

export interface ValidarLinkPortalResult {
  ok: boolean;
  sessao?: SessaoPortalCliente;
  erro?: string;
}

interface LinkRow {
  expira_em: string | null;
  usado_em: string | null;
  cpf_hash: string;
  alunos: AlunoPortal[];
  ano_letivo: number;
  responsavel_nome: string;
}

// Uso único: `usado_em` só é marcado quando ainda está nulo, então dois cliques
// simultâneos produzem uma sessão só.
export const validarLinkPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenSchema.parse(input))
  .handler(async ({ data }): Promise<ValidarLinkPortalResult> => {
    const agora = new Date().toISOString();
    const linkHash = hashLink(data.token);
    const { data: linha } = await supabaseAdmin
      .from(T_LINKS)
      .select("expira_em, usado_em, cpf_hash, alunos, ano_letivo, responsavel_nome")
      .eq("token_hash", linkHash)
      .maybeSingle<LinkRow>();

    const resultado = validarLinkMagico(
      linha ? { expiraEm: linha.expira_em, usadoEm: linha.usado_em } : null,
      agora,
    );
    if (!resultado.ok || !linha) {
      return { ok: false, erro: resultado.mensagem ?? MENSAGEM_LINK_INVALIDO };
    }

    const { data: queimado } = await supabaseAdmin
      .from(T_LINKS)
      .update({ usado_em: agora } as never)
      .eq("token_hash", linkHash)
      .is("usado_em", null)
      .select("token_hash")
      .maybeSingle<{ token_hash: string }>();
    if (!queimado) return { ok: false, erro: MENSAGEM_LINK_INVALIDO };

    const token = randomBytes(32).toString("hex");
    const expiraEm = expiracaoSessao(agora);
    const alunos = Array.isArray(linha.alunos) ? linha.alunos : [];
    const { error } = await supabaseAdmin.from(T_SESSOES).insert({
      token_hash: hashSessao(token),
      cpf_hash: linha.cpf_hash,
      alunos,
      ano_letivo: linha.ano_letivo,
      responsavel_nome: linha.responsavel_nome,
      criado_em: agora,
      expira_em: expiraEm,
    } as never);
    if (error) {
      console.error(`${LOG_TAG} falha ao criar a sessão: ${error.message}`);
      await supabaseAdmin
        .from(T_LINKS)
        .update({ usado_em: null } as never)
        .eq("token_hash", linkHash);
      return { ok: false, erro: "Não foi possível abrir a sessão. Tente novamente." };
    }

    await supabaseAdmin.from(T_SESSOES).delete().lt("expira_em", agora);

    return {
      ok: true,
      sessao: {
        token,
        expiraEm,
        anoLetivo: Number(linha.ano_letivo),
        responsavelNome: linha.responsavel_nome ?? "",
        alunos,
      },
    };
  });

// ─── Sessão ─────────────────────────────────────────────────────────────────

interface SessaoPortal {
  alunos: AlunoPortal[];
  anoLetivo: number;
  responsavelNome: string;
}

async function resolverSessao(token: string): Promise<SessaoPortal | null> {
  const agora = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from(T_SESSOES)
    .select("alunos, ano_letivo, responsavel_nome, expira_em")
    .eq("token_hash", hashSessao(token))
    .maybeSingle<{
      alunos: AlunoPortal[];
      ano_letivo: number;
      responsavel_nome: string;
      expira_em: string;
    }>();
  if (!data || data.expira_em <= agora) return null;
  return {
    alunos: Array.isArray(data.alunos) ? data.alunos : [],
    anoLetivo: Number(data.ano_letivo),
    responsavelNome: data.responsavel_nome ?? "",
  };
}

export interface DadosSessaoPortalResult {
  ok: boolean;
  sessao?: Omit<SessaoPortalCliente, "token" | "expiraEm">;
  erro?: string;
}

// Reabre a sessão guardada na aba (F5, volta ao portal).
export const dadosSessaoPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenSchema.parse(input))
  .handler(async ({ data }): Promise<DadosSessaoPortalResult> => {
    const sessao = await resolverSessao(data.token);
    if (!sessao) return { ok: false, erro: MENSAGEM_SESSAO_EXPIRADA };
    return { ok: true, sessao };
  });

const AlunoSessaoSchema = z.object({
  token: z.string().min(16),
  unidade: z.string().min(1),
  alunoId: z.string().regex(/^\d+$/),
});

// A unidade e o aluno vêm do corpo, mas só são aceitos se estiverem na lista
// gravada no login — nunca se confia no par por si só.
async function exigirAlunoDaSessao(
  input: z.infer<typeof AlunoSessaoSchema>,
): Promise<SessaoPortal> {
  const sessao = await resolverSessao(input.token);
  if (!sessao) throw new Error(MENSAGEM_SESSAO_EXPIRADA);
  if (!alunoDaSessao(sessao.alunos, input.unidade, input.alunoId)) {
    throw new Error("Aluno não pertence a esta sessão.");
  }
  return sessao;
}

// ─── Boletos ────────────────────────────────────────────────────────────────

export interface BoletoPortal {
  vencimento: string;
  valorOriginal: number;
  valorAtualizado: number;
  vencido: boolean;
  categorias: string[];
  linhaDigitavel: string;
}

export interface BoletosPortalResult {
  boletos: BoletoPortal[];
  totalAtualizado: number;
  // Mesma composição usada na cobrança por WhatsApp (uma linha por boleto).
  linhasDigitaveis: string;
  indisponivel?: boolean;
}

export const listarBoletosPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AlunoSessaoSchema.parse(input))
  .handler(async ({ data }): Promise<BoletosPortalResult> => {
    const sessao = await exigirAlunoDaSessao(data);
    const aluno = sessao.alunos.find(
      (a) => a.unidade === data.unidade && a.alunoId === data.alunoId,
    );
    const divida = await coletarDividaAbertaAluno(data.unidade, data.alunoId);
    if (!divida)
      return { boletos: [], totalAtualizado: 0, linhasDigitaveis: "", indisponivel: true };

    const hoje = hojeYMD();
    const abertos = divida.boletos.filter((b) => !b.dataPagamento && b.saldo > 0);
    const linhas = await Promise.all(
      abertos.map((b) =>
        buscarLinhaDigitavelPorUnidade(data.unidade, b.contaReceberID, b.numeroParcela).catch(
          () => "",
        ),
      ),
    );
    const boletos: BoletoPortal[] = abertos.map((b, i) => ({
      vencimento: b.vencimento,
      valorOriginal: b.saldo,
      valorAtualizado: valorAtualizadoParcela(b.saldo, b.vencimento, hoje),
      vencido: b.vencimento !== "" && b.vencimento < hoje,
      categorias: b.categorias,
      linhaDigitavel: linhas[i] ?? "",
    }));
    const itens: ItemBoletoLinha[] = boletos.map((b) => ({
      alunoNome: aluno?.nome ?? "",
      valor: b.valorAtualizado,
      linhaDigitavel: b.linhaDigitavel,
    }));
    return {
      boletos,
      totalAtualizado: boletos.reduce((acc, b) => acc + b.valorAtualizado, 0),
      linhasDigitaveis: comporLinhasDigitaveis(itens),
    };
  });

// ─── Contratos e termos (somente leitura) ───────────────────────────────────

export interface ContratoPortal {
  anoLetivo: number;
  numeroContrato: string;
  status: StatusContratoPortal;
  // Link de assinatura do CONTRATANTE quando pendente.
  linkAssinatura: string;
  // Só quando assinado: URL temporária do PDF assinado na ZapSign.
  pdfAssinado: string;
}

export interface TermoPortal {
  numero: number;
  data: string;
  valorTotal: number;
  snapshot: TermoConfissaoSnapshot;
}

export interface ContratosPortalResult {
  contratos: ContratoPortal[];
  termos: TermoPortal[];
}

interface ContratoRow {
  ano_letivo: number;
  numero_contrato: string;
  status: string;
  zapsign_documento_id: string | null;
  cancelado_em: string | null;
}

interface DocRow {
  id: string;
  status: string;
  zapsign_token: string | null;
  signatarios: SignatarioPersistido[] | null;
}

export const listarContratosPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AlunoSessaoSchema.parse(input))
  .handler(async ({ data }): Promise<ContratosPortalResult> => {
    await exigirAlunoDaSessao(data);

    const { data: contratos } = await supabaseAdmin
      .from(T_CONTRATOS)
      .select("ano_letivo, numero_contrato, status, zapsign_documento_id, cancelado_em")
      .eq("unidade", data.unidade)
      .eq("aluno_id", data.alunoId)
      .is("cancelado_em", null)
      .order("ano_letivo", { ascending: false })
      .returns<ContratoRow[]>();

    const docIds = (contratos ?? [])
      .map((c) => c.zapsign_documento_id)
      .filter((id): id is string => !!id);
    const docs = new Map<string, DocRow>();
    if (docIds.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from(T_DOCS)
        .select("id, status, zapsign_token, signatarios")
        .eq("ambiente", AMBIENTE_ZAPSIGN)
        .in("id", docIds)
        .returns<DocRow[]>();
      for (const d of rows ?? []) docs.set(d.id, d);
    }

    const saida: ContratoPortal[] = await Promise.all(
      (contratos ?? []).map(async (c) => {
        const doc = c.zapsign_documento_id ? docs.get(c.zapsign_documento_id) : undefined;
        const status = statusContratoPortal(c.status, doc?.status);
        const contratante = signatariosDoDocumento(doc?.signatarios).find(
          (s) => s.papel === "CONTRATANTE",
        );
        let pdfAssinado = "";
        if (status === "assinado" && doc?.zapsign_token) {
          const r = await detalharDocumento(doc.zapsign_token, AMBIENTE_ZAPSIGN);
          if (r.ok) pdfAssinado = r.dados.signed_file ?? "";
        }
        return {
          anoLetivo: Number(c.ano_letivo),
          numeroContrato: c.numero_contrato ?? "",
          status,
          linkAssinatura:
            status === "aguardando_assinatura" && contratante?.status !== "signed"
              ? (contratante?.signUrl ?? "")
              : "",
          pdfAssinado,
        };
      }),
    );

    // Termo de Confissão de Dívida: emitido pela secretaria em Documentos e
    // guardado com snapshot; o aluno pode ser qualquer um dos listados no termo.
    const { data: termosRows } = await supabaseAdmin
      .from(T_RECIBOS)
      .select("numero, data_recibo, valor_total, snapshot")
      .eq("tipo", "termo_confissao_divida")
      .eq("unidade", data.unidade)
      .order("data_recibo", { ascending: false })
      .returns<
        {
          numero: number;
          data_recibo: string;
          valor_total: number;
          snapshot: TermoConfissaoSnapshot;
        }[]
      >();
    const termos: TermoPortal[] = (termosRows ?? [])
      .filter((t) => (t.snapshot?.alunos ?? []).some((a) => String(a.alunoId) === data.alunoId))
      .map((t) => ({
        numero: t.numero,
        data: t.data_recibo.slice(0, 10),
        valorTotal: Number(t.valor_total ?? 0),
        snapshot: t.snapshot,
      }));

    return { contratos: saida, termos };
  });

// ─── Declarações (geradas pelo responsável) ─────────────────────────────────

async function colegioDaUnidade(
  unidade: string,
): Promise<{ colegio: ColegioRecibo; logoUrl: string } | null> {
  const { data } = await supabaseAdmin
    .from("documentos_colegios" as never)
    .select("*")
    .eq("unidade", unidade)
    .maybeSingle<ColegioRow>();
  if (!data) return null;
  let logoUrl = "";
  if (data.logo_path) {
    const { data: signed } = await supabaseAdmin.storage
      .from(DOCUMENTOS_BUCKET)
      .createSignedUrl(data.logo_path, 300);
    logoUrl = signed?.signedUrl ?? "";
  }
  return { colegio: paraColegioRecibo(data), logoUrl };
}

function alunoRecibo(
  cadastro: Awaited<ReturnType<typeof coletarCadastroAluno>>,
): AlunoRecibo | null {
  if (!cadastro.aluno) return null;
  return {
    alunoId: cadastro.aluno.alunoId,
    nome: cadastro.aluno.nome,
    cpf: cadastro.aluno.cpf,
    turma: cadastro.aluno.turma,
    matricula: cadastro.aluno.matricula,
  };
}

export interface DeclaracaoDebitosPortalResult {
  ok: boolean;
  erro?: string;
  numero?: number;
  dataDocumento?: string;
  colegio?: ColegioRecibo;
  logoUrl?: string;
  aluno?: AlunoRecibo;
  responsaveis?: ResponsavelDeclaracao[];
  pendencias?: PendenciasAluno;
}

// Mesma regra da tela Documentos: parcela VENCIDA impede a declaração (aqui sem
// a confirmação manual da secretaria — o responsável simplesmente não emite).
export const gerarDeclaracaoDebitosPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AlunoSessaoSchema.parse(input))
  .handler(async ({ data }): Promise<DeclaracaoDebitosPortalResult> => {
    await exigirAlunoDaSessao(data);
    const col = await colegioDaUnidade(data.unidade);
    if (!col || !col.colegio.razaoSocial.trim() || !col.colegio.cnpj.trim()) {
      return {
        ok: false,
        erro: "Documento indisponível para esta unidade. Fale com a secretaria.",
      };
    }
    const [cadastro, titulos] = await Promise.all([
      coletarCadastroAluno(data.unidade, data.alunoId),
      coletarTitulosAluno(data.unidade, data.alunoId),
    ]);
    const aluno = alunoRecibo(cadastro);
    if (cadastro.error || !aluno)
      return { ok: false, erro: "Não foi possível ler o cadastro do aluno." };
    if (titulos.error || titulos.indisponivel) {
      return { ok: false, erro: "Não foi possível consultar as parcelas. Tente novamente." };
    }
    const dataDocumento = hojeYMD();
    const pendencias = pendenciasEmAberto(titulos.titulos, dataDocumento);
    if (pendencias.vencidas > 0) {
      return {
        ok: false,
        erro: "Há parcela vencida em aberto; a declaração não pode ser emitida. Fale com a secretaria.",
      };
    }
    const responsaveis: ResponsavelDeclaracao[] = cadastro.responsaveis.map((r) => ({
      responsavelId: r.responsavelId,
      nome: r.nome,
      cpf: r.cpf,
      parentesco: r.parentesco,
    }));
    const snapshot = { colegio: col.colegio, aluno, responsaveis, pendencias };
    const { data: inserido, error } = await supabaseAdmin
      .from(T_RECIBOS)
      .insert({
        tipo: "declaracao_debitos",
        unidade: data.unidade,
        aluno_id: aluno.alunoId,
        aluno_nome: aluno.nome,
        responsavel_id: responsaveis[0]?.responsavelId ?? "",
        responsavel_nome: responsaveis.map((r) => r.nome).join(" e "),
        responsavel_cpf: responsaveis[0]?.cpf ?? "",
        data_recibo: dataDocumento,
        valor_total: 0,
        itens: [],
        snapshot,
        created_by: null,
        created_by_nome: AUTOR_PORTAL,
      } as never)
      .select("numero")
      .single<{ numero: number }>();
    if (error || !inserido) {
      console.error(`${LOG_TAG} falha ao registrar a declaração: ${error?.message}`);
      return { ok: false, erro: "Não foi possível registrar a declaração. Tente novamente." };
    }
    return {
      ok: true,
      numero: inserido.numero,
      dataDocumento,
      colegio: col.colegio,
      logoUrl: col.logoUrl,
      aluno,
      responsaveis,
      pendencias,
    };
  });

const DeclaracaoIRSchema = AlunoSessaoSchema.extend({
  anoIR: z.number().int().min(2000).max(2100),
});

export interface DeclaracaoIRPortalResult {
  ok: boolean;
  erro?: string;
  numero?: number;
  dataDocumento?: string;
  colegio?: ColegioRecibo;
  logoUrl?: string;
  aluno?: AlunoRecibo;
  responsavelNome?: string;
  responsavelCpf?: string;
  parcelas?: ParcelaIR[];
}

export const gerarDeclaracaoIRPortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DeclaracaoIRSchema.parse(input))
  .handler(async ({ data }): Promise<DeclaracaoIRPortalResult> => {
    await exigirAlunoDaSessao(data);
    const col = await colegioDaUnidade(data.unidade);
    if (!col || !col.colegio.razaoSocial.trim() || !col.colegio.cnpj.trim()) {
      return {
        ok: false,
        erro: "Documento indisponível para esta unidade. Fale com a secretaria.",
      };
    }
    const [cadastro, titulos] = await Promise.all([
      coletarCadastroAluno(data.unidade, data.alunoId),
      coletarTitulosAluno(data.unidade, data.alunoId),
    ]);
    const aluno = alunoRecibo(cadastro);
    if (cadastro.error || !aluno)
      return { ok: false, erro: "Não foi possível ler o cadastro do aluno." };
    if (titulos.error || titulos.indisponivel) {
      return { ok: false, erro: "Não foi possível consultar as parcelas. Tente novamente." };
    }
    const pagamentos = pagamentosIR(
      titulos.titulos.map((t) => ({
        categoria: t.categoria,
        numeroParcela: t.numeroParcela,
        valorPago: t.valorPago,
        dataPagamento: t.dataPagamento,
      })),
      data.anoIR,
    );
    if (pagamentos.length === 0) {
      return {
        ok: false,
        erro: `Nenhum pagamento de Matrícula ou Mensalidade no ano-calendário ${data.anoIR - 1}.`,
      };
    }
    const responsavel =
      cadastro.responsaveis.find((r) => r.financeiro) ?? cadastro.responsaveis[0] ?? null;
    const parcelas: ParcelaIR[] = pagamentos.map((p) => ({
      categoria: p.categoria,
      numeroParcela: p.parcela,
      valorPago: p.valor,
      dataPagamento: p.dataPagamento,
    }));
    const dataDocumento = hojeYMD();
    const snapshot = {
      colegio: col.colegio,
      aluno,
      responsavelNome: responsavel?.nome ?? "",
      responsavelCpf: responsavel?.cpf ?? "",
      anoIR: data.anoIR,
      parcelas,
    };
    const { data: inserido, error } = await supabaseAdmin
      .from(T_RECIBOS)
      .insert({
        tipo: "declaracao_ir",
        unidade: data.unidade,
        aluno_id: aluno.alunoId,
        aluno_nome: aluno.nome,
        responsavel_id: responsavel?.responsavelId ?? "",
        responsavel_nome: responsavel?.nome ?? "",
        responsavel_cpf: responsavel?.cpf ?? "",
        data_recibo: dataDocumento,
        valor_total: pagamentos.reduce((acc, p) => acc + p.valor, 0),
        itens: [],
        snapshot,
        created_by: null,
        created_by_nome: AUTOR_PORTAL,
      } as never)
      .select("numero")
      .single<{ numero: number }>();
    if (error || !inserido) {
      console.error(`${LOG_TAG} falha ao registrar a declaração de IR: ${error?.message}`);
      return { ok: false, erro: "Não foi possível registrar a declaração. Tente novamente." };
    }
    return {
      ok: true,
      numero: inserido.numero,
      dataDocumento,
      colegio: col.colegio,
      logoUrl: col.logoUrl,
      aluno,
      responsavelNome: responsavel?.nome ?? "",
      responsavelCpf: responsavel?.cpf ?? "",
      parcelas,
    };
  });

// Logo para o PDF do termo (baixado no navegador a partir do snapshot).
export const logoUnidadePortal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AlunoSessaoSchema.parse(input))
  .handler(async ({ data }): Promise<{ logoUrl: string }> => {
    await exigirAlunoDaSessao(data);
    const col = await colegioDaUnidade(data.unidade);
    return { logoUrl: col?.logoUrl ?? "" };
  });
