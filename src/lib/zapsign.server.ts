// Cliente server-side da API ZapSign — PROVA DE CONCEITO em SANDBOX.
//
// O token (ZAPSIGN_SANDBOX_TOKEN) é lido só aqui, do ambiente do servidor, e
// vai no header `Authorization: Bearer`. Nada deste módulo pode ser importado
// pelo navegador. O host é fixo no sandbox: documentos criados aqui não têm
// validade jurídica e a troca para produção é uma decisão explícita futura.
//
// Documentação usada: docs.zapsign.com.br (criar documento via PDF em base64,
// criar documento via modelo DOCX, criar modelo DOCX, detalhar documento,
// criar webhook).

import { createHash } from "node:crypto";

export const ZAPSIGN_SANDBOX_BASE = "https://sandbox.api.zapsign.com.br/api/v1";

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

export function zapsignConfigurado(): boolean {
  return Boolean(process.env.ZAPSIGN_SANDBOX_TOKEN);
}

/**
 * Segredo do callback derivado do token da API (SHA-256), para a ZapSign
 * enviar em header customizado e o School Hub validar a origem — sem criar
 * outra variável de ambiente e sem o token cru sair do servidor.
 */
export function zapsignWebhookSegredo(): string | null {
  const token = process.env.ZAPSIGN_SANDBOX_TOKEN;
  if (!token) return null;
  return createHash("sha256").update(`school-hub-zapsign-webhook:${token}`).digest("hex");
}

async function zapsignFetch<T>(
  caminho: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<ZapSignResultado<T>> {
  const token = process.env.ZAPSIGN_SANDBOX_TOKEN;
  if (!token) {
    return { ok: false, status: 503, erro: "ZAPSIGN_SANDBOX_TOKEN não configurada no servidor." };
  }
  const url = `${ZAPSIGN_SANDBOX_BASE}${caminho}`;
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
): Record<string, unknown> {
  const tel = telefoneParaZapSign(s.telefone);
  const cpf = somenteDigitos(s.cpf);
  const signer: Record<string, unknown> = {
    name: s.nome,
    email: s.email ?? "",
    ...tel,
    auth_mode: "assinaturaTela",
    // Envio automático desligado: na POC o link é copiado da tela.
    send_automatic_email: false,
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
  nome: string;
  pdfBase64: string;
  signatarios: ZapSignSignatarioInput[];
  externalId: string;
  ordemSequencial: boolean;
};

export async function criarDocumentoPdf(
  input: CriarDocPdfInput,
): Promise<ZapSignResultado<ZapSignDocResposta>> {
  return zapsignFetch<ZapSignDocResposta>("/docs/", {
    method: "POST",
    body: {
      name: input.nome,
      base64_pdf: input.pdfBase64,
      lang: "pt-br",
      disable_signer_emails: true,
      signature_order_active: input.ordemSequencial,
      external_id: input.externalId,
      folder_path: "/school-hub-poc/",
      signers: input.signatarios.map((s) => montarSigner(s, input.ordemSequencial)),
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
  return zapsignFetch<ZapSignTemplateResposta>("/templates/create", {
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
  return zapsignFetch<ZapSignDocResposta>("/models/create-doc/", {
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
): Promise<ZapSignResultado<ZapSignDocResposta>> {
  return zapsignFetch<ZapSignDocResposta>(`/docs/${encodeURIComponent(docToken)}/`, {
    method: "GET",
  });
}

export async function criarWebhook(url: string): Promise<ZapSignResultado<ZapSignWebhookResposta>> {
  const segredo = zapsignWebhookSegredo();
  if (!segredo) {
    return { ok: false, status: 503, erro: "ZAPSIGN_SANDBOX_TOKEN não configurada no servidor." };
  }
  return zapsignFetch<ZapSignWebhookResposta>("/user/company/webhook/", {
    method: "POST",
    body: {
      url,
      // "" = todos os eventos (exceto email_bounce, que a ZapSign trata à parte).
      type: "",
      headers: [{ name: "X-School-Hub-Signature", value: segredo }],
    },
  });
}
