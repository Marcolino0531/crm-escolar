import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  avaliarPermissoes,
  listarNos,
  noPorChave,
  type ChavePermissao,
  type LinhaPermissao,
} from "@/lib/permissoes-arvore";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------- Auth ----------
type AuthCtx = {
  session: Session | null;
  loading: boolean;
  // True while the user is in a password-recovery flow (arrived via the
  // "Esqueci minha senha" e-mail link). The app must show the new-password
  // form instead of the normal shell until the password is updated.
  recovery: boolean;
  clearRecovery: () => void;
};
const AuthContext = createContext<AuthCtx>({
  session: null,
  loading: true,
  recovery: false,
  clearRecovery: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const clearRecovery = () => setRecovery(false);

  return (
    <AuthContext.Provider value={{ session, loading, recovery, clearRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

// ---------- School filter (global) ----------
export type SchoolFilter = string; // "all" or school uuid

type SchoolCtx = {
  selected: SchoolFilter;
  setSelected: (v: SchoolFilter) => void;
  schools: { id: string; name: string }[];
  // True when the logged-in user is limited to a subset of schools.
  restricted: boolean;
  // True for a non-admin whose user_schools is empty: they may access NO school
  // (never the whole set). The app must show an access-denied state, not data.
  noSchoolAccess: boolean;
  // True for users who may select the consolidated "Todas as Unidades" view:
  // global users (admin/unrestricted) and restricted users with MORE THAN ONE
  // permitted unit. Single-unit restricted users stay locked to their unit.
  canSeeAll: boolean;
  // School ids the current user is explicitly allowed to access (empty for
  // global/unrestricted users).
  allowedIds: string[];
  // School ids to constrain Supabase queries by. `null` = no filter (global
  // access pulls the whole table). For a specific selection it is `[selected]`;
  // for a restricted user on "Todas as Unidades" it is their permitted units,
  // so the consolidated view never leaks data from other schools.
  schoolFilterIds: string[] | null;
};
const SchoolContext = createContext<SchoolCtx>({
  selected: "all",
  setSelected: () => {},
  schools: [],
  restricted: false,
  noSchoolAccess: false,
  canSeeAll: true,
  allowedIds: [],
  schoolFilterIds: null,
});

export function SchoolProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();
  // Every fresh load/login starts on the consolidated view ("Todas as
  // Unidades"); the selection is intentionally NOT persisted across reloads.
  const [selected, setSelected] = useState<SchoolFilter>("all");

  const { data: allSchools = [] } = useQuery({
    queryKey: ["schools", session?.user?.id ?? "anon"],
    enabled: !!session?.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("schools").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Schools this user is explicitly assigned to (user_schools). For a non-admin
  // this is the ONLY set they may access — an empty set means NO access, never
  // "all". Admins are global and ignore this list.
  const { data: allowedIds = [], isLoading: allowedLoading } = useQuery({
    queryKey: ["user_schools", session?.user?.id ?? "anon"],
    enabled: !!session?.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_schools" as any)
        .select("school_id")
        .eq("user_id", session!.user.id);
      if (error) return [] as string[];
      return ((data ?? []) as unknown as { school_id: string }[]).map((r) => r.school_id);
    },
  });

  // Any non-admin is scoped to their assigned units. Admins are unrestricted.
  const restricted = !isAdmin;
  const schools = useMemo(() => {
    if (isAdmin) return allSchools;
    // Non-admin: intersect with assigned units. Empty assignment ⇒ no schools.
    return allSchools.filter((s) => allowedIds.includes(s.id));
  }, [allSchools, allowedIds, isAdmin]);

  // Non-admin with zero assigned units: deny access (show no data), never fall
  // back to the full set. Gate on loading so we don't flash denial mid-fetch.
  const noSchoolAccess = !isAdmin && !roleLoading && !allowedLoading && allowedIds.length === 0;

  // Who may use "Todas as Unidades": global users (admin/unrestricted) and any
  // restricted user with more than one permitted unit. For the latter, "all"
  // means the consolidation of *their* units (see schoolFilterIds). A restricted
  // user with a single unit has nothing to consolidate and stays locked to it.
  const canSeeAll = !restricted || schools.length > 1;

  // School ids to constrain Supabase queries by:
  //  • specific unit selected → just that unit;
  //  • "Todas as Unidades" + restricted → only the user's permitted units;
  //  • "Todas as Unidades" + global → null (no filter, whole table).
  const schoolFilterIds = useMemo<string[] | null>(() => {
    if (selected !== "all") return [selected];
    if (restricted) return schools.map((s) => s.id);
    return null;
  }, [selected, restricted, schools]);

  // Keep the active selection valid:
  //  • Users who can see all: leave "all" (or a valid unit) as-is.
  //  • Single-unit restricted users: never allow "all" — fall back to their
  //    first permitted unit. This also fixes the default login state ("all").
  useEffect(() => {
    if (schools.length === 0) return; // schools not loaded yet
    if (canSeeAll) {
      // Selection may still point to a now-invalid unit (e.g. permissions
      // changed). Keep "all" as-is; coerce stale specific ids to "all".
      if (selected !== "all" && !schools.some((s) => s.id === selected)) {
        setSelected("all");
      }
      return;
    }
    const ids = schools.map((s) => s.id);
    if (selected === "all" || !ids.includes(selected)) {
      setSelected(schools[0].id);
    }
  }, [canSeeAll, schools, selected]);

  return (
    <SchoolContext.Provider
      value={{
        selected,
        setSelected,
        schools,
        restricted,
        noSchoolAccess,
        canSeeAll,
        allowedIds,
        schoolFilterIds,
      }}
    >
      {children}
    </SchoolContext.Provider>
  );
}
export const useSchool = () => useContext(SchoolContext);

// ---------- Role (Admin vs Viewer) ----------
export type AppRole = "admin" | "viewer";

export function useRole() {
  const { session } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["user_role", session?.user?.id ?? "anon"],
    enabled: !!session?.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", session!.user.id);
      if (error) throw error;
      const roles = (data ?? []).map((r: any) => r.role as AppRole);
      return roles.includes("admin") ? "admin" : "viewer";
    },
  });
  return { role: (data ?? null) as AppRole | null, loading: isLoading, isAdmin: data === "admin" };
}

// ---------- Permissões (árvore Grupo > Módulo > Página) ----------
// A fonte da verdade é src/lib/permissoes-arvore.ts; aqui só se lê
// user_permissions e se avalia a árvore para o usuário logado.
export type AppModule = ChavePermissao;

/** Nome exibido de cada chave da árvore (menu, abas e Gerenciar Acessos). */
export const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  listarNos().map((n) => [n.chave, n.nome]),
);

export function usePermissions() {
  const { session } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();

  const { data, isLoading } = useQuery({
    queryKey: ["user_permissions", session?.user?.id ?? "anon"],
    enabled: !!session?.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permissions" as any)
        .select("module, can_view, can_edit")
        .eq("user_id", session!.user.id);
      // Don't crash the whole app if the table isn't there yet (pre-migration).
      if (error) return [] as LinhaPermissao[];
      return (data ?? []) as unknown as LinhaPermissao[];
    },
  });

  const permissoes = useMemo(() => avaliarPermissoes(data ?? [], isAdmin), [data, isAdmin]);

  const loading = roleLoading || isLoading;
  const canView = (m: ChavePermissao) => {
    const no = noPorChave(m);
    if (no?.acessoEspecial === "admin") return isAdmin;
    if (no?.acessoEspecial === "professor") return isAdmin;
    return permissoes.ver(m);
  };
  const canEdit = (m: ChavePermissao) => {
    const no = noPorChave(m);
    if (no?.acessoEspecial === "admin") return isAdmin;
    if (no?.acessoEspecial === "professor") return isAdmin;
    return permissoes.editar(m);
  };
  return { loading, isAdmin, canView, canEdit, linhas: data ?? [] };
}
