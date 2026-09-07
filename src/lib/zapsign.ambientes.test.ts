import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { ambienteDaAssinatura } from "@/lib/zapsign.api";
import {
  ZAPSIGN_PROD_BASE,
  ZAPSIGN_AUTH_MODE,
  ZAPSIGN_SANDBOX_BASE,
  criarDocumentoPdf,
  montarSigner,
  recusarDocumento,
  zapsignConfigurado,
  zapsignWebhookSegredo,
} from "@/lib/zapsign.server";

const docInput = {
  nome: "Contrato",
  pdfBase64: "AAAA",
  signatarios: [{ nome: "Fulano", email: "f@x.com", cpf: "123.456.789-00" }],
  externalId: "ext-1",
  ordemSequencial: false,
};

describe("ZapSign — separação sandbox × produção", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.ZAPSIGN_SANDBOX_TOKEN = "tok-sandbox";
    process.env.ZAPSIGN_PROD_TOKEN = "tok-prod";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ token: "doc", status: "pending", signers: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZAPSIGN_SANDBOX_TOKEN;
    delete process.env.ZAPSIGN_PROD_TOKEN;
  });

  it("produção usa o host de produção, o ZAPSIGN_PROD_TOKEN, pasta própria e envia o email ao signatário", async () => {
    await criarDocumentoPdf({ ...docInput, ambiente: "producao", enviarEmailAoSignatario: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ZAPSIGN_PROD_BASE}/docs/`);
    expect(url.startsWith(ZAPSIGN_SANDBOX_BASE)).toBe(false);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-prod");
    const body = JSON.parse(String(init.body)) as {
      folder_path: string;
      disable_signer_emails: boolean;
      signers: {
        send_automatic_email: boolean;
        require_document_data: { document_number: string };
      }[];
    };
    expect(body.folder_path).toBe("/school-hub-contratos/");
    expect(body.disable_signer_emails).toBe(false);
    expect(body.signers[0].send_automatic_email).toBe(true);
    expect(body.signers[0].require_document_data.document_number).toBe("12345678900");
  });

  it("todo signatário exige código por email além da assinatura na tela, com email e telefone travados", async () => {
    expect(ZAPSIGN_AUTH_MODE).toBe("assinaturaTela-tokenEmail");
    const signers = [
      { nome: "Financeiro", email: "fin@x.com", telefone: "(31) 98888-7777", cpf: "1" },
      { nome: "Representante", email: "rep@x.com", telefone: "(31) 97777-6666" },
      { nome: "Testemunha 1", email: "t1@x.com" },
      { nome: "Testemunha 2", email: "t2@x.com", telefone: "" },
    ].map((s) => montarSigner(s, false, true));
    for (const s of signers) {
      expect(s.auth_mode).toBe("assinaturaTela-tokenEmail");
      expect(s.auth_mode).not.toBe("assinaturaTela");
      expect(s.lock_email).toBe(true);
      expect(s.lock_name).toBe(true);
      expect(s.send_automatic_email).toBe(true);
    }
    expect(signers[0].lock_phone).toBe(true);
    expect(signers[2].lock_phone).toBe(false);

    await criarDocumentoPdf({ ...docInput, ambiente: "producao", enviarEmailAoSignatario: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { signers: { auth_mode: string }[] };
    expect(body.signers.map((s) => s.auth_mode)).toEqual(["assinaturaTela-tokenEmail"]);
  });

  it("signatário sem email não vai à ZapSign: o código de verificação não teria para onde ir", async () => {
    const r = await criarDocumentoPdf({
      ...docInput,
      ambiente: "producao",
      signatarios: [
        { nome: "Financeiro", email: "fin@x.com" },
        { nome: "Anna Clara", email: "  " },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("Anna Clara");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem ambiente informado continua no sandbox (POC intacta)", async () => {
    await criarDocumentoPdf(docInput);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ZAPSIGN_SANDBOX_BASE}/docs/`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-sandbox");
    const body = JSON.parse(String(init.body)) as {
      folder_path: string;
      disable_signer_emails: boolean;
      signers: { send_automatic_email: boolean }[];
    };
    expect(body.folder_path).toBe("/school-hub-poc/");
    expect(body.disable_signer_emails).toBe(true);
    expect(body.signers[0].send_automatic_email).toBe(false);
  });

  it("produção sem ZAPSIGN_PROD_TOKEN falha explicitamente — nunca cai no token do sandbox", async () => {
    delete process.env.ZAPSIGN_PROD_TOKEN;
    const r = await criarDocumentoPdf({ ...docInput, ambiente: "producao" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("ZAPSIGN_PROD_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(zapsignConfigurado("producao")).toBe(false);
    expect(zapsignConfigurado("sandbox")).toBe(true);
  });

  it("cancelamento usa POST /refuse/ (nunca DELETE) com doc_token, rejected_reason, notify_signer e User-Agent", async () => {
    await recusarDocumento({
      ambiente: "producao",
      docToken: "tok-doc",
      motivo: "Valor errado",
      notificarSignatarios: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ZAPSIGN_PROD_BASE}/refuse/`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-prod");
    expect(headers["User-Agent"]).toBe("School Hub");
    expect(JSON.parse(String(init.body))).toEqual({
      doc_token: "tok-doc",
      rejected_reason: "Valor errado",
      notify_signer: false,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "t2", status: "refused" }), { status: 200 }),
    );
    await recusarDocumento({ docToken: "t2", motivo: "Teste", notificarSignatarios: true });
    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe(`${ZAPSIGN_SANDBOX_BASE}/refuse/`);
    expect((init2.headers as Record<string, string>).Authorization).toBe("Bearer tok-sandbox");
    expect(JSON.parse(String(init2.body)).notify_signer).toBe(true);
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit).method === "DELETE")).toBe(
      false,
    );
  });

  it("segredo do webhook difere por ambiente e identifica a origem do callback", () => {
    const prod = zapsignWebhookSegredo("producao");
    const sandbox = zapsignWebhookSegredo("sandbox");
    expect(prod).not.toBe(sandbox);
    const segredos = { producao: prod, sandbox };
    expect(ambienteDaAssinatura(prod ?? "", segredos)).toBe("producao");
    expect(ambienteDaAssinatura(sandbox ?? "", segredos)).toBe("sandbox");
    expect(ambienteDaAssinatura("qualquer-coisa", segredos)).toBe("invalida");
    expect(ambienteDaAssinatura("", segredos)).toBe("invalida");
    expect(ambienteDaAssinatura("x", { producao: null, sandbox: null })).toBeNull();
  });
});
