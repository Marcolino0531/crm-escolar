import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { testemunhasDaUnidade, type TestemunhaDocumento } from "@/lib/testemunhas";

/** Testemunhas de Documentos ativas da unidade, na ordem em que assinam. */
export function useTestemunhasDaUnidade(unidade: string | null) {
  return useQuery({
    queryKey: ["testemunhas_documentos", unidade],
    enabled: !!unidade,
    queryFn: async (): Promise<TestemunhaDocumento[]> => {
      const { data, error } = await supabase
        .from("contrato_testemunhas" as never)
        .select("unidade, ordem, nome, cpf, email, celular, ativa")
        .eq("unidade", unidade ?? "")
        .eq("ativa", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return testemunhasDaUnidade((data ?? []) as unknown as TestemunhaDocumento[], unidade ?? "");
    },
  });
}
