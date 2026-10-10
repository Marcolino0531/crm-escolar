// Escopo por colégio no servidor. As server functions usam supabaseAdmin, que
// ignora as policies: a checagem de colégio tem de estar no código, SEMPRE
// somada à permissão de página (uma não substitui a outra).
// Fonte única: allowedSponteUnidades (nomes dos colégios liberados; null = admin).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { allowedSponteUnidades } from "@/lib/sponte.functions";
import {
  colegiosDaConversa,
  grupoDaConversa,
  unidadesDoGrupo,
  type ConversaRoteavel,
} from "@/lib/whatsapp-numeros";

export const MENSAGEM_SEM_UNIDADE = "Sem permissão para esta unidade.";

/** Regra pura: admin (null) passa; vazio/nulo recusa; senão precisa estar na lista. */
export function unidadeLiberada(
  permitidas: readonly string[] | null,
  unidade: string | null | undefined,
): boolean {
  if (permitidas === null) return true;
  const nome = (unidade ?? "").trim();
  return nome !== "" && permitidas.includes(nome);
}

/** Nomes dos colégios liberados ao usuário; null = admin (todos). */
export async function unidadesDoUsuario(userId: string): Promise<string[] | null> {
  return allowedSponteUnidades(userId);
}

export async function exigirUnidadeDoUsuario(
  userId: string,
  unidade: string | null | undefined,
): Promise<void> {
  if (!unidadeLiberada(await unidadesDoUsuario(userId), unidade)) {
    throw new Error(MENSAGEM_SEM_UNIDADE);
  }
}

export async function exigirEscolaDoUsuario(
  userId: string,
  schoolId: string | null | undefined,
): Promise<void> {
  const permitidas = await unidadesDoUsuario(userId);
  if (permitidas === null) return;
  if (!schoolId) throw new Error(MENSAGEM_SEM_UNIDADE);
  const { data } = await supabaseAdmin
    .from("schools" as never)
    .select("name")
    .eq("id", schoolId)
    .maybeSingle<{ name: string }>();
  if (!unidadeLiberada(permitidas, data?.name)) throw new Error(MENSAGEM_SEM_UNIDADE);
}

// Mesma regra de public.can_access_conversa: colégios da conversa (unidades +
// unidade, só nomes válidos); sem colégio válido, os colégios do grupo do número.
export function conversaLiberada(
  permitidas: readonly string[] | null,
  conversa: ConversaRoteavel,
): boolean {
  if (permitidas === null) return true;
  const colegios = colegiosDaConversa(conversa);
  const alvo = colegios.length > 0 ? colegios : unidadesDoGrupo(grupoDaConversa(conversa));
  return alvo.some((c) => permitidas.includes(c));
}

export async function exigirConversaDoUsuario(
  userId: string,
  conversa: ConversaRoteavel,
): Promise<void> {
  if (!conversaLiberada(await unidadesDoUsuario(userId), conversa)) {
    throw new Error(MENSAGEM_SEM_UNIDADE);
  }
}

// Conversa inexistente: só admin passa.
export async function exigirConversaIdDoUsuario(
  userId: string,
  conversationId: string | null | undefined,
): Promise<void> {
  const permitidas = await unidadesDoUsuario(userId);
  if (permitidas === null) return;
  if (!conversationId) throw new Error(MENSAGEM_SEM_UNIDADE);
  const { data } = await supabaseAdmin
    .from("whatsapp_conversations" as never)
    .select("unidade, unidades, numero_grupo")
    .eq("id", conversationId)
    .maybeSingle<ConversaRoteavel>();
  if (!data || !conversaLiberada(permitidas, data)) throw new Error(MENSAGEM_SEM_UNIDADE);
}
