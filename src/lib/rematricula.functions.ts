// Server functions do portal PÚBLICO de Rematrícula e do cadastro de Material
// Pedagógico por Série.
//
// Fronteira de confiança: o navegador manda apenas o CPF (para pedir o link de
// acesso), o token do link recebido por email e depois um token de sessão opaco. Aluno, unidade, mensalidade, série e telefone
// do responsável são SEMPRE relidos do Sponte pelo servidor — nada do que o
// cliente informe é aceito como identidade.
//
// O portal NÃO escreve nada financeiro no Sponte: a escolha de parcelamento fica
// em rematricula_escolhas como 'pendente_lancamento' e só a secretaria efetiva o
// lançamento (InsertPlano + UpdateParcela) na tela interna. Já a correção
// cadastral (endereço, celular, email) sincroniza na hora, com auditoria.

import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cpfValido, normalizarCpf } from "@/lib/cantina";
import {
  ANO_LETIVO_MAX,
  ANO_LETIVO_MIN,
  CATEGORIA_MATERIAL_SPONTE,
  MENSAGEM_LIMITE_LINKS,
  MENSAGEM_LINK_ENVIADO,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_SESSAO_EXPIRADA,
  anoLetivoValido,
  assuntoEmailRematricula,
  corpoEmailRematricula,
  chaveSerie,
  cronogramaMaterialFaseB,
  excedeuLimiteLinks,
  expiracaoLink,
  expiracaoSessao,
  inicioJanelaLinks,
  mascararEmail,
  mensalidadeVigente,
  observacaoMaterialSponte,
  opcoesParcelamentoMaterialPrimeira,
  parcelamentoMaterialPrimeira,
  parcelasMaterialValida,
  primeiraMensalidadeDoAnoLetivo,
  resultadoEnvioLink,
  serieDaTurma,
  urlLinkRematricula,
  validarLinkMagico,
  vencimentosMaterialPelasMensalidades,
  type MensalidadeVigente,
  type ParcelaMaterial,
  type ParcelaMensalidade,
  type ParcelamentoPrimeira,
  type StatusEscolhaRematricula,
} from "@/lib/rematricula";
import {
  type AcessoAcompanhamento,
  type AlunoAtivoAcompanhamento,
  type EscolhaAcompanhamento,
} from "@/lib/rematricula-acompanhamento";
import {
  REFEICOES_ROTINA,
  ROTINA_FORM_VAZIA,
  montarRotinaPersistida,
  rotinaDoPlanoExistente,
  validarRotinaForm,
  type PlanoRotinaExistente,
  type RotinaForm,
} from "@/lib/matricula-form";
import type { MealKey, Weekday } from "@/lib/diario";
import {
  CAMPOS_EDITAVEIS_ALUNO,
  aplicarEdicao,
  camposAlterados,
  camposEsvaziados,
  divergenciasForaDaEdicao,
  type EdicaoCadastral,
} from "@/lib/sponte-cadastro";
import {
  atualizarFichaAlunoSponte,
  atualizarFichaResponsavelSponte,
  lerFichaAlunoSponte,
  lerFichaResponsavelSponte,
  type EscritaCadastroResult,
} from "@/lib/sponte-cadastro.functions";
import {
  UNIDADES_SPONTE,
  allowedSponteUnidades,
  alunosAtivosDaUnidade,
  atualizarParcelaSponte,
  callSponte,
  checkFault,
  classificarUnidade,
  coletarTitulosAluno,
  escapeXml,
  inserirPlanoSponte,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { getResendConfig, sendEmail } from "@/lib/agenda.email";
import { emailValido } from "@/lib/imposto-renda-lote";

const LOG_TAG = "[rematricula]";

// Endereço público do portal, usado para montar o link do email. Sobrescrevível
// por env para ambientes de preview.
const BASE_URL_PORTAL = (process.env.PORTAL_BASE_URL || "https://schoolhubbr.vercel.app").trim();

// O CPF nunca é persistido: só o hash entra nas tabelas do portal.
function hashCpf(cpfDigitos: string): string {
  return createHash("sha256").update(`rematricula:${cpfDigitos}`).digest("hex");
}

function hashLink(token: string): string {
  return createHash("sha256").update(`rematricula-link:${token}`).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(`rematricula-sessao:${token}`).digest("hex");
}

function variacoesCpf(cpfDigitos: string): string[] {
  const formatado = `${cpfDigitos.slice(0, 3)}.${cpfDigitos.slice(3, 6)}.${cpfDigitos.slice(
    6,
    9,
  )}-${cpfDigitos.slice(9)}`;
  return [cpfDigitos, formatado];
}

// dd/MM/yyyy (ou dd/MM/yyyy HH:mm) → yyyy-MM-dd.
function paraISO(dataBr: string): string {
  const m = dataBr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function paraNumero(valorBr: string): number {
  const limpo = valorBr.replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  const n = parseFloat(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// ─── Aluno no Sponte ────────────────────────────────────────────────────────

interface AlunoSponteRematricula {
  unidade: string;
  alunoId: string;
  nome: string;
  cpf: string;
  dataNascimento: string; // YYYY-MM-DD
  matricula: string;
  turma: string;
  serie: string;
  email: string;
  telefone: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

function lerAluno(node: string, unidade: string): AlunoSponteRematricula {
  const turma = parseXmlValue(node, "TurmaAtual");
  return {
    unidade,
    alunoId: parseXmlValue(node, "AlunoID"),
    nome: parseXmlValue(node, "Nome"),
    cpf: parseXmlValue(node, "CPF"),
    dataNascimento: paraISO(parseXmlValue(node, "DataNascimento")),
    matricula: parseXmlValue(node, "NumeroMatricula"),
    turma,
    serie: serieDaTurma(turma),
    email: parseXmlValue(node, "Email"),
    telefone: parseXmlValue(node, "Celular") || parseXmlValue(node, "Telefone"),
    cep: parseXmlValue(node, "CEP"),
    endereco: parseXmlValue(node, "Endereco"),
    numero: parseXmlValue(node, "NumeroEndereco"),
    complemento: parseXmlValue(node, "ComplementoEndereco"),
    bairro: parseXmlValue(node, "Bairro"),
    cidade: parseXmlValue(node, "Cidade"),
    uf: parseXmlValue(node, "UF"),
  };
}

// Varre as unidades procurando o aluno pelo CPF. Mesma estratégia do portal da
// Cantina: o Sponte aceita o CPF com e sem máscara, e no CEC/CEC Baby a unidade
// real vem da turma.
async function buscarAlunoPorCpf(cpfDigitos: string): Promise<AlunoSponteRematricula | null> {
  for (const unidade of UNIDADES_SPONTE) {
    const creds = resolverCredenciais(unidade);
    if (!creds) continue;

    for (const variacao of variacoesCpf(cpfDigitos)) {
      let xml: string;
      try {
        xml = await callSponte(
          "GetAlunos",
          `CPF=${escapeXml(variacao)}`,
          creds.codigoCliente,
          creds.token,
        );
      } catch {
        break; // unidade indisponível: tenta a próxima
      }
      if (checkFault(xml)) continue;

      for (const node of parseXmlList(xml, "wsAluno")) {
        const alunoId = parseXmlValue(node, "AlunoID");
        if (!alunoId || alunoId === "0") continue;

        const cpfAluno = normalizarCpf(parseXmlValue(node, "CPF"));
        if (cpfAluno !== "" && cpfAluno !== cpfDigitos) continue;

        const turma = parseXmlValue(node, "TurmaAtual");
        const unidadeReal = creds.segmentaPorTurma ? (classificarUnidade(turma) ?? "CEC") : unidade;
        if (creds.segmentaPorTurma && unidadeReal !== unidade) continue;

        return lerAluno(node, unidadeReal);
      }
    }
  }
  return null;
}

async function buscarAlunoPorId(
  unidade: string,
  alunoId: string,
): Promise<AlunoSponteRematricula | null> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return null;
  let xml: string;
  try {
    xml = await callSponte("GetAlunos", `AlunoID=${alunoId}`, creds.codigoCliente, creds.token);
  } catch {
    return null;
  }
  if (checkFault(xml)) return null;
  const node = parseXmlList(xml, "wsAluno").find(
    (n) => parseXmlValue(n, "AlunoID") === alunoId && parseXmlValue(n, "Nome"),
  );
  return node ? lerAluno(node, unidade) : null;
}

// ─── Responsáveis (pai/mãe/financeiro) ──────────────────────────────────────

export interface ResponsavelRematricula {
  responsavelId: string;
  nome: string;
  cpf: string;
  parentesco: string;
  dataNascimento: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  email: string;
  telefone: string;
  financeiro: boolean;
}

async function buscarResponsaveis(
  unidade: string,
  alunoId: string,
  responsavelFinanceiroId: string,
): Promise<ResponsavelRematricula[]> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return [];
  let xml: string;
  try {
    xml = await callSponte(
      "GetResponsaveis",
      `AlunoID=${alunoId}`,
      creds.codigoCliente,
      creds.token,
    );
  } catch {
    return [];
  }
  if (checkFault(xml)) return [];

  const lista: ResponsavelRematricula[] = [];
  for (const node of parseXmlList(xml, "wsResponsavel")) {
    if (!parseXmlValue(node, "RetornoOperacao").startsWith("01")) continue;
    const responsavelId = parseXmlValue(node, "ResponsavelID");
    const nome = parseXmlValue(node, "Nome");
    if (!responsavelId || !nome) continue;
    lista.push({
      responsavelId,
      nome,
      cpf: parseXmlValue(node, "CPFCNPJ") || parseXmlValue(node, "CPF"),
      parentesco: parseXmlValue(node, "Parentesco"),
      dataNascimento: paraISO(parseXmlValue(node, "DataNascimento")),
      cep: parseXmlValue(node, "CEP"),
      endereco: parseXmlValue(node, "Endereco"),
      numero: parseXmlValue(node, "NumeroEndereco"),
      complemento: parseXmlValue(node, "ComplementoEndereco"),
      bairro: parseXmlValue(node, "Bairro"),
      cidade: parseXmlValue(node, "Cidade"),
      uf: parseXmlValue(node, "Estado") || parseXmlValue(node, "UF"),
      email: parseXmlValue(node, "Email"),
      telefone: parseXmlValue(node, "Celular") || parseXmlValue(node, "Telefone"),
      financeiro: responsavelId === responsavelFinanceiroId,
    });
  }
  lista.sort((a, b) => Number(b.financeiro) - Number(a.financeiro) || a.nome.localeCompare(b.nome));
  return lista;
}

// Email do responsável financeiro — o MESMO destinatário que já recebe a
// Declaração de IR (GetResponsavelFinanceiro). É para lá que o link de acesso
// vai; o endereço nunca é devolvido ao navegador.
async function emailResponsavelFinanceiro(
  unidade: string,
  alunoId: string,
): Promise<{ nome: string; email: string } | null> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return null;
  try {
    const xml = await callSponte(
      "GetResponsavelFinanceiro",
      `AlunoID=${alunoId}`,
      creds.codigoCliente,
      creds.token,
    );
    if (checkFault(xml)) return null;
    const node = parseXmlList(xml, "wsResponsavel").find((n) =>
      parseXmlValue(n, "RetornoOperacao").startsWith("01"),
    );
    if (!node) return null;
    const email = parseXmlValue(node, "Email").trim();
    if (!emailValido(email)) return null;
    return { nome: parseXmlValue(node, "Nome"), email };
  } catch {
    return null;
  }
}

// Nome do colégio no assunto do email (cadastro de "Dados dos Colégios").
async function nomeColegioDaUnidade(unidade: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("documentos_colegios" as never)
    .select("nome_fantasia, razao_social")
    .eq("unidade", unidade)
    .maybeSingle<{ nome_fantasia: string; razao_social: string }>();
  return (data?.nome_fantasia || data?.razao_social || unidade).trim();
}

// ─── Mensalidade vigente (GetParcelas) ──────────────────────────────────────

async function buscarMensalidadeVigente(
  unidade: string,
  alunoId: string,
): Promise<MensalidadeVigente | null> {
  const creds = resolverCredenciais(unidade);
  if (!creds) return null;
  let xml: string;
  try {
    xml = await callSponte("GetParcelas", `AlunoID=${alunoId}`, creds.codigoCliente, creds.token);
  } catch {
    return null;
  }
  if (checkFault(xml)) return null;

  const parcelas: ParcelaMensalidade[] = [];
  for (const node of parseXmlList(xml, "wsParcela")) {
    if (!parseXmlValue(node, "RetornoOperacao").startsWith("01")) continue;
    parcelas.push({
      categoria: parseXmlValue(node, "Categoria"),
      vencimento: paraISO(parseXmlValue(node, "Vencimento")),
      valor: paraNumero(parseXmlValue(node, "ValorParcela")),
      bolsaAssociada: parseXmlValue(node, "BolsaAssociada"),
    });
  }
  return mensalidadeVigente(parcelas, new Date().toISOString());
}

// ─── Link mágico / sessão ───────────────────────────────────────────────────

const SolicitarLinkSchema = z.object({ cpf: z.string().min(1) });

export interface SolicitarLinkResult {
  ok: boolean;
  mensagem: string;
}

// PASSO 1 — pedir o link de acesso por email. A resposta é sempre a MESMA,
// exista ou não o CPF (aluno sem cadastro, responsável sem email cadastrado no
// Sponte e falha de envio devolvem o mesmo texto): o portal é público e não pode
// servir de consulta de cadastro. A única resposta diferente é a do rate limit,
// que vale para qualquer CPF informado e por isso não revela nada.
export const solicitarLinkRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SolicitarLinkSchema.parse(input))
  .handler(async ({ data }): Promise<SolicitarLinkResult> => {
    const cpf = normalizarCpf(data.cpf);
    if (!cpfValido(cpf)) {
      return { ok: false, mensagem: "Informe os 11 dígitos do CPF do aluno." };
    }

    const generico: SolicitarLinkResult = { ok: true, mensagem: MENSAGEM_LINK_ENVIADO };
    const cpfHash = hashCpf(cpf);
    const agora = new Date().toISOString();

    // Rate limit ANTES de qualquer consulta ao Sponte: 3 pedidos por CPF por
    // hora, contando também os CPFs sem aluno correspondente.
    const { data: pedidos } = await supabaseAdmin
      .from("rematricula_link_pedidos" as never)
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
    await supabaseAdmin
      .from("rematricula_link_pedidos" as never)
      .insert({ cpf_hash: cpfHash, criado_em: agora } as never);

    const cfg = getResendConfig();
    if (!cfg) {
      console.error(
        `${LOG_TAG} envio de email não configurado (RESEND_API_KEY/RESEND_FROM); nenhum link enviado.`,
      );
      return generico;
    }

    const aluno = await buscarAlunoPorCpf(cpf);
    if (!aluno) {
      console.warn(`${LOG_TAG} pedido de link sem aluno correspondente (cpf_hash ${cpfHash}).`);
      return generico;
    }

    const responsavel = await emailResponsavelFinanceiro(aluno.unidade, aluno.alunoId);
    if (!responsavel) {
      console.warn(
        `${LOG_TAG} aluno ${aluno.alunoId} (${aluno.unidade}) sem email de responsável financeiro no Sponte.`,
      );
      return generico;
    }

    // randomBytes é criptográfico; o token em texto claro só vai para a URL do
    // email — o banco guarda apenas o hash.
    const token = randomBytes(32).toString("hex");
    const { error: erroGrava } = await supabaseAdmin.from("rematricula_links" as never).insert({
      token_hash: hashLink(token),
      cpf_hash: cpfHash,
      unidade: aluno.unidade,
      aluno_id: aluno.alunoId,
      criado_em: agora,
      expira_em: expiracaoLink(agora),
      usado_em: null,
    } as never);
    if (erroGrava) {
      console.error(`${LOG_TAG} falha ao registrar o link: ${erroGrava.message}`);
      return generico;
    }

    const nomeColegio = await nomeColegioDaUnidade(aluno.unidade);
    const emailMascarado = mascararEmail(responsavel.email);
    const corpo = corpoEmailRematricula({
      responsavelNome: responsavel.nome,
      alunoNome: aluno.nome,
      nomeColegio,
      url: urlLinkRematricula(BASE_URL_PORTAL, token),
      emailMascarado,
    });
    let aceito = false;
    try {
      await sendEmail(cfg, {
        to: [responsavel.email],
        subject: assuntoEmailRematricula(nomeColegio),
        html: corpo.html,
        text: corpo.text,
      });
      aceito = true;
    } catch (e) {
      console.error(
        `${LOG_TAG} falha ao enviar o link para o aluno ${aluno.alunoId}: ${
          e instanceof Error ? e.message : "erro desconhecido"
        }`,
      );
      // O link gravado não chegou a ninguém: apagá-lo evita deixar um token
      // válido pendurado no banco por 15 minutos.
      await supabaseAdmin
        .from("rematricula_links" as never)
        .delete()
        .eq("token_hash", hashLink(token));
    }

    // Faxina oportunista dos links vencidos e dos pedidos fora da janela.
    await supabaseAdmin
      .from("rematricula_links" as never)
      .delete()
      .lt("expira_em", agora);
    await supabaseAdmin
      .from("rematricula_link_pedidos" as never)
      .delete()
      .lt("criado_em", inicioJanelaLinks(agora));

    // Único ponto em que a resposta deixa de ser genérica: o pai precisa saber
    // para qual caixa olhar. Só a versão mascarada sai do servidor.
    return resultadoEnvioLink(aceito, emailMascarado);
  });

const ValidarLinkSchema = z.object({ token: z.string().min(16) });

export interface ValidarLinkResult {
  ok: boolean;
  token?: string;
  expiraEm?: string;
  erro?: string;
}

// PASSO 2 — abrir o link recebido no email e criar a sessão temporária. O link é
// de USO ÚNICO: a marcação de `usado_em` é condicionada a `usado_em IS NULL`, de
// modo que dois cliques simultâneos só produzem uma sessão.
export const validarLinkRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ValidarLinkSchema.parse(input))
  .handler(async ({ data }): Promise<ValidarLinkResult> => {
    const agora = new Date().toISOString();
    const linkHash = hashLink(data.token);

    const { data: linha } = await supabaseAdmin
      .from("rematricula_links" as never)
      .select("expira_em, usado_em, unidade, aluno_id, cpf_hash")
      .eq("token_hash", linkHash)
      .maybeSingle<{
        expira_em: string | null;
        usado_em: string | null;
        unidade: string;
        aluno_id: string;
        cpf_hash: string;
      }>();

    const resultado = validarLinkMagico(
      linha ? { expiraEm: linha.expira_em, usadoEm: linha.usado_em } : null,
      agora,
    );
    if (!resultado.ok || !linha) {
      return { ok: false, erro: resultado.mensagem ?? MENSAGEM_LINK_INVALIDO };
    }

    const { data: queimado } = await supabaseAdmin
      .from("rematricula_links" as never)
      .update({ usado_em: agora } as never)
      .eq("token_hash", linkHash)
      .is("usado_em", null)
      .select("token_hash")
      .maybeSingle<{ token_hash: string }>();
    if (!queimado) return { ok: false, erro: MENSAGEM_LINK_INVALIDO };

    const token = randomBytes(32).toString("hex");
    const expiraEm = expiracaoSessao(agora);
    const { error } = await supabaseAdmin.from("rematricula_sessoes" as never).insert({
      token_hash: hashToken(token),
      cpf_hash: linha.cpf_hash,
      unidade: linha.unidade,
      aluno_id: linha.aluno_id,
      expira_em: expiraEm,
    } as never);
    if (error) {
      console.error(`${LOG_TAG} falha ao criar a sessão: ${error.message}`);
      // Devolve o link ao estado não usado: sem isso o responsável ficaria sem
      // sessão E sem link, gastando um dos 3 pedidos da hora por uma falha nossa.
      await supabaseAdmin
        .from("rematricula_links" as never)
        .update({ usado_em: null } as never)
        .eq("token_hash", linkHash);
      return { ok: false, erro: "Não foi possível abrir a sessão. Tente novamente." };
    }

    // Registro PERMANENTE do acesso: a sessão expira em minutos, e sem esse
    // registro a tela interna não distinguiria "nunca acessou" de "acessou e não
    // confirmou". Falha aqui não impede o login.
    await registrarAcessoRematricula(linha.unidade, linha.aluno_id, agora);

    // Faxina oportunista das sessões vencidas.
    await supabaseAdmin
      .from("rematricula_sessoes" as never)
      .delete()
      .lt("expira_em", agora);

    return { ok: true, token, expiraEm };
  });

async function registrarAcessoRematricula(
  unidade: string,
  alunoId: string,
  agora: string,
): Promise<void> {
  const { data: existente } = await supabaseAdmin
    .from("rematricula_acessos" as never)
    .select("acessos")
    .eq("unidade", unidade)
    .eq("aluno_id", alunoId)
    .maybeSingle<{ acessos: number }>();

  const { error } = await supabaseAdmin.from("rematricula_acessos" as never).upsert(
    {
      unidade,
      aluno_id: alunoId,
      // 'primeiro_acesso_em' só vai no primeiro registro, para não ser reescrito.
      ...(existente ? {} : { primeiro_acesso_em: agora }),
      ultimo_acesso_em: agora,
      acessos: (existente?.acessos ?? 0) + 1,
    } as never,
    { onConflict: "unidade,aluno_id" } as never,
  );
  if (error) console.error(`${LOG_TAG} falha ao registrar o acesso: ${error.message}`);
}

interface SessaoRematricula {
  unidade: string;
  alunoId: string;
}

// Toda operação autenticada do portal passa por aqui: a sessão só vale dentro da
// validade, e a identidade do aluno vem da linha gravada no login — nunca do
// corpo da requisição.
async function resolverSessao(token: string): Promise<SessaoRematricula | null> {
  const agora = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("rematricula_sessoes" as never)
    .select("unidade, aluno_id, expira_em")
    .eq("token_hash", hashToken(token))
    .maybeSingle<{ unidade: string; aluno_id: string; expira_em: string }>();
  if (!data || data.expira_em <= agora) return null;
  return { unidade: data.unidade, alunoId: data.aluno_id };
}

// ─── Dados do portal (somente leitura) ──────────────────────────────────────

export interface MaterialRematricula {
  configurado: boolean;
  valorAnual: number;
  serie: string;
  opcoes: ParcelamentoPrimeira[];
  escolhaAtual: {
    parcelas: number;
    atualizadoEm: string;
    status: StatusEscolhaRematricula;
  } | null;
}

export interface DadosRematricula {
  ok: boolean;
  erro?: string;
  unidade?: string;
  aluno?: AlunoSponteRematricula;
  responsaveis?: ResponsavelRematricula[];
  mensalidade?: MensalidadeVigente | null;
  material?: MaterialRematricula;
}

const TokenSchema = z.object({ token: z.string().min(16) });

async function materialDaSerie(
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

export const dadosRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenSchema.parse(input))
  .handler(async ({ data }): Promise<DadosRematricula> => {
    const sessao = await resolverSessao(data.token);
    if (!sessao) return { ok: false, erro: MENSAGEM_SESSAO_EXPIRADA };

    const aluno = await buscarAlunoPorId(sessao.unidade, sessao.alunoId);
    if (!aluno) {
      return {
        ok: false,
        erro: "Não conseguimos ler os dados do aluno agora. Tente novamente em alguns minutos.",
      };
    }

    const creds = resolverCredenciais(sessao.unidade);
    let responsavelFinanceiroId = "";
    if (creds) {
      try {
        const xml = await callSponte(
          "GetAlunos",
          `AlunoID=${sessao.alunoId}`,
          creds.codigoCliente,
          creds.token,
        );
        const node = parseXmlList(xml, "wsAluno").find(
          (n) => parseXmlValue(n, "AlunoID") === sessao.alunoId,
        );
        responsavelFinanceiroId = node ? parseXmlValue(node, "ResponsavelFinanceiroID") : "";
      } catch {
        responsavelFinanceiroId = "";
      }
    }

    const [responsaveis, mensalidade, material, escolha] = await Promise.all([
      buscarResponsaveis(sessao.unidade, sessao.alunoId, responsavelFinanceiroId),
      buscarMensalidadeVigente(sessao.unidade, sessao.alunoId),
      materialDaSerie(sessao.unidade, aluno.serie),
      supabaseAdmin
        .from("rematricula_escolhas" as never)
        .select("parcelas, updated_at, status")
        .eq("unidade", sessao.unidade)
        .eq("aluno_id", sessao.alunoId)
        .maybeSingle<{
          parcelas: number;
          updated_at: string;
          status: StatusEscolhaRematricula;
        }>(),
    ]);

    return {
      ok: true,
      unidade: sessao.unidade,
      aluno,
      responsaveis,
      mensalidade,
      material: {
        configurado: !!material,
        valorAnual: material?.valorAnual ?? 0,
        serie: material?.serieCadastrada || aluno.serie,
        opcoes: material ? opcoesParcelamentoMaterialPrimeira(material.valorAnual) : [],
        escolhaAtual: escolha.data
          ? {
              parcelas: escolha.data.parcelas,
              atualizadoEm: escolha.data.updated_at,
              status: escolha.data.status,
            }
          : null,
      },
    };
  });

const EscolhaSchema = z.object({
  token: z.string().min(16),
  parcelas: z.number().int().min(1).max(8),
});

export interface SalvarEscolhaResult {
  ok: boolean;
  erro?: string;
  parcelas?: number;
}

// Registra a escolha de parcelamento do material. NÃO cria nenhuma conta a
// receber no Sponte: fica como 'pendente_lancamento' e é a secretaria quem
// revisa e efetiva o lançamento na tela interna.
export const salvarEscolhaMaterialRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => EscolhaSchema.parse(input))
  .handler(async ({ data }): Promise<SalvarEscolhaResult> => {
    const sessao = await resolverSessao(data.token);
    if (!sessao) return { ok: false, erro: MENSAGEM_SESSAO_EXPIRADA };
    if (!parcelasMaterialValida(data.parcelas)) {
      return { ok: false, erro: "Escolha de 1 a 8 parcelas." };
    }

    const aluno = await buscarAlunoPorId(sessao.unidade, sessao.alunoId);
    if (!aluno) return { ok: false, erro: "Não conseguimos confirmar os dados do aluno." };

    // O valor vem do cadastro, relido agora — não do que a tela mandou.
    const material = await materialDaSerie(sessao.unidade, aluno.serie);
    if (!material) {
      return {
        ok: false,
        erro: "O valor do material da série do aluno ainda não está disponível. Fale com a secretaria.",
      };
    }

    // Escolha já efetivada pela secretaria não pode ser trocada pelo portal: o
    // título no Sponte foi criado com o parcelamento anterior.
    const { data: existente } = await supabaseAdmin
      .from("rematricula_escolhas" as never)
      .select("status")
      .eq("unidade", sessao.unidade)
      .eq("aluno_id", sessao.alunoId)
      .maybeSingle<{ status: StatusEscolhaRematricula }>();
    if (existente && existente.status !== "pendente_lancamento") {
      return {
        ok: false,
        erro: "Sua escolha já está em processamento pela secretaria. Fale com a escola para alterá-la.",
      };
    }

    const parcelamento = parcelamentoMaterialPrimeira(material.valorAnual, data.parcelas);
    const anoLetivo = await anoLetivoConfigurado();
    const agora = new Date().toISOString();
    const { error } = await supabaseAdmin.from("rematricula_escolhas" as never).upsert(
      {
        unidade: sessao.unidade,
        aluno_id: sessao.alunoId,
        aluno_nome: aluno.nome,
        serie: material.serieCadastrada,
        serie_chave: chaveSerie(aluno.serie),
        valor_anual: material.valorAnual,
        parcelas: parcelamento.parcelas,
        valor_parcela: parcelamento.valorParcela,
        // Coluna da fase anterior (sobra na última): a sobra agora vai na 1ª, e a
        // coluna guarda o valor comum das demais parcelas.
        valor_ultima_parcela: parcelamento.valorParcela,
        valor_primeira_parcela: parcelamento.valorPrimeiraParcela,
        ano_letivo: anoLetivo,
        status: "pendente_lancamento",
        updated_at: agora,
      } as never,
      { onConflict: "unidade,aluno_id" },
    );
    if (error) {
      console.error(`${LOG_TAG} falha ao salvar a escolha: ${error.message}`);
      return { ok: false, erro: "Não foi possível salvar sua escolha. Tente novamente." };
    }
    return { ok: true, parcelas: parcelamento.parcelas };
  });

// ─── Atualização da rotina escolar (portal público) ─────────────────────────
//
// A rotina é dado LOCAL (o Sponte não tem campo para ela). A sugestão inicial
// vem da rotina já enviada pelo aluno ou, na falta dela, do plano cadastrado no
// Diário do Aluno — sempre da unidade da sessão, nunca de outra.

export interface RotinaRematriculaResult {
  ok: boolean;
  erro?: string;
  serie?: string;
  // De onde veio a sugestão: "rematricula"/"matricula" (envio anterior),
  // "diario" (plano do Diário) ou "" (etapa em branco).
  origem?: string;
  rotina?: RotinaForm;
}

interface LinhaRotinaSalva {
  data_inicio: string;
  horarios: { weekday: number; entrada: string; saida: string }[];
  refeicoes: Record<string, number[]>;
  origem: string;
}

function planoDaRotinaSalva(linha: LinhaRotinaSalva): PlanoRotinaExistente {
  const refeicoes: { meal: MealKey; weekday: Weekday }[] = [];
  for (const meal of REFEICOES_ROTINA) {
    for (const dia of linha.refeicoes[meal] ?? []) {
      refeicoes.push({ meal, weekday: dia as Weekday });
    }
  }
  return {
    dataInicio: linha.data_inicio,
    horarios: linha.horarios.map((h) => ({
      weekday: h.weekday as Weekday,
      entrada: h.entrada,
      saida: h.saida,
    })),
    refeicoes,
  };
}

// Plano do Diário do Aluno da mesma unidade (o par school_id + sponte_aluno_id
// é único, então não há risco de pegar homônimo de outra escola).
async function planoDoDiario(
  unidade: string,
  alunoId: string,
): Promise<PlanoRotinaExistente | null> {
  const { data: escola } = await supabaseAdmin
    .from("schools")
    .select("id")
    .eq("name", unidade)
    .maybeSingle<{ id: string }>();
  if (!escola) return null;

  const { data: aluno } = await supabaseAdmin
    .from("diario_students" as never)
    .select("id")
    .eq("school_id", escola.id)
    .eq("sponte_aluno_id", alunoId)
    .maybeSingle<{ id: string }>();
  if (!aluno) return null;

  const [horarios, refeicoes] = await Promise.all([
    supabaseAdmin
      .from("diario_schedules" as never)
      .select("weekday, entry, exit")
      .eq("student_id", aluno.id),
    supabaseAdmin
      .from("diario_meal_plans" as never)
      .select("meal, weekday")
      .eq("student_id", aluno.id),
  ]);

  const linhasHorario = (horarios.data ?? []) as { weekday: number; entry: string; exit: string }[];
  const linhasRefeicao = (refeicoes.data ?? []) as { meal: MealKey; weekday: number }[];
  if (linhasHorario.length === 0 && linhasRefeicao.length === 0) return null;

  return {
    horarios: linhasHorario.map((h) => ({
      weekday: h.weekday as Weekday,
      entrada: h.entry,
      saida: h.exit,
    })),
    refeicoes: linhasRefeicao.map((r) => ({ meal: r.meal, weekday: r.weekday as Weekday })),
  };
}

// Uma linha de rotina por aluno/ano letivo na rematrícula (reenvio atualiza).
function submissionIdRotinaRematricula(
  unidade: string,
  alunoId: string,
  ano: number | null,
): string {
  return `rematricula:${unidade}:${alunoId}:${ano ?? "sem-ano"}`;
}

export const rotinaRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TokenSchema.parse(input))
  .handler(async ({ data }): Promise<RotinaRematriculaResult> => {
    const sessao = await resolverSessao(data.token);
    if (!sessao) return { ok: false, erro: MENSAGEM_SESSAO_EXPIRADA };

    const aluno = await buscarAlunoPorId(sessao.unidade, sessao.alunoId);
    if (!aluno) return { ok: false, erro: "Não conseguimos ler os dados do aluno agora." };
    const serie = aluno.serie;

    const { data: salva } = await supabaseAdmin
      .from("student_routine" as never)
      .select("data_inicio, horarios, refeicoes, origem")
      .eq("unidade", sessao.unidade)
      .eq("sponte_aluno_id", Number(sessao.alunoId))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<LinhaRotinaSalva>();

    if (salva) {
      return {
        ok: true,
        serie,
        origem: salva.origem,
        rotina: rotinaDoPlanoExistente(planoDaRotinaSalva(salva), serie),
      };
    }

    const plano = await planoDoDiario(sessao.unidade, sessao.alunoId);
    if (plano) {
      return { ok: true, serie, origem: "diario", rotina: rotinaDoPlanoExistente(plano, serie) };
    }

    return { ok: true, serie, origem: "", rotina: { ...ROTINA_FORM_VAZIA } };
  });

const DiaRotinaSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const HorarioRotinaSchema = z.object({ entrada: z.string().max(5), saida: z.string().max(5) });

const SalvarRotinaSchema = z.object({
  token: z.string().min(16),
  rotina: z.object({
    dataInicio: z.string().max(10),
    frequenciaParcial: z.boolean(),
    diasSelecionados: z.array(DiaRotinaSchema),
    periodoManha: z.boolean(),
    periodoTarde: z.boolean(),
    horarioEstendido: z.boolean(),
    horarios: z.record(z.string(), HorarioRotinaSchema),
    semRefeicoes: z.boolean(),
    refeicoes: z.object({
      breakfast: z.array(DiaRotinaSchema),
      lunch: z.array(DiaRotinaSchema),
      snack: z.array(DiaRotinaSchema),
      dinner: z.array(DiaRotinaSchema),
    }),
  }),
});

export interface SalvarRotinaRematriculaResult {
  ok: boolean;
  erro?: string;
  erros?: Record<string, string>;
}

export const salvarRotinaRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SalvarRotinaSchema.parse(input))
  .handler(async ({ data }): Promise<SalvarRotinaRematriculaResult> => {
    const sessao = await resolverSessao(data.token);
    if (!sessao) return { ok: false, erro: MENSAGEM_SESSAO_EXPIRADA };

    const aluno = await buscarAlunoPorId(sessao.unidade, sessao.alunoId);
    if (!aluno) return { ok: false, erro: "Não conseguimos confirmar os dados do aluno." };

    // A série vem do Sponte, não da tela: é ela que define o horário fixo gravado.
    const rotina = data.rotina as RotinaForm;
    const erros = validarRotinaForm(rotina, aluno.serie);
    if (Object.keys(erros).length > 0) {
      return { ok: false, erros, erro: "Confira os campos destacados." };
    }

    const anoLetivo = await anoLetivoConfigurado();
    const dados = montarRotinaPersistida(rotina, aluno.serie);
    const { error } = await supabaseAdmin.from("student_routine" as never).upsert(
      {
        submission_id: submissionIdRotinaRematricula(sessao.unidade, sessao.alunoId, anoLetivo),
        unidade: sessao.unidade,
        sponte_aluno_id: Number(sessao.alunoId),
        aluno_nome: aluno.nome,
        serie: aluno.serie,
        origem: "rematricula",
        ano_letivo: anoLetivo,
        data_inicio: dados.dataInicio,
        dias_ativos: dados.diasAtivos,
        horarios: dados.horarios,
        periodo_manha: dados.periodoManha,
        periodo_tarde: dados.periodoTarde,
        horario_estendido: dados.horarioEstendido,
        sem_refeicoes: dados.semRefeicoes,
        refeicoes: dados.refeicoes,
      } as never,
      { onConflict: "submission_id" },
    );
    if (error) {
      console.error(`${LOG_TAG} falha ao salvar a rotina: ${error.message}`);
      return { ok: false, erro: "Não foi possível salvar a rotina. Tente novamente." };
    }
    return { ok: true };
  });

// ─── Sincronização cadastral (portal público → Sponte) ──────────────────────
//
// Liberada na Fase A: o Sponte preserva os campos que voltam com o valor lido e
// não limpa campo enviado vazio. O procedimento é sempre ler a ficha completa,
// trocar só o que o responsável editou, escrever e RELER para conferir. Toda
// alteração é auditada (campo, antes, depois, resultado), inclusive quando a
// escrita falha.

const EdicaoSchema = z.object({
  cep: z.string().trim().max(20).optional(),
  endereco: z.string().trim().max(200).optional(),
  numeroEndereco: z.string().trim().max(20).optional(),
  complementoEndereco: z.string().trim().max(100).optional(),
  bairro: z.string().trim().max(100).optional(),
  cidade: z.string().trim().max(100).optional(),
  // Telefone único do portal: grava SEMPRE em Celular, nunca em Fone
  // Residencial (o campo `telefone` do Sponte não é editável por aqui).
  celular: z.string().trim().max(30).optional(),
  email: z.string().trim().max(150).optional(),
});

const SincronizarCadastroSchema = z.object({
  token: z.string().min(16),
  aluno: EdicaoSchema.optional(),
  responsaveis: z
    .array(EdicaoSchema.extend({ responsavelId: z.string().trim().min(1) }))
    .max(4)
    .optional(),
});

export interface SincronizarCadastroResult {
  ok: boolean;
  erro?: string;
  // Campos gravados por entidade e o que o Sponte recusou.
  alteracoes?: { escopo: string; campo: string; de: string; para: string }[];
  falhas?: { escopo: string; erro: string }[];
}

interface AuditoriaCadastro {
  unidade: string;
  aluno_id: string;
  escopo: "aluno" | "responsavel";
  registro_id: string;
  campo: string;
  valor_antes: string;
  valor_depois: string;
  resultado: "gravado" | "falhou";
  erro: string;
}

async function gravarAuditoriaCadastro(linhas: AuditoriaCadastro[]): Promise<void> {
  if (linhas.length === 0) return;
  const { error } = await supabaseAdmin
    .from("rematricula_cadastro_auditoria" as never)
    .insert(linhas as never);
  if (error) console.error(`${LOG_TAG} falha ao gravar a auditoria cadastral: ${error.message}`);
}

export const sincronizarCadastroRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SincronizarCadastroSchema.parse(input))
  .handler(async ({ data }): Promise<SincronizarCadastroResult> => {
    const sessao = await resolverSessao(data.token);
    if (!sessao) return { ok: false, erro: MENSAGEM_SESSAO_EXPIRADA };

    const leituraAluno = await lerFichaAlunoSponte(sessao.unidade, sessao.alunoId);
    if (!leituraAluno.ficha) {
      return {
        ok: false,
        erro: "Não conseguimos ler seu cadastro agora. Tente novamente em alguns minutos.",
      };
    }

    const alteracoes: { escopo: string; campo: string; de: string; para: string }[] = [];
    const falhas: { escopo: string; erro: string }[] = [];
    const auditoria: AuditoriaCadastro[] = [];

    async function sincronizar<T extends object>(
      escopo: "aluno" | "responsavel",
      registroId: string,
      rotulo: string,
      lida: T,
      edicao: EdicaoCadastral,
      escrever: (ficha: T) => Promise<EscritaCadastroResult>,
      reler: () => Promise<T | null>,
    ): Promise<void> {
      const aEnviar = aplicarEdicao(lida, edicao, CAMPOS_EDITAVEIS_ALUNO);
      const mudancas = camposAlterados(lida, aEnviar);
      if (mudancas.length === 0) return;

      // Trava dupla: nenhum campo que tinha conteúdo pode sair vazio no payload.
      const esvaziados = camposEsvaziados(lida, aEnviar);
      if (esvaziados.length > 0) {
        falhas.push({
          escopo: rotulo,
          erro: "Alteração recusada para não apagar dados no Sponte.",
        });
        return;
      }

      const escrita = await escrever(aEnviar);
      const erroEscrita = escrita.ok
        ? ""
        : (escrita.error ?? "O Sponte não confirmou a atualização.");

      for (const m of mudancas) {
        auditoria.push({
          unidade: sessao!.unidade,
          aluno_id: sessao!.alunoId,
          escopo,
          registro_id: registroId,
          campo: m.campo,
          valor_antes: m.de,
          valor_depois: m.para,
          resultado: escrita.ok ? "gravado" : "falhou",
          erro: erroEscrita,
        });
      }

      if (!escrita.ok) {
        falhas.push({ escopo: rotulo, erro: erroEscrita });
        return;
      }

      // Releitura: qualquer campo fora da edição que tenha mudado é sinal de
      // sobrescrita do Sponte e precisa aparecer para a secretaria.
      const depois = await reler();
      if (depois) {
        const divergencias = divergenciasForaDaEdicao(
          lida,
          depois,
          mudancas.map((m) => m.campo),
        );
        if (divergencias.length > 0) {
          console.error(
            `${LOG_TAG} divergência fora da edição em ${rotulo} do aluno ${sessao!.alunoId}: ${divergencias
              .map((d) => d.campo)
              .join(", ")}`,
          );
        }
      }

      for (const m of mudancas) {
        alteracoes.push({ escopo: rotulo, campo: m.campo, de: m.de, para: m.para });
      }
    }

    if (data.aluno) {
      await sincronizar(
        "aluno",
        leituraAluno.ficha.alunoId,
        "Aluno",
        leituraAluno.ficha,
        data.aluno,
        (ficha) => atualizarFichaAlunoSponte(sessao.unidade, ficha),
        async () => (await lerFichaAlunoSponte(sessao.unidade, sessao.alunoId)).ficha,
      );
    }

    for (const entrada of data.responsaveis ?? []) {
      const { responsavelId, ...edicao } = entrada;
      const ler = () =>
        lerFichaResponsavelSponte(
          sessao.unidade,
          sessao.alunoId,
          responsavelId,
          leituraAluno.ficha!.responsavelFinanceiroId,
          leituraAluno.ficha!.responsavelDidaticoId,
        );
      const leitura = await ler();
      if (!leitura.ficha) {
        falhas.push({
          escopo: "Responsável",
          erro: "Não conseguimos ler o cadastro do responsável.",
        });
        continue;
      }
      await sincronizar(
        "responsavel",
        responsavelId,
        leitura.ficha.nome || "Responsável",
        leitura.ficha,
        edicao,
        (ficha) => atualizarFichaResponsavelSponte(sessao.unidade, ficha),
        async () => (await ler()).ficha,
      );
    }

    await gravarAuditoriaCadastro(auditoria);
    return { ok: falhas.length === 0, alteracoes, falhas };
  });

// ─── Ano letivo de referência ───────────────────────────────────────────────

async function anoLetivoConfigurado(): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("rematricula_config" as never)
    .select("ano_letivo")
    .eq("id", true)
    .maybeSingle<{ ano_letivo: number }>();
  return data ? Number(data.ano_letivo) : null;
}

export interface AnoLetivoRematricula {
  anoLetivo: number | null;
  atualizadoEm: string;
  atualizadoPor: string;
}

export const obterAnoLetivoRematricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnoLetivoRematricula> => {
    await exigirPermissaoMaterialPedagogico(context.userId, false);
    const { data } = await supabaseAdmin
      .from("rematricula_config" as never)
      .select("ano_letivo, updated_at, updated_by_nome")
      .eq("id", true)
      .maybeSingle<{ ano_letivo: number; updated_at: string; updated_by_nome: string | null }>();
    return {
      anoLetivo: data ? Number(data.ano_letivo) : null,
      atualizadoEm: data?.updated_at ?? "",
      atualizadoPor: data?.updated_by_nome ?? "",
    };
  });

export const salvarAnoLetivoRematricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ anoLetivo: z.number().int() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoMaterialPedagogico(context.userId, true);
    if (!anoLetivoValido(data.anoLetivo)) {
      throw new Error(`Informe um ano entre ${ANO_LETIVO_MIN} e ${ANO_LETIVO_MAX}.`);
    }
    const { error } = await supabaseAdmin.from("rematricula_config" as never).upsert(
      {
        id: true,
        ano_letivo: data.anoLetivo,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_nome: await nomeDoUsuario(context.userId),
      } as never,
      { onConflict: "id" } as never,
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Tela interna: solicitações de rematrícula ──────────────────────────────

export interface SolicitacaoRematricula {
  id: string;
  unidade: string;
  alunoId: string;
  alunoNome: string;
  serie: string;
  valorAnual: number;
  parcelas: number;
  valorParcela: number;
  valorPrimeiraParcela: number;
  anoLetivo: number | null;
  status: StatusEscolhaRematricula;
  solicitadaEm: string;
  efetivadaEm: string;
  efetivadaPor: string;
  sponteContaReceberId: string;
  sponteErro: string;
  parcelasLancadas: ParcelaMaterial[];
}

interface EscolhaRow {
  id: string;
  unidade: string;
  aluno_id: string;
  aluno_nome: string;
  serie: string;
  valor_anual: number;
  parcelas: number;
  valor_parcela: number;
  valor_primeira_parcela: number | null;
  ano_letivo: number | null;
  status: StatusEscolhaRematricula;
  created_at: string;
  updated_at: string;
  efetivada_at: string | null;
  efetivada_por_nome: string | null;
  sponte_conta_receber_id: string | null;
  sponte_erro: string | null;
  parcelas_lancadas: ParcelaMaterial[] | null;
  historico: { status: string; at: string; por: string }[] | null;
}

const CAMPOS_ESCOLHA =
  "id, unidade, aluno_id, aluno_nome, serie, valor_anual, parcelas, valor_parcela, valor_primeira_parcela, ano_letivo, status, created_at, updated_at, efetivada_at, efetivada_por_nome, sponte_conta_receber_id, sponte_erro, parcelas_lancadas, historico";

function paraSolicitacao(r: EscolhaRow): SolicitacaoRematricula {
  return {
    id: r.id,
    unidade: r.unidade,
    alunoId: r.aluno_id,
    alunoNome: r.aluno_nome,
    serie: r.serie,
    valorAnual: Number(r.valor_anual),
    parcelas: r.parcelas,
    valorParcela: Number(r.valor_parcela),
    valorPrimeiraParcela: Number(r.valor_primeira_parcela ?? r.valor_parcela),
    anoLetivo: r.ano_letivo ?? null,
    status: r.status,
    solicitadaEm: r.created_at,
    efetivadaEm: r.efetivada_at ?? "",
    efetivadaPor: r.efetivada_por_nome ?? "",
    sponteContaReceberId: r.sponte_conta_receber_id ?? "",
    sponteErro: r.sponte_erro ?? "",
    parcelasLancadas: r.parcelas_lancadas ?? [],
  };
}

async function exigirPermissaoRematricula(userId: string, edicao: boolean): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "rematricula" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para efetivar solicitações de rematrícula."
        : "Você não tem permissão para ver as solicitações de rematrícula.",
    );
  }
  return nomeDoUsuario(userId);
}

export const listarSolicitacoesRematricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SolicitacaoRematricula[]> => {
    await exigirPermissaoRematricula(context.userId, false);
    const { data, error } = await supabaseAdmin
      .from("rematricula_escolhas" as never)
      .select(CAMPOS_ESCOLHA)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as EscolhaRow[]).map(paraSolicitacao);
  });

// ─── Tela interna: Rematrícula — Acompanhamento ─────────────────────────────
// Uma linha por aluno ATIVO da unidade (a lista vem do Sponte, não do que o
// portal gravou), cruzada com escolha, acesso ao portal e auditoria cadastral.
// Somente leitura: abrir a tela nunca fala com o Sponte para escrever.

export interface AcompanhamentoRematriculaResult {
  unidade: string;
  alunos: AlunoAtivoAcompanhamento[];
  escolhas: EscolhaAcompanhamento[];
  acessos: AcessoAcompanhamento[];
  cadastroAlterados: { unidade: string; alunoId: string }[];
  error?: string;
}

const UnidadeSchema = z.object({ unidade: z.string().min(1) });

export const acompanhamentoRematricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnidadeSchema.parse(input))
  .handler(async ({ data, context }): Promise<AcompanhamentoRematriculaResult> => {
    await exigirPermissaoRematricula(context.userId, false);
    const { unidade } = data;
    const vazio: AcompanhamentoRematriculaResult = {
      unidade,
      alunos: [],
      escolhas: [],
      acessos: [],
      cadastroAlterados: [],
    };

    const permitidas = await allowedSponteUnidades(context.userId);
    if (permitidas !== null && !permitidas.includes(unidade)) {
      return { ...vazio, error: "Sem permissão para esta unidade." };
    }

    const [ativos, escolhas, acessos, auditoria] = await Promise.all([
      alunosAtivosDaUnidade(unidade),
      supabaseAdmin
        .from("rematricula_escolhas" as never)
        .select(CAMPOS_ESCOLHA)
        .eq("unidade", unidade),
      supabaseAdmin
        .from("rematricula_acessos" as never)
        .select("unidade, aluno_id, ultimo_acesso_em")
        .eq("unidade", unidade),
      supabaseAdmin
        .from("rematricula_cadastro_auditoria" as never)
        .select("aluno_id")
        .eq("unidade", unidade)
        .eq("resultado", "gravado"),
    ]);

    const linhas = (escolhas.data ?? []) as unknown as EscolhaRow[];
    const alterados = new Set(
      ((auditoria.data ?? []) as unknown as { aluno_id: string }[]).map((a) => a.aluno_id),
    );

    return {
      unidade,
      alunos: ativos.alunos.map((a) => ({
        alunoId: a.alunoId,
        nome: a.nome,
        unidade,
        turma: a.turma,
      })),
      escolhas: linhas.map((r) => ({
        unidade: r.unidade,
        alunoId: r.aluno_id,
        serie: r.serie,
        valorAnual: Number(r.valor_anual),
        parcelas: r.parcelas,
        valorParcela: Number(r.valor_parcela),
        valorPrimeiraParcela: Number(r.valor_primeira_parcela ?? r.valor_parcela),
        anoLetivo: r.ano_letivo ?? null,
        status: r.status,
        atualizadoEm: r.updated_at,
        sponteContaReceberId: r.sponte_conta_receber_id ?? "",
        sponteErro: r.sponte_erro ?? "",
        id: r.id,
      })),
      acessos: ((acessos.data ?? []) as unknown as AcessoRow[]).map((a) => ({
        unidade: a.unidade,
        alunoId: a.aluno_id,
        ultimoAcessoEm: a.ultimo_acesso_em,
      })),
      cadastroAlterados: [...alterados].map((alunoId) => ({ unidade, alunoId })),
      error: ativos.error,
    };
  });

interface AcessoRow {
  unidade: string;
  aluno_id: string;
  ultimo_acesso_em: string;
}

export interface AlteracaoCadastralRematricula {
  escopo: "aluno" | "responsavel";
  registroId: string;
  campo: string;
  valorAntes: string;
  valorDepois: string;
  resultado: "gravado" | "falhou";
  erro: string;
  em: string;
}

export interface DetalheAcompanhamentoResult {
  escolha: SolicitacaoRematricula | null;
  alteracoes: AlteracaoCadastralRematricula[];
  anoLetivo: number | null;
}

const DetalheSchema = z.object({ unidade: z.string().min(1), alunoId: z.string().min(1) });

// Detalhe da revisão ANTES da aprovação: o que foi escolhido, o ano letivo de
// referência e as correções cadastrais que o responsável fez no portal.
export const detalheAcompanhamentoRematricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DetalheSchema.parse(input))
  .handler(async ({ data, context }): Promise<DetalheAcompanhamentoResult> => {
    await exigirPermissaoRematricula(context.userId, false);
    const permitidas = await allowedSponteUnidades(context.userId);
    if (permitidas !== null && !permitidas.includes(data.unidade)) {
      throw new Error("Sem permissão para esta unidade.");
    }

    const [escolha, auditoria, anoLetivo] = await Promise.all([
      supabaseAdmin
        .from("rematricula_escolhas" as never)
        .select(CAMPOS_ESCOLHA)
        .eq("unidade", data.unidade)
        .eq("aluno_id", data.alunoId)
        .maybeSingle<EscolhaRow>(),
      supabaseAdmin
        .from("rematricula_cadastro_auditoria" as never)
        .select(
          "escopo, registro_id, campo, valor_antes, valor_depois, resultado, erro, created_at",
        )
        .eq("unidade", data.unidade)
        .eq("aluno_id", data.alunoId)
        .order("created_at", { ascending: false }),
      anoLetivoConfigurado(),
    ]);

    return {
      escolha: escolha.data ? paraSolicitacao(escolha.data) : null,
      alteracoes: ((auditoria.data ?? []) as unknown as AuditoriaRow[]).map((a) => ({
        escopo: a.escopo,
        registroId: a.registro_id,
        campo: a.campo,
        valorAntes: a.valor_antes,
        valorDepois: a.valor_depois,
        resultado: a.resultado,
        erro: a.erro,
        em: a.created_at,
      })),
      anoLetivo,
    };
  });

interface AuditoriaRow {
  escopo: "aluno" | "responsavel";
  registro_id: string;
  campo: string;
  valor_antes: string;
  valor_depois: string;
  resultado: "gravado" | "falhou";
  erro: string;
  created_at: string;
}

export interface EfetivarEscolhaResult {
  ok: boolean;
  erro?: string;
  lancadaNoSponte?: boolean;
  sponteContaReceberId?: string;
  sponteErro?: string;
  parcelas?: ParcelaMaterial[];
}

async function carregarEscolha(id: string): Promise<EscolhaRow | null> {
  const { data } = await supabaseAdmin
    .from("rematricula_escolhas" as never)
    .select(CAMPOS_ESCOLHA)
    .eq("id", id)
    .maybeSingle<EscolhaRow>();
  return data ?? null;
}

async function registrarErroLancamento(id: string, erro: string): Promise<void> {
  await supabaseAdmin
    .from("rematricula_escolhas" as never)
    .update({ sponte_erro: erro } as never)
    .eq("id", id);
}

// Lançamento no Sponte: UMA chamada InsertPlano com o número de parcelas
// escolhido (todas no valor base) e UM UpdateParcela levando a sobra de centavos
// para a 1ª parcela. Só é chamada com a linha já reivindicada em 'efetivada', e
// a gravação final exige status='efetivada' — nenhum caminho cria dois títulos.
async function lancarMaterialNoSponte(
  escolha: EscolhaRow,
  nome: string,
): Promise<EfetivarEscolhaResult> {
  const falhar = async (erro: string): Promise<EfetivarEscolhaResult> => {
    await registrarErroLancamento(escolha.id, erro);
    return { ok: true, lancadaNoSponte: false, sponteErro: erro };
  };

  const anoLetivo = await anoLetivoConfigurado();
  if (anoLetivo === null) {
    return falhar(
      'Configure o "Ano Letivo de Referência" em Configurações antes de lançar — nenhuma cobrança foi criada.',
    );
  }

  const titulos = await coletarTitulosAluno(escolha.unidade, escolha.aluno_id);
  if (titulos.indisponivel || titulos.error) {
    return falhar(
      titulos.error ??
        "Credenciais do Sponte ausentes para esta unidade — nenhuma cobrança foi criada.",
    );
  }

  // Âncora: a primeira mensalidade em aberto do ano letivo configurado. Sem ela
  // o vencimento sairia de um palpite — melhor não lançar nada.
  const ancora = primeiraMensalidadeDoAnoLetivo(titulos.titulos, anoLetivo);
  if (!ancora) {
    return falhar(
      `O aluno não tem mensalidade em aberto em ${anoLetivo} no Sponte — nenhuma cobrança foi criada. Emita as mensalidades do ano e lance de novo.`,
    );
  }

  const vencimentos = vencimentosMaterialPelasMensalidades(
    titulos.titulos,
    ancora.vencimento,
    escolha.parcelas,
  );
  const cronograma = cronogramaMaterialFaseB(
    Number(escolha.valor_anual),
    escolha.parcelas,
    vencimentos,
  );
  const observacao = observacaoMaterialSponte(anoLetivo, escolha.parcelas);

  const inserido = await inserirPlanoSponte({
    unidade: escolha.unidade,
    sponteAlunoId: escolha.aluno_id,
    valor: cronograma.valorParcela,
    vencimento: ancora.vencimento,
    categoria: CATEGORIA_MATERIAL_SPONTE,
    observacao,
    logTag: "[Rematrícula][Sponte]",
    parcelas: escolha.parcelas,
  });
  if (!inserido.ok || !inserido.contaReceberID) {
    return falhar(
      inserido.error ??
        "O Sponte não confirmou a criação da cobrança — nenhuma cobrança foi criada.",
    );
  }

  // Daqui para baixo a cobrança JÁ EXISTE: o título é gravado antes de qualquer
  // ajuste, para nunca ficar um lançamento no Sponte sem registro no School Hub.
  const contaReceberId = inserido.contaReceberID;
  const agoraISO = new Date().toISOString();
  const { error: erroGravacao } = await supabaseAdmin
    .from("rematricula_escolhas" as never)
    .update({
      status: "lancada",
      lancada_at: agoraISO,
      sponte_conta_receber_id: contaReceberId,
      parcelas_lancadas: cronograma.itens,
      ano_letivo: anoLetivo,
      sponte_erro: "",
      historico: [...(escolha.historico ?? []), { status: "lancada", at: agoraISO, por: nome }],
    } as never)
    .eq("id", escolha.id)
    .eq("status", "efetivada");
  if (erroGravacao) {
    return falhar(
      `Cobrança criada no Sponte (conta ${contaReceberId}), mas o School Hub não conseguiu registrar o status. NÃO lance novamente.`,
    );
  }

  // Ajuste dos centavos na 1ª parcela. A falha aqui não invalida o lançamento:
  // o título existe e só a 1ª parcela fica alguns centavos abaixo do total.
  if (cronograma.ajustaPrimeira) {
    const ajuste = await atualizarParcelaSponte({
      unidade: escolha.unidade,
      contaReceberId,
      numeroParcela: 1,
      valor: cronograma.valorPrimeiraParcela,
      vencimento: cronograma.itens[0].vencimento,
      categoria: CATEGORIA_MATERIAL_SPONTE,
      observacao,
      logTag: "[Rematrícula][Sponte]",
    });
    if (!ajuste.ok) {
      const erro = `Cobrança criada no Sponte (conta ${contaReceberId}), mas o ajuste de centavos da 1ª parcela falhou: ${ajuste.error ?? "o Sponte não confirmou"}. Corrija a 1ª parcela para ${cronograma.valorPrimeiraParcela.toFixed(2)} no Sponte. NÃO lance novamente.`;
      await registrarErroLancamento(escolha.id, erro);
      return {
        ok: true,
        lancadaNoSponte: true,
        sponteContaReceberId: contaReceberId,
        sponteErro: erro,
        parcelas: cronograma.itens,
      };
    }
  }

  return {
    ok: true,
    lancadaNoSponte: true,
    sponteContaReceberId: contaReceberId,
    parcelas: cronograma.itens,
  };
}

const EscolhaIdSchema = z.object({ id: z.string().uuid() });

export const efetivarEscolhaRematricula = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EscolhaIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<EfetivarEscolhaResult> => {
    const nome = await exigirPermissaoRematricula(context.userId, true);
    const escolha = await carregarEscolha(data.id);
    if (!escolha) return { ok: false, erro: "Solicitação não encontrada." };
    if (escolha.status !== "pendente_lancamento") {
      return {
        ok: false,
        erro:
          escolha.status === "lancada"
            ? "Esta solicitação já foi lançada no Sponte."
            : "Esta solicitação já foi efetivada.",
      };
    }

    // Reivindica a linha ANTES de falar com o Sponte: quem perde a corrida do
    // clique duplo não chega a criar cobrança nenhuma.
    const agoraISO = new Date().toISOString();
    const { data: atualizadas, error } = await supabaseAdmin
      .from("rematricula_escolhas" as never)
      .update({
        status: "efetivada",
        efetivada_at: agoraISO,
        efetivada_por: context.userId,
        efetivada_por_nome: nome,
        historico: [...(escolha.historico ?? []), { status: "efetivada", at: agoraISO, por: nome }],
      } as never)
      .eq("id", escolha.id)
      .eq("status", "pendente_lancamento")
      .select("id");
    if (error) return { ok: false, erro: "Não foi possível efetivar a solicitação." };
    if ((atualizadas ?? []).length === 0) {
      return { ok: false, erro: "Esta solicitação já foi efetivada." };
    }

    return lancarMaterialNoSponte({ ...escolha, status: "efetivada" }, nome);
  });

// Retentativa: só quando é seguro afirmar que NÃO existe título criado (a linha
// ficou em 'efetivada' e sem conta a receber). Com título gravado a função se
// recusa a chamar o Sponte de novo.
export const lancarEscolhaRematriculaNoSponte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EscolhaIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<EfetivarEscolhaResult> => {
    const nome = await exigirPermissaoRematricula(context.userId, true);
    const escolha = await carregarEscolha(data.id);
    if (!escolha) return { ok: false, erro: "Solicitação não encontrada." };
    if (escolha.status !== "efetivada") {
      return {
        ok: false,
        erro:
          escolha.status === "pendente_lancamento"
            ? "Efetive a solicitação antes de lançar no Sponte."
            : "Esta solicitação já está lançada no Sponte.",
      };
    }
    if (escolha.sponte_conta_receber_id) {
      return { ok: false, erro: "Esta solicitação já tem cobrança criada no Sponte." };
    }
    return lancarMaterialNoSponte(escolha, nome);
  });

// ─── Cadastro administrativo: Material Pedagógico por Série ─────────────────

export interface MaterialSerieRegistro {
  id: string;
  unidade: string;
  serie: string;
  valorAnual: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

async function exigirPermissaoMaterialPedagogico(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "rematricula" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      edicao
        ? "Você não tem permissão para editar os valores do material pedagógico."
        : "Você não tem permissão para ver os valores do material pedagógico.",
    );
  }
}

export const listarMaterialSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MaterialSerieRegistro[]> => {
    await exigirPermissaoMaterialPedagogico(context.userId, false);
    const { data, error } = await supabaseAdmin
      .from("material_pedagogico_series" as never)
      .select("id, unidade, serie, valor_anual, updated_at, updated_by_nome")
      .order("unidade")
      .order("serie");
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as unknown as {
      id: string;
      unidade: string;
      serie: string;
      valor_anual: number;
      updated_at: string;
      updated_by_nome: string | null;
    }[];
    return linhas.map((r) => ({
      id: r.id,
      unidade: r.unidade,
      serie: r.serie,
      valorAnual: Number(r.valor_anual),
      atualizadoEm: r.updated_at,
      atualizadoPor: r.updated_by_nome ?? "",
    }));
  });

const SalvarMaterialSerieSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  unidade: z.string().trim().min(1, "Informe a unidade."),
  serie: z.string().trim().min(1, "Informe a série."),
  valorAnual: z.number().positive("O valor anual deve ser maior que zero."),
});

export const salvarMaterialSerie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SalvarMaterialSerieSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoMaterialPedagogico(context.userId, true);
    if (!UNIDADES_SPONTE.includes(data.unidade)) {
      throw new Error("Unidade inválida.");
    }

    const registro = {
      unidade: data.unidade,
      serie: data.serie,
      serie_chave: chaveSerie(data.serie),
      valor_anual: data.valorAnual,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      updated_by_nome: await nomeDoUsuario(context.userId),
    };

    const { error } = data.id
      ? await supabaseAdmin
          .from("material_pedagogico_series" as never)
          .update(registro as never)
          .eq("id", data.id)
      : await supabaseAdmin
          .from("material_pedagogico_series" as never)
          .upsert(registro as never, { onConflict: "unidade,serie_chave" });
    if (error) {
      throw new Error(
        error.code === "23505"
          ? "Já existe um valor cadastrado para esta unidade e série."
          : error.message,
      );
    }
    return { ok: true };
  });

export const excluirMaterialSerie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await exigirPermissaoMaterialPedagogico(context.userId, true);
    const { error } = await supabaseAdmin
      .from("material_pedagogico_series" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
