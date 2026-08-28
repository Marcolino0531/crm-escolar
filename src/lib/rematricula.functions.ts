// Server functions do portal PÚBLICO de Rematrícula e do cadastro de Material
// Pedagógico por Série.
//
// Fronteira de confiança: o navegador manda apenas o CPF (para pedir o código) e
// depois um token de sessão opaco. Aluno, unidade, mensalidade, série e telefone
// do responsável são SEMPRE relidos do Sponte pelo servidor — nada do que o
// cliente informe é aceito como identidade.
//
// Nesta fase o portal NÃO escreve no Sponte: a escolha de parcelamento do
// material fica em rematricula_escolhas com status 'pendente_lancamento', e os
// campos cadastrais são exibidos somente para leitura.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cpfValido, normalizarCpf } from "@/lib/cantina";
import {
  DESAFIO_VAZIO,
  MENSAGEM_CODIGO_ENVIADO,
  MENSAGEM_SESSAO_EXPIRADA,
  chaveSerie,
  expiracaoCodigo,
  expiracaoSessao,
  gerarCodigoVerificacao,
  mensalidadeVigente,
  opcoesParcelamentoMaterial,
  parcelamentoMaterial,
  parcelasMaterialValida,
  serieDaTurma,
  validarCodigo,
  type DesafioCodigo,
  type MensalidadeVigente,
  type OpcaoParcelamento,
  type ParcelaMensalidade,
} from "@/lib/rematricula";
import {
  UNIDADES_SPONTE,
  callSponte,
  checkFault,
  classificarUnidade,
  escapeXml,
  parseXmlList,
  parseXmlValue,
  resolverCredenciais,
} from "@/lib/sponte.functions";
import { nomeDoUsuario } from "@/lib/atendimento-ia.server";
import { getWhatsAppAuthConfig, sendAuthenticationTemplate } from "@/lib/whatsapp.server";

const LOG_TAG = "[rematricula]";

// O CPF nunca é persistido: só o hash entra nas tabelas do portal.
function hashCpf(cpfDigitos: string): string {
  return createHash("sha256").update(`rematricula:${cpfDigitos}`).digest("hex");
}

function hashCodigo(cpfDigitos: string, codigo: string): string {
  return createHash("sha256").update(`rematricula-codigo:${cpfDigitos}:${codigo}`).digest("hex");
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

// Telefone do responsável financeiro — o MESMO número que a cobrança usa hoje
// para mandar boleto por WhatsApp (GetResponsavelFinanceiro).
async function telefoneResponsavelFinanceiro(
  unidade: string,
  alunoId: string,
): Promise<{ nome: string; telefone: string } | null> {
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
    const telefone = parseXmlValue(node, "Celular") || parseXmlValue(node, "Telefone");
    if (!telefone.trim()) return null;
    return { nome: parseXmlValue(node, "Nome"), telefone };
  } catch {
    return null;
  }
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

// ─── Desafio / sessão ───────────────────────────────────────────────────────

interface LinhaDesafio {
  codigo_hash: string;
  expira_em: string | null;
  tentativas: number;
  bloqueado_ate: string | null;
  consumido_em: string | null;
  unidade: string;
  aluno_id: string;
}

function paraDesafio(linha: LinhaDesafio | null): DesafioCodigo {
  if (!linha) return DESAFIO_VAZIO;
  return {
    codigoHash: linha.codigo_hash,
    expiraEm: linha.expira_em,
    tentativas: linha.tentativas,
    bloqueadoAte: linha.bloqueado_ate,
    consumidoEm: linha.consumido_em,
  };
}

const SolicitarCodigoSchema = z.object({ cpf: z.string().min(1) });

export interface SolicitarCodigoResult {
  ok: boolean;
  mensagem: string;
}

// PASSO 1 — pedir o código. A resposta é sempre a MESMA, exista ou não o CPF
// (aluno sem cadastro, responsável sem telefone e falha de envio devolvem o
// mesmo texto): o portal é público e não pode servir de consulta de cadastro.
export const solicitarCodigoRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SolicitarCodigoSchema.parse(input))
  .handler(async ({ data }): Promise<SolicitarCodigoResult> => {
    const cpf = normalizarCpf(data.cpf);
    if (!cpfValido(cpf)) {
      return { ok: false, mensagem: "Informe os 11 dígitos do CPF do aluno." };
    }

    const generico: SolicitarCodigoResult = { ok: true, mensagem: MENSAGEM_CODIGO_ENVIADO };
    const cpfHash = hashCpf(cpf);
    const agora = new Date().toISOString();

    const aluno = await buscarAlunoPorCpf(cpf);
    if (!aluno) {
      console.warn(`${LOG_TAG} pedido de código sem aluno correspondente (cpf_hash ${cpfHash}).`);
      return generico;
    }

    const responsavel = await telefoneResponsavelFinanceiro(aluno.unidade, aluno.alunoId);
    if (!responsavel) {
      console.warn(
        `${LOG_TAG} aluno ${aluno.alunoId} (${aluno.unidade}) sem telefone de responsável financeiro no Sponte.`,
      );
      return generico;
    }

    const cfg = getWhatsAppAuthConfig();
    if (!cfg) {
      console.error(
        `${LOG_TAG} template de autenticação não configurado (WHATSAPP_TEMPLATE_AUTENTICACAO_NAME); nenhum código enviado.`,
      );
      return generico;
    }

    // randomInt é criptográfico; o código em texto claro não é gravado nem logado.
    const codigo = gerarCodigoVerificacao(randomInt(0, 1_000_000) / 1_000_000);

    const { error: erroGrava } = await supabaseAdmin.from("rematricula_codigos" as never).upsert(
      {
        cpf_hash: cpfHash,
        codigo_hash: hashCodigo(cpf, codigo),
        expira_em: expiracaoCodigo(agora),
        tentativas: 0,
        bloqueado_ate: null,
        consumido_em: null,
        unidade: aluno.unidade,
        aluno_id: aluno.alunoId,
        enviado_em: agora,
        updated_at: agora,
      } as never,
      { onConflict: "cpf_hash" },
    );
    if (erroGrava) {
      console.error(`${LOG_TAG} falha ao registrar o desafio: ${erroGrava.message}`);
      return generico;
    }

    try {
      await sendAuthenticationTemplate(cfg, responsavel.telefone, codigo);
    } catch (e) {
      console.error(
        `${LOG_TAG} falha ao enviar o código para o aluno ${aluno.alunoId}: ${
          e instanceof Error ? e.message : "erro desconhecido"
        }`,
      );
    }
    return generico;
  });

const ValidarCodigoSchema = z.object({
  cpf: z.string().min(1),
  codigo: z.string().min(1),
});

export interface ValidarCodigoResult {
  ok: boolean;
  token?: string;
  expiraEm?: string;
  erro?: string;
}

// PASSO 2 — validar o código e abrir a sessão temporária. Expiração de 10
// minutos e bloqueio na 3ª tentativa errada são decididos no servidor.
export const validarCodigoRematricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ValidarCodigoSchema.parse(input))
  .handler(async ({ data }): Promise<ValidarCodigoResult> => {
    const cpf = normalizarCpf(data.cpf);
    const codigo = data.codigo.replace(/\D/g, "");
    if (!cpfValido(cpf)) return { ok: false, erro: "Informe os 11 dígitos do CPF do aluno." };

    const cpfHash = hashCpf(cpf);
    const agora = new Date().toISOString();

    const { data: linha } = await supabaseAdmin
      .from("rematricula_codigos" as never)
      .select("codigo_hash, expira_em, tentativas, bloqueado_ate, consumido_em, unidade, aluno_id")
      .eq("cpf_hash", cpfHash)
      .maybeSingle<LinhaDesafio>();

    const desafio = paraDesafio(linha ?? null);
    const resultado = validarCodigo(desafio, hashCodigo(cpf, codigo), agora);

    if (resultado.proximo !== desafio && linha) {
      await supabaseAdmin
        .from("rematricula_codigos" as never)
        .update({
          tentativas: resultado.proximo.tentativas,
          bloqueado_ate: resultado.proximo.bloqueadoAte,
          consumido_em: resultado.proximo.consumidoEm,
          updated_at: agora,
        } as never)
        .eq("cpf_hash", cpfHash);
    }

    if (!resultado.ok || !linha) return { ok: false, erro: resultado.mensagem };

    const token = randomBytes(32).toString("hex");
    const expiraEm = expiracaoSessao(agora);
    const { error } = await supabaseAdmin.from("rematricula_sessoes" as never).insert({
      token_hash: hashToken(token),
      cpf_hash: cpfHash,
      unidade: linha.unidade,
      aluno_id: linha.aluno_id,
      expira_em: expiraEm,
    } as never);
    if (error) {
      console.error(`${LOG_TAG} falha ao criar a sessão: ${error.message}`);
      return { ok: false, erro: "Não foi possível abrir a sessão. Tente novamente." };
    }

    // Faxina oportunista das sessões vencidas.
    await supabaseAdmin
      .from("rematricula_sessoes" as never)
      .delete()
      .lt("expira_em", agora);

    return { ok: true, token, expiraEm };
  });

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
  opcoes: OpcaoParcelamento[];
  escolhaAtual: { parcelas: number; atualizadoEm: string } | null;
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
        .select("parcelas, updated_at")
        .eq("unidade", sessao.unidade)
        .eq("aluno_id", sessao.alunoId)
        .maybeSingle<{ parcelas: number; updated_at: string }>(),
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
        opcoes: material ? opcoesParcelamentoMaterial(material.valorAnual) : [],
        escolhaAtual: escolha.data
          ? { parcelas: escolha.data.parcelas, atualizadoEm: escolha.data.updated_at }
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
// receber no Sponte: fica como 'pendente_lancamento' para a equipe lançar quando
// o lançamento automático for aprovado.
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

    const parcelamento = parcelamentoMaterial(material.valorAnual, data.parcelas);
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
        valor_ultima_parcela: parcelamento.valorUltimaParcela,
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

// ─── Cadastro administrativo: Material Pedagógico por Série ─────────────────

export interface MaterialSerieRegistro {
  id: string;
  unidade: string;
  serie: string;
  valorAnual: number;
  atualizadoEm: string;
  atualizadoPor: string;
}

async function exigirPermissaoConfiguracoes(userId: string, edicao: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    (edicao ? "can_edit_module" : "can_view_module") as never,
    { _user_id: userId, _module: "configuracoes" } as never,
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
    await exigirPermissaoConfiguracoes(context.userId, false);
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
    await exigirPermissaoConfiguracoes(context.userId, true);
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
    await exigirPermissaoConfiguracoes(context.userId, true);
    const { error } = await supabaseAdmin
      .from("material_pedagogico_series" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
