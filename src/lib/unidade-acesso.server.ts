// Escopo por colégio no servidor. As server functions usam supabaseAdmin, que
// ignora as policies: a checagem de colégio tem de estar no código, SEMPRE
// somada à permissão de página (uma não substitui a outra).
// Fonte única: allowedSponteUnidades (nomes dos colégios liberados; null = admin).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { allowedSponteUnidades } from "@/lib/sponte.functions";

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
