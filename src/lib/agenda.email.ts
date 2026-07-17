// Envio de email (server-only) via Resend, usado no lembrete matinal de reuniões
// da Agenda. Sem SDK: chamada HTTP direta para o endpoint da Resend, no mesmo
// padrão das demais integrações do projeto. NUNCA logar a API key.

export type ResendConfig = {
  apiKey: string;
  from: string;
};

export function getResendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export type EmailInput = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(cfg: ResendConfig, input: EmailInput): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    // Não inclui headers/credenciais — apenas o corpo de erro da Resend.
    throw new Error(`Resend HTTP ${res.status}: ${bodyText}`);
  }

  let parsed: { id?: string } = {};
  try {
    parsed = JSON.parse(bodyText) as { id?: string };
  } catch {
    parsed = {};
  }
  return { id: parsed.id ?? "" };
}
