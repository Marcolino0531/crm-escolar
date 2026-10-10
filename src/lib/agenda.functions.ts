import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exigirPermissaoPagina } from "@/lib/permissoes-servidor";

export type AgendaUser = {
  id: string;
  name: string;
  email: string;
};

async function assertCanEditAgenda(userId: string) {
  await exigirPermissaoPagina(
    userId,
    ["agenda.mes", "agenda.semana"],
    "editar",
    "Você não tem permissão para editar a Agenda.",
  );
}

// Lista os usuários do sistema para o seletor de "Equipe" da reunião. Requer
// permissão de edição da Agenda (usa o service role só para ler auth.users).
export const listAgendaUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgendaUser[]> => {
    // escopo-unidade: diretório de usuários, sem dado de colégio
    await assertCanEditAgenda(context.userId);
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    return data.users
      .map((u) => {
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
        const name =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          "";
        return { id: u.id, name, email: u.email ?? "" };
      })
      .sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email, "pt-BR", { sensitivity: "base" }),
      );
  });
