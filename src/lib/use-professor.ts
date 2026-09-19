// Professor logado = funcionário com funcionarios.auth_user_id = auth.uid().
// A RLS deixa o professor ler só a própria linha; secretaria/admin não têm
// vínculo e recebem null (não são professores).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";

export interface ProfessorLogado {
  id: string;
  nome_completo: string;
  school_id: string;
}

export function useProfessor() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { data, isLoading } = useQuery({
    queryKey: ["professor_logado", userId ?? "anon"],
    enabled: !!userId,
    queryFn: async (): Promise<ProfessorLogado | null> => {
      const { data, error } = await supabase
        .from("funcionarios")
        .select("id, nome_completo, school_id")
        .eq("auth_user_id", userId!)
        .is("data_rescisao", null)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });
  return { professor: data ?? null, loading: !!userId && isLoading };
}
