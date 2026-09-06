// Cliente server-side da API ZapSign, com dois ambientes ISOLADOS:
//   - "sandbox"  → ZAPSIGN_SANDBOX_TOKEN, host sandbox (POC da aba de teste,
//                  sem validade jurídica);
//   - "producao" → ZAPSIGN_PROD_TOKEN, host de produção (Contrato de
//                  Matrícula real, com validade jurídica).
// O ambiente é sempre um parâmetro EXPLÍCITO de quem chama (default sandbox);
// nunca há fallback de um token para o outro. Os tokens são lidos só aqui, do
// servidor, e vão no header `Authorization: Bearer`. Nada deste módulo pode
// ser importado pelo navegador.
//
// Documentação usada: docs.zapsign.com.br (criar documento via PDF em base64,
// criar documento via modelo DOCX, criar modelo DOCX, detalhar documento,
// criar webhook).

import { createHash } from "node:crypto";

export const ZAPSIGN_SANDBOX_BASE = "https://sandbox.api.zapsign.com.br/api/v1";
export const ZAPSIGN_PROD_BASE = "https://api.zapsign.com.br/api/v1";

export type ZapSignAmbiente = "sandbox" | "producao";

export const ZAPSIGN_AMBIENTES: Record<
  ZapSignAmbiente,
  { base: string; envToken: string; pasta: string }
> = {
  sandbox: {
    base: ZAPSIGN_SANDBOX_BASE,
    envToken: "ZAPSIGN_SANDBOX_TOKEN",
    pasta: "/school-hub-poc/",
  },
  producao: {
    base: ZAPSIGN_PROD_BASE,
    envToken: "ZAPSIGN_PROD_TOKEN",
    pasta: "/school-hub-contratos/",
  },
};

function tokenDoAmbiente(ambiente: ZapSignAmbiente): string | undefined {
  return ambiente === "producao"
    ? process.env.ZAPSIGN_PROD_TOKEN
    : process.env.ZAPSIGN_SANDBOX_TOKEN;
}

export type ZapSignSignatarioInput = {
  nome: string;
  email?: string;
  telefone?: string;
  cpf?: string;
  ordem?: number;
};

export type ZapSignSignerResposta = {
  token: string;
  sign_url: string;
  status: string;
  name: string;
  email: string;
  phone_country: string;
  phone_number: string;
  times_viewed: number;
  last_view_at: string | null;
  signed_at: string | null;
};

export type ZapSignDocResposta = {
  token: string;
  open_id?: number;
  status: string;
  name: string;
  external_id?: string | null;
  original_file: string | null;
  signed_file: string | null;
  created_at: string;
  last_update_at: string;
  signers: ZapSignSignerResposta[];
};

export type ZapSignTemplateResposta = {
  token: string;
  name: string;
  template_type?: string;
  inputs?: { variable: string; label?: string; required?: boolean }[];
};

export type ZapSignWebhookResposta = {
  id: number;
  url?: string;
  type?: string;
};

export type ZapSignResultado<T> =
  | { ok: true; dados: T }
  | { ok: false; status: number; erro: string; corpo?: unknown };

export function zapsignConfigurado(ambiente: ZapSignAmbiente = "sandbox"): boolean {
  return Boolean(tokenDoAmbiente(ambiente));
}

/**
 * Segredo do callback derivado do token da API (SHA-256), para a ZapSign
 * enviar em header customizado e o School Hub validar a origem — sem criar
 * outra variável de ambiente e sem o token cru sair do servidor. Como o token
 * difere por ambiente, o segredo também difere: o webhook sabe de qual
 * ambiente veio o callback pelo segredo que casou.
 */
export function zapsignWebhookSegredo(ambiente: ZapSignAmbiente = "sandbox"): string | null {
  const token = tokenDoAmbiente(ambiente);
  if (!token) return null;
  return createHash("sha256").update(`school-hub-zapsign-webhook:${token}`).digest("hex");
}

async function zapsignFetch<T>(
  ambiente: ZapSignAmbiente,
  caminho: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<ZapSignResultado<T>> {
  const cfg = ZAPSIGN_AMBIENTES[ambiente];
  const token = tokenDoAmbiente(ambiente);
  if (!token) {
    return { ok: false, status: 503, erro: `${cfg.envToken} não configurada no servidor.` };
  }
  const url = `${cfg.base}${caminho}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    return { ok: false, status: 0, erro: `Falha de rede ao chamar a ZapSign: ${String(e)}` };
  }
  const texto = await res.text();
  let corpo: unknown = texto;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    // resposta não-JSON: fica o texto cru para diagnóstico
  }
  if (!res.ok) {
    const detalhe =
      corpo && typeof corpo === "object" && "detail" in corpo
        ? String((corpo as { detail: unknown }).detail)
        : texto.slice(0, 500);
    return { ok: false, status: res.status, erro: `ZapSign HTTP ${res.status}: ${detalhe}`, corpo };
  }
  return { ok: true, dados: corpo as T };
}

function somenteDigitos(v: string | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Telefone BR "(31) 99999-9999" → { phone_country: "55", phone_number: "31999999999" }. */
export function telefoneParaZapSign(telefone: string | undefined): {
  phone_country: string;
  phone_number: string;
} {
  let d = somenteDigitos(telefone);
  if (!d) return { phone_country: "", phone_number: "" };
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return { phone_country: "55", phone_number: d };
}

export function montarSigner(
  s: ZapSignSignatarioInput,
  ordemAtiva: boolean,
  enviarEmail = false,
): Record<string, unknown> {
  const tel = telefoneParaZapSign(s.telefone);
  const cpf = somenteDigitos(s.cpf);
  const signer: Record<string, unknown> = {
    name: s.nome,
    email: s.email ?? "",
    ...tel,
    auth_mode: "assinaturaTela",
    // POC: link copiado da tela. Contrato real: a ZapSign emaila o signatário.
    send_automatic_email: enviarEmail,
    send_automatic_whatsapp: false,
    lock_name: true,
  };
  if (cpf) {
    signer.require_document = true;
    signer.require_document_data = {
      document_country: "br",
      document_type: "national_id",
      document_number: cpf,
    };
  }
  if (ordemAtiva) signer.order_group = s.ordem ?? 1;
  return signer;
}

export type CriarDocPdfInput = {
  ambiente?: ZapSignAmbiente;
  nome: string;
  pdfBase64: string;
  signatarios: ZapSignSignatarioInput[];
  externalId: string;
  ordemSequencial: boolean;
  /** Produção: a ZapSign envia o email de assinatura ao signatário. */
  enviarEmailAoSignatario?: boolean;
};

export async function criarDocumentoPdf(
  input: CriarDocPdfInput,
): Promise<ZapSignResultado<ZapSignDocResposta>> {
  const ambiente = input.ambiente ?? "sandbox";
  const enviarEmail = input.enviarEmailAoSignatario ?? false;
  return zapsignFetch<ZapSignDocResposta>(ambiente, "/docs/", {
    method: "POST",
    body: {
      name: input.nome,
      base64_pdf: input.pdfBase64,
      lang: "pt-br",
      disable_signer_emails: !enviarEmail,
      signature_order_active: input.ordemSequencial,
      external_id: input.externalId,
      folder_path: ZAPSIGN_AMBIENTES[ambiente].pasta,
      signers: input.signatarios.map((s) => montarSigner(s, input.ordemSequencial, enviarEmail)),
    },
  });
}

export type CriarTemplateDocxInput = {
  nome: string;
  docxBase64: string;
};

export async function criarTemplateDocx(
  input: CriarTemplateDocxInput,
): Promise<ZapSignResultado<ZapSignTemplateResposta>> {
  return zapsignFetch<ZapSignTemplateResposta>("sandbox", "/templates/create", {
    method: "POST",
    body: {
      name: input.nome,
      base64_docx: input.docxBase64,
      lang: "pt-br",
      folder_path: "/school-hub-poc/",
      first_signer: {
        blank_email: false,
        blank_phone: true,
        auth_mode: "assinaturaTela",
        require_selfie_photo: false,
        require_document_photo: false,
        selfie_validation_type: "",
      },
    },
  });
}

export type CriarDocTemplateInput = {
  templateToken: string;
  signatario: ZapSignSignatarioInput;
  campos: { de: string; para: string }[];
  externalId: string;
};

export async function criarDocumentoViaTemplate(
  input: CriarDocTemplateInput,
): Promise<ZapSignResultado<ZapSignDocResposta>> {
  const tel = telefoneParaZapSign(input.signatario.telefone);
  return zapsignFetch<ZapSignDocResposta>("sandbox", "/models/create-doc/", {
    method: "POST",
    body: {
      template_id: input.templateToken,
      signer_name: input.signatario.nome,
      signer_email: input.signatario.email ?? "",
      signer_phone_country: tel.phone_country,
      signer_phone_number: tel.phone_number,
      lang: "pt-br",
      disable_signer_emails: true,
      send_automatic_email: false,
      send_automatic_whatsapp: false,
      external_id: input.externalId,
      folder_path: "/school-hub-poc/",
      data: input.campos,
    },
  });
}

export async function detalharDocumento(
  docToken: string,
  ambiente: ZapSignAmbiente = "sandbox",
): Promise<ZapSignResultado<ZapSignDocResposta>> {
  return zapsignFetch<ZapSignDocResposta>(ambiente, `/docs/${encodeURIComponent(docToken)}/`, {
    method: "GET",
  });
}

export async function criarWebhook(
  url: string,
  ambiente: ZapSignAmbiente = "sandbox",
): Promise<ZapSignResultado<ZapSignWebhookResposta>> {
  const segredo = zapsignWebhookSegredo(ambiente);
  if (!segredo) {
    return {
      ok: false,
      status: 503,
      erro: `${ZAPSIGN_AMBIENTES[ambiente].envToken} não configurada no servidor.`,
    };
  }
  return zapsignFetch<ZapSignWebhookResposta>(ambiente, "/user/company/webhook/", {
    method: "POST",
    body: {
      url,
      // "" = todos os eventos (exceto email_bounce, que a ZapSign trata à parte).
      type: "",
      headers: [{ name: "X-School-Hub-Signature", value: segredo }],
    },
  });
}
