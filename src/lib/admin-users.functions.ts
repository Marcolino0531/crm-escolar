import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const APP_MODULES = [
  "dashboard",
  "agenda",
  "admissoes",
  "onboarding",
  "rh",
  "tasks",
  "uniformes",
  "estoque_material",
  "diario",
  "colonia",
  "colonia_financeiro",
  "esportes",
  "documentos",
  "financeiro",
  "configuracoes",
  // Financeiro sub-tabs (granular access)
  "financeiro_dashboard",
  "financeiro_upload",
  "financeiro_conciliacao",
  "financeiro_fluxo",
  "financeiro_inadimplencia",
  "financeiro_cobranca",
  "financeiro_atendimento",
  "financeiro_atendimento_ia",
  "financeiro_cartao",
  "financeiro_fundos",
] as const;

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

// Persist the set of schools (units) a user may access. Fail-closed: a non-admin
// with no rows has access to nothing (callers require >= 1 unit for non-admins).
async function persistSchools(userId: string, schoolIds: string[]) {
  await supabaseAdmin
    .from("user_schools" as any)
    .delete()
    .eq("user_id", userId);
  const unique = Array.from(new Set(schoolIds));
  if (unique.length === 0) return;
  const rows = unique.map((school_id) => ({ user_id: userId, school_id }));
  const { error } = await supabaseAdmin.from("user_schools" as any).insert(rows);
  if (error) throw new Error(error.message);
}

// Persist the extracurricular modalities a user may see. Empty = unrestricted
// (an internal user sees every modality); one or more rows turn the user into a
// PARTNER, restricted to those modalities and blocked from writing.
async function persistEsporteModalidades(userId: string, modalidadeIds: string[]) {
  await supabaseAdmin
    .from("esportes_modalidade_acessos" as never)
    .delete()
    .eq("user_id", userId);
  const unique = Array.from(new Set(modalidadeIds));
  if (unique.length === 0) return;
  const rows = unique.map((modalidade_id) => ({ user_id: userId, modalidade_id }));
  const { error } = await supabaseAdmin
    .from("esportes_modalidade_acessos" as never)
    .insert(rows as never);
  if (error) throw new Error(error.message);
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
    const { data: userSchools } = await supabaseAdmin
      .from("user_schools" as any)
      .select("user_id, school_id");
    const schoolMap = new Map<string, string[]>();
    (userSchools ?? []).forEach((s: any) => {
      const arr = schoolMap.get(s.user_id) ?? [];
      arr.push(s.school_id);
      schoolMap.set(s.user_id, arr);
    });
    const { data: modalidadeAcessos } = await supabaseAdmin
      .from("esportes_modalidade_acessos" as never)
      .select("user_id, modalidade_id");
    const modalidadeMap = new Map<string, string[]>();
    ((modalidadeAcessos ?? []) as unknown as { user_id: string; modalidade_id: string }[]).forEach(
      (m) => {
        const arr = modalidadeMap.get(m.user_id) ?? [];
        arr.push(m.modalidade_id);
        modalidadeMap.set(m.user_id, arr);
      },
    );
    return (
      usersResp.users
        .map((u) => {
          const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
          const name =
            (typeof meta.full_name === "string" && meta.full_name) ||
            (typeof meta.name === "string" && meta.name) ||
            "";
          return {
            id: u.id,
            email: u.email ?? "",
            name,
            created_at: u.created_at,
            roles: roleMap.get(u.id) ?? [],
            permissions: permMap.get(u.id) ?? [],
            schoolIds: schoolMap.get(u.id) ?? [],
            esporteModalidadeIds: modalidadeMap.get(u.id) ?? [],
          };
        })
        // Ordenação alfabética crescente (fallback no e-mail quando sem nome).
        .sort((a, b) =>
          (a.name || a.email).localeCompare(b.name || b.email, "pt-BR", { sensitivity: "base" }),
        )
    );
  });

export const createManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(255),
        password: z.string().min(6).max(72),
        isAdmin: z.boolean().default(false),
        permissions: z.array(permissionSchema).default([]),
        schoolIds: z.array(z.string().uuid()).default([]),
        esporteModalidadeIds: z.array(z.string().uuid()).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Fail-closed: um usuário não-admin sem nenhuma unidade não acessa nada.
    // Exige ao menos uma unidade ao criar o perfil (admins têm acesso global).
    if (!data.isAdmin && data.schoolIds.length === 0) {
      throw new Error(
        "Selecione ao menos uma unidade para o novo usuário (ou marque como Administrador).",
      );
    }
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.name },
    });
    if (error) throw new Error(error.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("Falha ao criar usuário.");
    await persistAccess(userId, data.isAdmin, data.permissions);
    await persistSchools(userId, data.schoolIds);
    await persistEsporteModalidades(userId, data.esporteModalidadeIds);
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
        schoolIds: z.array(z.string().uuid()).default([]),
        esporteModalidadeIds: z.array(z.string().uuid()).default([]),
        name: z.string().trim().max(120).optional(),
        email: z.string().trim().email().max(255).optional(),
        // Empty string means "leave password unchanged".
        password: z.string().max(72).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && !data.isAdmin) {
      throw new Error("Você não pode remover o próprio acesso de administrador.");
    }
    // Fail-closed: um não-admin sem unidade ficaria sem acesso a nada; impede
    // salvar um perfil restrito com zero unidades.
    if (!data.isAdmin && data.schoolIds.length === 0) {
      throw new Error(
        "Selecione ao menos uma unidade para o usuário (ou marque como Administrador).",
      );
    }

    // Update auth credentials (email / password / name) via the Supabase admin API.
    const attrs: { email?: string; password?: string; user_metadata?: Record<string, unknown> } =
      {};
    if (data.email) attrs.email = data.email;
    if (typeof data.name === "string") attrs.user_metadata = { full_name: data.name };
    if (data.password && data.password.length > 0) {
      if (data.password.length < 6) {
        throw new Error("A senha deve ter pelo menos 6 caracteres.");
      }
      attrs.password = data.password;
    }
    if (Object.keys(attrs).length > 0) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, attrs);
      if (error) throw new Error(error.message);
    }

    await persistAccess(data.userId, data.isAdmin, data.permissions);
    await persistSchools(data.userId, data.schoolIds);
    await persistEsporteModalidades(data.userId, data.esporteModalidadeIds);
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
