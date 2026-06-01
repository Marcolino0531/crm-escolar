import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
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
};
const SchoolContext = createContext<SchoolCtx>({ selected: "all", setSelected: () => {}, schools: [] });

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SchoolFilter>(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("school_filter") ?? "all";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("school_filter", selected);
  }, [selected]);

  const { data: schools = [] } = useQuery({
    queryKey: ["schools"],
    queryFn: async () => {
      const { data, error } = await supabase.from("schools").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <SchoolContext.Provider value={{ selected, setSelected, schools }}>
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
