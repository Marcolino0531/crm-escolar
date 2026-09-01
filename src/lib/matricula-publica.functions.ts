// Server functions da página PÚBLICA de matrícula (/matricula).
//
// Sem Supabase Auth: quem envia é o responsável, de fora do sistema. As duas
// barreiras da porta aberta ficam aqui:
//
//  1. Captcha (Cloudflare Turnstile) verificado no servidor. Sem
//     TURNSTILE_SECRET_KEY configurada o envio é RECUSADO (fail-closed) — a
//     página avisa que o formulário está indisponível em vez de aceitar
//     submissão sem proteção.
//  2. Limite de 5 submissões por IP por hora, contado na própria auditoria
//     (`enrollment_submissions.ip_hash`). O IP nunca é gravado em texto: só o
//     hash SHA-256.
//
// O processamento em si é o MESMO do webhook do Google Forms
// (`receberMatricula`), então tratamento de Erro 29, vínculo de irmãos e o
// painel /matriculas continuam valendo sem nenhuma reimplementação.

import { createHash, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { UNIDADES_SPONTE } from "@/lib/sponte.functions";
import {
  BUCKET_DOCUMENTOS_MATRICULA,
  DOCUMENTOS_MATRICULA,
  MAX_SUBMISSOES_POR_IP,
  ORIGEM_SITE,
  TIPOS_DOCUMENTO_ACEITOS,
  excedeuLimitePorIp,
  inicioJanelaLimite,
  montarPayloadMatricula,
  montarRotinaPersistida,
  padronizarMatriculaForm,
  padronizarSaudeForm,
  serieCalculada,
  textoContatosEmergencia,
  textoPessoasAutorizadas,
  validarDocumentosForm,
  validarMatriculaForm,
  validarRotinaForm,
  validarSaudeForm,
  type DocumentoChave,
  type DocumentosForm,
  type MatriculaForm,
  type RotinaForm,
  type SaudeForm,
} from "@/lib/matricula-form";
import { receberMatricula } from "@/lib/matriculas.receber";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface ConfigMatriculaPublica {
  unidades: string[];
  // Site key do Turnstile servida em runtime (não é segredo) — assim trocar a
  // chave não exige rebuild do front.
  turnstileSiteKey: string;
  // false quando falta TURNSTILE_SECRET_KEY/SITE_KEY: a página mostra aviso e
  // não deixa enviar.
  captchaConfigurado: boolean;
}

export const configMatriculaPublica = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConfigMatriculaPublica> => {
    const siteKey = process.env.TURNSTILE_SITE_KEY ?? "";
    const secret = process.env.TURNSTILE_SECRET_KEY ?? "";
    return {
      unidades: UNIDADES_SPONTE,
      turnstileSiteKey: siteKey,
      captchaConfigurado: siteKey !== "" && secret !== "",
    };
  },
);

function hashIp(ip: string): string {
  return createHash("sha256").update(`matricula:${ip}`).digest("hex");
}

interface TurnstileResposta {
  success?: boolean;
  "error-codes"?: string[];
}

async function captchaValido(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  const corpo = new URLSearchParams({ secret, response: token });
  if (ip) corpo.set("remoteip", ip);
  try {
    const resposta = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: corpo,
      signal: AbortSignal.timeout(8000),
    });
    if (!resposta.ok) return false;
    const dados = (await resposta.json()) as TurnstileResposta;
    if (dados.success !== true) {
      console.warn("[matrículas] captcha recusado:", (dados["error-codes"] ?? []).join(", "));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[matrículas] falha ao verificar o captcha:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function submissoesRecentes(ipHash: string, agoraISO: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("enrollment_submissions" as never)
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", inicioJanelaLimite(agoraISO));
  if (error) {
    console.error("[matrículas] falha ao contar submissões do IP:", error.message);
    return 0;
  }
  return count ?? 0;
}

const EnderecoInput = z.object({
  cep: z.string(),
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  cidade: z.string(),
});

const ResponsavelInput = z.object({
  nome: z.string(),
  cpf: z.string(),
  dataNascimento: z.string(),
  telefone: z.string(),
  email: z.string(),
  mesmoEnderecoDoAluno: z.boolean(),
  endereco: EnderecoInput,
});

const HorarioInput = z.object({ entrada: z.string(), saida: z.string() });
const DiaInput = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

// Etapa 2 (Rotina Escolar) chega SEPARADA do formulário da etapa 1: o payload do
// Sponte é montado só a partir de `form`, então nada daqui pode escorregar para
// lá nem por descuido.
const RotinaInput = z.object({
  dataInicio: z.string(),
  frequenciaParcial: z.boolean(),
  diasSelecionados: z.array(DiaInput),
  periodoManha: z.boolean(),
  periodoTarde: z.boolean(),
  horarioEstendido: z.boolean(),
  horarios: z.record(z.string(), HorarioInput),
  semRefeicoes: z.boolean(),
  refeicoes: z.object({
    breakfast: z.array(DiaInput),
    lunch: z.array(DiaInput),
    snack: z.array(DiaInput),
    dinner: z.array(DiaInput),
  }),
});

const RespostaSaudeInput = z.object({
  opcao: z.enum(["Sim", "Não", ""]),
  detalhe: z.string(),
});

const ContatoEmergenciaInput = z.object({
  nome: z.string().max(120),
  telefone: z.string().max(20),
  parentesco: z.string().max(60),
});

const PessoaAutorizadaInput = ContatoEmergenciaInput.extend({ cpf: z.string().max(14) });

const SaudeInput = z.object({
  contatosEmergencia: z.array(ContatoEmergenciaInput).max(10),
  alergia: RespostaSaudeInput,
  problemaSaude: RespostaSaudeInput,
  medicamentoContinuo: RespostaSaudeInput,
  planoSaude: RespostaSaudeInput,
  pessoasAutorizadas: z.array(PessoaAutorizadaInput).max(10),
  corRaca: z.string(),
  outrasInformacoes: z.string(),
});

const CHAVES_DOCUMENTO = DOCUMENTOS_MATRICULA.map((d) => d.chave);

const DocumentoChaveInput = z.enum(CHAVES_DOCUMENTO as [DocumentoChave, ...DocumentoChave[]]);

const ArquivoInput = z.object({
  path: z.string(),
  nome: z.string(),
  tipo: z.string(),
  tamanho: z.number(),
});

const DocumentosMatriculaInput = z.record(DocumentoChaveInput, ArquivoInput);

const EnviarInput = z.object({
  captchaToken: z.string(),
  rotina: RotinaInput,
  saude: SaudeInput,
  documentos: DocumentosMatriculaInput,
  form: z.object({
    unidade: z.string(),
    aluno: z.object({
      nome: z.string(),
      cpf: z.string(),
      dataNascimento: z.string(),
      naturalidade: z.string(),
    }),
    endereco: EnderecoInput,
    pai: ResponsavelInput,
    mae: ResponsavelInput,
    responsavelFinanceiro: z.enum(["pai", "mae"]),
  }),
});

export interface EnviarMatriculaPublicaResult {
  ok: boolean;
  // Mensagens por campo, quando a validação do servidor recusa o formulário.
  erros?: Record<string, string>;
  erro?: string;
  protocolo?: string;
}

function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// ─── URL de upload dos documentos ───────────────────────────────────────────
//
// A página é pública, então o servidor não entrega acesso ao bucket: ele emite
// uma URL ASSINADA de uso único para um caminho aleatório. O bucket é privado e
// limita tamanho e tipo de arquivo, e o pedido é contado por IP (hash) para o
// endpoint não virar depósito de arquivos.

const MAX_UPLOADS_POR_IP = 40;

export interface UrlUploadDocumento {
  ok: boolean;
  path?: string;
  token?: string;
  erro?: string;
}

const UploadInput = z.object({ documento: DocumentoChaveInput, tipo: z.string() });

async function uploadsRecentes(ipHash: string, agoraISO: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("matricula_upload_pedidos" as never)
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", inicioJanelaLimite(agoraISO));
  if (error) {
    console.error("[matrículas] falha ao contar uploads do IP:", error.message);
    return 0;
  }
  return count ?? 0;
}

export const urlUploadDocumentoMatricula = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => UploadInput.parse(input))
  .handler(async ({ data }): Promise<UrlUploadDocumento> => {
    if (!TIPOS_DOCUMENTO_ACEITOS.includes(data.tipo))
      return { ok: false, erro: "Envie uma imagem (JPG/PNG) ou um PDF." };

    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const ipHash = ip ? hashIp(ip) : null;
    const agoraISO = new Date().toISOString();

    if (ipHash) {
      if ((await uploadsRecentes(ipHash, agoraISO)) >= MAX_UPLOADS_POR_IP)
        return {
          ok: false,
          erro: "Muitos envios de arquivo em pouco tempo. Tente novamente mais tarde.",
        };
      await supabaseAdmin
        .from("matricula_upload_pedidos" as never)
        .insert({ ip_hash: ipHash, documento: data.documento } as never);
    }

    const path = `pendentes/${randomUUID()}/${data.documento}`;
    const { data: assinado, error } = await supabaseAdmin.storage
      .from(BUCKET_DOCUMENTOS_MATRICULA)
      .createSignedUploadUrl(path);

    if (error || !assinado) {
      console.error("[matrículas] falha ao assinar upload de documento:", error?.message);
      return { ok: false, erro: "Não foi possível enviar o arquivo agora. Tente novamente." };
    }

    return { ok: true, path: assinado.path, token: assinado.token };
  });

// Os documentos entram na submissão só pelo caminho; conferimos que o arquivo
// existe mesmo no bucket antes de gravar a metadata.
async function arquivoExiste(path: string): Promise<boolean> {
  const barra = path.lastIndexOf("/");
  const pasta = barra === -1 ? "" : path.slice(0, barra);
  const nome = path.slice(barra + 1);
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_DOCUMENTOS_MATRICULA)
    .list(pasta, { search: nome });
  if (error) {
    console.error("[matrículas] falha ao conferir documento no bucket:", error.message);
    return false;
  }
  return (data ?? []).some((item) => item.name === nome);
}

async function salvarSaude(
  form: MatriculaForm,
  saude: SaudeForm,
  serie: string,
  submissionId: string,
  alunoId: number | null,
): Promise<void> {
  const { error } = await supabaseAdmin.from("matricula_saude" as never).upsert(
    {
      submission_id: submissionId,
      unidade: form.unidade,
      sponte_aluno_id: alunoId,
      aluno_nome: form.aluno.nome.trim(),
      serie,
      contato_emergencia: textoContatosEmergencia(saude.contatosEmergencia),
      alergia: saude.alergia.opcao,
      alergia_detalhe: saude.alergia.detalhe.trim(),
      problema_saude: saude.problemaSaude.opcao,
      problema_saude_detalhe: saude.problemaSaude.detalhe.trim(),
      medicamento_continuo: saude.medicamentoContinuo.opcao,
      medicamento_continuo_detalhe: saude.medicamentoContinuo.detalhe.trim(),
      plano_saude: saude.planoSaude.opcao,
      plano_saude_detalhe: saude.planoSaude.detalhe.trim(),
      pessoas_autorizadas: textoPessoasAutorizadas(saude.pessoasAutorizadas),
      cor_raca: saude.corRaca,
      outras_informacoes: saude.outrasInformacoes.trim(),
    } as never,
    { onConflict: "submission_id" } as never,
  );
  if (error) console.error("[matrículas] falha ao gravar o questionário de saúde:", error.message);
}

async function salvarDocumentos(
  form: MatriculaForm,
  documentos: DocumentosForm,
  submissionId: string,
  alunoId: number | null,
): Promise<void> {
  const linhas: Record<string, unknown>[] = [];

  for (const documento of DOCUMENTOS_MATRICULA) {
    const arquivo = documentos[documento.chave];
    if (!arquivo) continue;
    if (!arquivo.path.startsWith("pendentes/")) continue;
    if (!(await arquivoExiste(arquivo.path))) continue;
    linhas.push({
      submission_id: submissionId,
      unidade: form.unidade,
      sponte_aluno_id: alunoId,
      documento: documento.chave,
      storage_path: arquivo.path,
      nome_arquivo: arquivo.nome.slice(0, 200),
      tipo_arquivo: arquivo.tipo,
      tamanho_bytes: arquivo.tamanho,
    });
  }

  if (linhas.length === 0) return;

  const { error } = await supabaseAdmin
    .from("matricula_documentos" as never)
    .upsert(linhas as never, { onConflict: "submission_id,documento" } as never);
  if (error) console.error("[matrículas] falha ao gravar os documentos:", error.message);
}

// A rotina é gravada DEPOIS da matrícula, já com o AlunoID do Sponte. O upsert
// por submission_id mantém o reenvio idempotente, igual à matrícula em si.
async function salvarRotina(
  form: MatriculaForm,
  rotina: RotinaForm,
  serie: string,
  submissionId: string,
  alunoId: number | null,
): Promise<void> {
  const dados = montarRotinaPersistida(rotina, serie);
  const { error } = await supabaseAdmin.from("student_routine" as never).upsert(
    {
      submission_id: submissionId,
      unidade: form.unidade,
      sponte_aluno_id: alunoId,
      aluno_nome: form.aluno.nome.trim(),
      serie,
      origem: "matricula",
      data_inicio: dados.dataInicio,
      dias_ativos: dados.diasAtivos,
      periodo_manha: dados.periodoManha,
      periodo_tarde: dados.periodoTarde,
      horario_estendido: dados.horarioEstendido,
      horarios: dados.horarios,
      sem_refeicoes: dados.semRefeicoes,
      refeicoes: dados.refeicoes,
    } as never,
    { onConflict: "submission_id" } as never,
  );
  // A matrícula já está no Sponte: falhar aqui não pode desfazer nada nem
  // esconder o sucesso do responsável — fica o registro para a secretaria.
  if (error) console.error("[matrículas] falha ao gravar a rotina escolar:", error.message);
}

export const enviarMatriculaPublica = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => EnviarInput.parse(input))
  .handler(async ({ data }): Promise<EnviarMatriculaPublicaResult> => {
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const ipHash = ip ? hashIp(ip) : null;
    const agoraISO = new Date().toISOString();

    if (!process.env.TURNSTILE_SECRET_KEY) {
      console.error("[matrículas] TURNSTILE_SECRET_KEY ausente — formulário público desativado.");
      return {
        ok: false,
        erro: "O formulário está temporariamente indisponível. Fale com a secretaria do colégio.",
      };
    }

    if (!(await captchaValido(data.captchaToken, ip))) {
      return {
        ok: false,
        erro: "Não foi possível confirmar a verificação de segurança. Recarregue a página e tente novamente.",
      };
    }

    if (ipHash && excedeuLimitePorIp(await submissoesRecentes(ipHash, agoraISO))) {
      return {
        ok: false,
        erro: `Limite de ${MAX_SUBMISSOES_POR_IP} envios por hora atingido. Tente novamente mais tarde ou fale com a secretaria.`,
      };
    }

    // Mesma validação da tela, agora do lado do servidor (a tela pode ser
    // burlada; o Sponte não pode receber lixo).
    const form = padronizarMatriculaForm(data.form as MatriculaForm);
    const rotina = data.rotina as RotinaForm;
    const saude = padronizarSaudeForm(data.saude as SaudeForm);
    const documentos = data.documentos as DocumentosForm;
    const serie = serieCalculada(form.aluno.dataNascimento);
    const erros = {
      ...validarMatriculaForm(form, hojeSaoPaulo(), UNIDADES_SPONTE),
      ...validarRotinaForm(rotina, serie),
      ...validarSaudeForm(saude),
      ...validarDocumentosForm(documentos, serie),
    };
    if (Object.keys(erros).length > 0) {
      return { ok: false, erros, erro: "Confira os campos destacados." };
    }

    const submissionId = `site-${randomUUID()}`;
    const payload = montarPayloadMatricula(form, submissionId);

    const saida = await receberMatricula(payload, { origem: ORIGEM_SITE, ipHash });

    if (saida.ok) {
      const alunoId = saida.alunoId ?? null;
      await salvarRotina(form, rotina, serie, submissionId, alunoId);
      await salvarSaude(form, saude, serie, submissionId, alunoId);
      await salvarDocumentos(form, documentos, submissionId, alunoId);
      return { ok: true, protocolo: submissionId };
    }

    if (saida.status === "duplicado") {
      return {
        ok: false,
        erro: "Este aluno já consta como matriculado no sistema do colégio. Fale com a secretaria.",
      };
    }

    return {
      ok: false,
      erro: "Recebemos os dados, mas houve uma falha ao concluir o cadastro. A secretaria já foi notificada e vai entrar em contato.",
    };
  });
