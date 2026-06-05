import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------- Auth ----------
type AuthCtx = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthCtx>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
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
};
const SchoolContext = createContext<SchoolCtx>({
  selected: "all",
  setSelected: () => {},
  schools: [],
  restricted: false,
});

export function SchoolProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { isAdmin } = useRole();
  const [selected, setSelected] = useState<SchoolFilter>(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("school_filter") ?? "all";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("school_filter", selected);
  }, [selected]);

  const { data: allSchools = [] } = useQuery({
    queryKey: ["schools", session?.user?.id ?? "anon"],
    enabled: !!session?.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("schools").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Schools this user is explicitly allowed to access. Empty = unrestricted.
  const { data: allowedIds = [] } = useQuery({
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

  const restricted = !isAdmin && allowedIds.length > 0;
  const schools = useMemo(() => {
    if (!restricted) return allSchools;
    return allSchools.filter((s) => allowedIds.includes(s.id));
  }, [allSchools, allowedIds, restricted]);

  // Keep the active selection valid for restricted users: if the current
  // selection is not allowed, fall back to their single school (locked) or
  // to the consolidated view of their allowed schools.
  useEffect(() => {
    if (!restricted) return;
    const ids = schools.map((s) => s.id);
    if (schools.length === 1) {
      if (selected !== schools[0].id) setSelected(schools[0].id);
    } else if (selected !== "all" && !ids.includes(selected)) {
      setSelected("all");
    }
  }, [restricted, schools, selected]);

  return (
    <SchoolContext.Provider value={{ selected, setSelected, schools, restricted }}>
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

// ---------- Granular module permissions ----------
export const APP_MODULES = [
  "admissoes",
  "onboarding",
  "rh",
  "financeiro",
  "configuracoes",
] as const;

// Financeiro is sliced into independently authorizable sub-tabs.
export const FINANCEIRO_SUBMODULES = [
  "financeiro_dashboard",
  "financeiro_upload",
  "financeiro_conciliacao",
  "financeiro_fluxo",
  "financeiro_inadimplencia",
  "financeiro_fundos",
] as const;

// Every module that can appear in the permission matrix / be persisted.
export const ALL_MODULES = [...APP_MODULES, ...FINANCEIRO_SUBMODULES] as const;

export type AppModule = (typeof ALL_MODULES)[number];
export type FinanceiroSubmodule = (typeof FINANCEIRO_SUBMODULES)[number];

export const MODULE_LABELS: Record<AppModule, string> = {
  admissoes: "Admissões",
  onboarding: "Onboarding",
  rh: "Recursos Humanos",
  financeiro: "Financeiro",
  configuracoes: "Configurações",
  financeiro_dashboard: "Dashboard",
  financeiro_upload: "Importar Extrato",
  financeiro_conciliacao: "Conciliação de Faturamento",
  financeiro_fluxo: "Fluxo Futuro",
  financeiro_inadimplencia: "Inadimplência",
  financeiro_fundos: "Fundos",
};

export type ModulePermission = { view: boolean; edit: boolean };
export type PermissionMatrix = Record<AppModule, ModulePermission>;

function emptyMatrix(value: boolean): PermissionMatrix {
  return ALL_MODULES.reduce((acc, m) => {
    acc[m] = { view: value, edit: value };
    return acc;
  }, {} as PermissionMatrix);
}

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
      if (error) return [] as { module: string; can_view: boolean; can_edit: boolean }[];
      return (data ?? []) as unknown as { module: string; can_view: boolean; can_edit: boolean }[];
    },
  });

  const permissions = useMemo<PermissionMatrix>(() => {
    if (isAdmin) return emptyMatrix(true);
    const matrix = emptyMatrix(false);
    for (const row of data ?? []) {
      if ((ALL_MODULES as readonly string[]).includes(row.module)) {
        matrix[row.module as AppModule] = {
          view: !!row.can_view || !!row.can_edit,
          edit: !!row.can_edit,
        };
      }
    }
    return matrix;
  }, [data, isAdmin]);

  const loading = roleLoading || isLoading;
  return {
    permissions,
    loading,
    isAdmin,
    canView: (m: AppModule) => permissions[m].view,
    canEdit: (m: AppModule) => permissions[m].edit,
  };
}
