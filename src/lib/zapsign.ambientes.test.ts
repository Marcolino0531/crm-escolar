import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { ambienteDaAssinatura } from "@/lib/zapsign.api";
import {
  ZAPSIGN_PROD_BASE,
  ZAPSIGN_SANDBOX_BASE,
  criarDocumentoPdf,
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
