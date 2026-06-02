import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const APP_MODULES = ["admissoes", "onboarding", "rh", "financeiro", "configuracoes"] as const;

const permissionSchema = z.object({
  module: z.enum(APP_MODULES),
  can_view: z.boolean(),
  can_edit: z.boolean(),
});

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles" as any)
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const isAdmin = (data ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Apenas administradores podem executar essa ação.");
}

// Persist the role flag (admin vs viewer) and the per-module permission matrix.
async function persistAccess(
  userId: string,
  isAdmin: boolean,
  permissions: { module: string; can_view: boolean; can_edit: boolean }[],
) {
  // Roles: keep a single row per user reflecting admin vs viewer.
  await supabaseAdmin
    .from("user_roles" as any)
    .delete()
    .eq("user_id", userId);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles" as any)
    .insert({ user_id: userId, role: isAdmin ? "admin" : "viewer" });
  if (roleErr) throw new Error(roleErr.message);

  // Permissions matrix. Admins get everything implicitly via has_role, but we
  // still store the explicit grid so the UI round-trips correctly.
  const rows = permissions.map((p) => ({
    user_id: userId,
    module: p.module,
    // edit implies view
    can_view: p.can_view || p.can_edit,
    can_edit: p.can_edit,
  }));
  const { error: permErr } = await supabaseAdmin
    .from("user_permissions" as any)
    .upsert(rows, { onConflict: "user_id,module" });
  if (permErr) throw new Error(permErr.message);
}

export const listManagedUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: usersResp, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles" as any).select("user_id, role");
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    const { data: perms } = await supabaseAdmin
      .from("user_permissions" as any)
      .select("user_id, module, can_view, can_edit");
    const permMap = new Map<string, { module: string; can_view: boolean; can_edit: boolean }[]>();
    (perms ?? []).forEach((p: any) => {
      const arr = permMap.get(p.user_id) ?? [];
      arr.push({ module: p.module, can_view: p.can_view, can_edit: p.can_edit });
      permMap.set(p.user_id, arr);
    });
    return usersResp.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      roles: roleMap.get(u.id) ?? [],
      permissions: permMap.get(u.id) ?? [],
    }));
  });

export const createManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        password: z.string().min(6).max(72),
        isAdmin: z.boolean().default(false),
        permissions: z.array(permissionSchema).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("Falha ao criar usuário.");
    await persistAccess(userId, data.isAdmin, data.permissions);
    return { id: userId, email: data.email };
  });

export const updateUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        isAdmin: z.boolean().default(false),
        permissions: z.array(permissionSchema).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && !data.isAdmin) {
      throw new Error("Você não pode remover o próprio acesso de administrador.");
    }
    await persistAccess(data.userId, data.isAdmin, data.permissions);
    return { ok: true };
  });

export const deleteManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) {
      throw new Error("Você não pode excluir o próprio usuário.");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
