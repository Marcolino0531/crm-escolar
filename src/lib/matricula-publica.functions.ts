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
  MAX_SUBMISSOES_POR_IP,
  ORIGEM_SITE,
  excedeuLimitePorIp,
  inicioJanelaLimite,
  montarPayloadMatricula,
  validarMatriculaForm,
  type MatriculaForm,
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

const EnviarInput = z.object({
  captchaToken: z.string(),
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
    const form = data.form as MatriculaForm;
    const erros = validarMatriculaForm(form, hojeSaoPaulo(), UNIDADES_SPONTE);
    if (Object.keys(erros).length > 0) {
      return { ok: false, erros, erro: "Confira os campos destacados." };
    }

    const submissionId = `site-${randomUUID()}`;
    const payload = montarPayloadMatricula(form, submissionId);

    const saida = await receberMatricula(payload, { origem: ORIGEM_SITE, ipHash });

    if (saida.ok) return { ok: true, protocolo: submissionId };

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
