// Aviso "Enviar boleto de matrícula": um por contrato, criado na transição do
// documento ZapSign para "signed" e removido quando o contrato é cancelado.
// Usado só pelo servidor (aplicarEstadoDocumento e as server functions do sino).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const T_BOLETO_AVISOS = "contratos_boleto_avisos" as never;
export const T_BOLETO_DESTINATARIOS = "contratos_boleto_destinatarios" as never;
const T_CONTRATOS = "contratos_matricula" as never;
const LOG = "[contrato-boleto-aviso]";

/**
 * Gera o aviso para o contrato de matrícula (status "enviado") vinculado ao
 * documento. Idempotente: a unicidade por contrato é garantida no banco, então
 * webhook repetido ou "Sincronizar" concorrente não duplicam. Falha não
 * interrompe o processamento do webhook.
 */
export async function gerarAvisoBoletoMatricula(
  documentoId: string,
  assinadoEm: string,
): Promise<void> {
  const { data: contrato, error } = await supabaseAdmin
    .from(T_CONTRATOS)
    .select("id, status")
    .eq("zapsign_documento_id", documentoId)
    .maybeSingle<{ id: string; status: string }>();
  if (error) {
    console.error(`${LOG} contrato do documento ${documentoId}: ${error.message}`);
    return;
  }
  if (!contrato || contrato.status !== "enviado") return;

  const { error: eInsert } = await supabaseAdmin
    .from(T_BOLETO_AVISOS)
    .upsert({ contrato_id: contrato.id, assinado_em: assinadoEm } as never, {
      onConflict: "contrato_id",
      ignoreDuplicates: true,
    });
  if (eInsert) console.error(`${LOG} gerar (${contrato.id}): ${eInsert.message}`);
}

/** Contrato cancelado: o aviso deixa de fazer sentido e é removido. */
export async function removerAvisoBoletoMatricula(documentoId: string): Promise<void> {
  const { data: contratos, error } = await supabaseAdmin
    .from(T_CONTRATOS)
    .select("id")
    .eq("zapsign_documento_id", documentoId)
    .returns<{ id: string }[]>();
  if (error || !contratos?.length) return;
  const { error: eDelete } = await supabaseAdmin
    .from(T_BOLETO_AVISOS)
    .delete()
    .in(
      "contrato_id",
      contratos.map((c) => c.id),
    );
  if (eDelete) console.error(`${LOG} remover: ${eDelete.message}`);
}

export async function ehDestinatarioBoleto(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from(T_BOLETO_DESTINATARIOS)
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle<{ user_id: string }>();
  return Boolean(data);
}
