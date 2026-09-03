// Persistência dos documentos ZapSign de teste (sandbox) e dos callbacks.
// Usado pelas server functions (criação/sincronização) e pela rota do webhook.
// O estado gravado é sempre o que a ZapSign informou por último — nunca uma
// suposição local — e o callback é idempotente pelo hash do payload.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ZapSignDocResposta, ZapSignSignerResposta } from "@/lib/zapsign.server";

// Tabelas novas ainda fora do `Database` gerado — mesma convenção das demais
// tabelas recentes (`from(... as never)` + resultado tipado no `.maybeSingle<T>()`).
export const T_DOCS = "zapsign_documentos" as never;
export const T_EVENTOS = "zapsign_eventos" as never;
export const T_WEBHOOKS = "zapsign_webhooks" as never;

export type SignatarioPersistido = {
  token: string | null;
  nome: string;
  email: string;
  telefone: string;
  cpf: string;
  status: string;
  sign_url: string | null;
  signed_at: string | null;
  times_viewed: number;
};

export function signatarioDoSigner(s: ZapSignSignerResposta, cpf: string): SignatarioPersistido {
  return {
    token: s.token ?? null,
    nome: s.name,
    email: s.email ?? "",
    telefone: s.phone_number ? `${s.phone_country ?? ""}${s.phone_number}` : "",
    cpf,
    status: s.status,
    sign_url: s.sign_url ?? null,
    signed_at: s.signed_at ?? null,
    times_viewed: s.times_viewed ?? 0,
  };
}

function primeiraAssinaturaCompleta(doc: { status: string; signers?: ZapSignSignerResposta[] }) {
  if (doc.status !== "signed") return null;
  const datas = (doc.signers ?? [])
    .map((s) => s.signed_at)
    .filter((d): d is string => Boolean(d))
    .sort();
  return datas.at(-1) ?? new Date().toISOString();
}

/**
 * Atualiza status/signatários do documento local a partir de uma resposta da
 * ZapSign (detalhe ou callback). Preserva o CPF informado na criação, pois a
 * API não o devolve.
 */
export async function aplicarEstadoDocumento(
  zapsignToken: string,
  doc: ZapSignDocResposta,
): Promise<{ documentoId: string | null }> {
  const { data: atual } = await supabaseAdmin
    .from(T_DOCS)
    .select("id, signatarios, assinado_em")
    .eq("zapsign_token", zapsignToken)
    .maybeSingle<{
      id: string;
      signatarios: SignatarioPersistido[] | null;
      assinado_em: string | null;
    }>();
  if (!atual) return { documentoId: null };

  const anteriores = Array.isArray(atual.signatarios) ? atual.signatarios : [];
  const signatarios = (doc.signers ?? []).map((s) => {
    const antes =
      anteriores.find((a) => a.token === s.token) ?? anteriores.find((a) => a.nome === s.name);
    return signatarioDoSigner(s, antes?.cpf ?? "");
  });

  const assinadoEm = atual.assinado_em ?? primeiraAssinaturaCompleta(doc);

  await supabaseAdmin
    .from(T_DOCS)
    .update({
      status: doc.status,
      signatarios: signatarios.length ? signatarios : anteriores,
      assinado_em: assinadoEm,
      ultima_atualizacao_em: doc.last_update_at ?? new Date().toISOString(),
      zapsign_open_id: doc.open_id ?? null,
    } as never)
    .eq("id", atual.id);
  return { documentoId: atual.id };
}

export type CallbackZapSign = {
  event_type?: string;
  sandbox?: boolean;
  token?: string;
  status?: string;
} & Partial<ZapSignDocResposta>;

export type ResultadoCallback = {
  duplicado: boolean;
  documentoId: string | null;
  eventType: string;
};

/** Registra o callback (idempotente) e aplica o estado quando for de documento conhecido. */
export async function registrarCallback(payload: CallbackZapSign): Promise<ResultadoCallback> {
  const bruto = JSON.stringify(payload);
  const hash = createHash("sha256").update(bruto).digest("hex");
  const eventType = typeof payload.event_type === "string" ? payload.event_type : "";
  const token = typeof payload.token === "string" ? payload.token : null;

  let documentoId: string | null = null;
  if (token && typeof payload.status === "string" && Array.isArray(payload.signers)) {
    const r = await aplicarEstadoDocumento(token, payload as ZapSignDocResposta);
    documentoId = r.documentoId;
  } else if (token) {
    const { data } = await supabaseAdmin
      .from(T_DOCS)
      .select("id")
      .eq("zapsign_token", token)
      .maybeSingle<{ id: string }>();
    documentoId = data?.id ?? null;
  }

  const { error } = await supabaseAdmin.from(T_EVENTOS).insert({
    documento_id: documentoId,
    zapsign_token: token,
    event_type: eventType,
    status_documento: typeof payload.status === "string" ? payload.status : null,
    sandbox: typeof payload.sandbox === "boolean" ? payload.sandbox : null,
    payload,
    payload_hash: hash,
  } as never);
  if (error) {
    if (error.code === "23505") return { duplicado: true, documentoId, eventType };
    throw new Error(`Falha ao gravar evento ZapSign: ${error.message}`);
  }
  return { duplicado: false, documentoId, eventType };
}
