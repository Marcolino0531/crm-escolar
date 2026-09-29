// Checagem de permissão no servidor pela chave da PÁGINA da árvore
// (src/lib/permissoes-arvore.ts). Leitura exige Visualizar; gravação exige Editar.
// Quando uma função atende mais de uma página, basta a permissão de QUALQUER
// uma das chaves informadas (a lista do PR de casos compartilhados vive nos
// próprios chamadores).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ehChaveGravavel, type ChavePermissao } from "@/lib/permissoes-arvore";

export type ModoPermissao = "ver" | "editar";

/** true se o usuário tem a permissão em pelo menos uma das chaves. */
export async function temPermissaoPagina(
  userId: string,
  chaves: readonly ChavePermissao[],
  modo: ModoPermissao,
): Promise<boolean> {
  for (const chave of chaves) {
    if (!ehChaveGravavel(chave))
      throw new Error(`Chave de permissão não é folha da árvore: ${chave}`);
  }
  const fn = modo === "editar" ? "can_edit_pagina" : "can_view_pagina";
  const resultados = await Promise.all(
    chaves.map((chave) =>
      supabaseAdmin.rpc(fn as never, { _user_id: userId, _chave: chave } as never),
    ),
  );
  for (const r of resultados) {
    if (r.error) throw new Error(r.error.message);
  }
  return resultados.some((r) => !!r.data);
}

/** Lança `mensagem` quando o usuário não tem a permissão em nenhuma das chaves. */
export async function exigirPermissaoPagina(
  userId: string,
  chaves: readonly ChavePermissao[],
  modo: ModoPermissao,
  mensagem: string,
): Promise<void> {
  if (!(await temPermissaoPagina(userId, chaves, modo))) throw new Error(mensagem);
}
