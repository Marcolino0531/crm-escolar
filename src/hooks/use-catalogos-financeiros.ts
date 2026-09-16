import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  IDS_VAZIOS,
  resolverIdsFinanceiros,
  type IdsFinanceiros,
} from "@/lib/dashboard-financeiro";

export interface CatalogosFinanceiros {
  ids: IdsFinanceiros;
  nomesCentros: Map<string, string>;
}

/**
 * Categorias de receita e centros de custo resolvidos para os ids usados nas
 * exclusões de faturamento (resgate de fundo, aporte de outra unidade). Fonte
 * única para Dashboard e Inadimplência.
 */
export function useCatalogosFinanceiros() {
  const query = useQuery({
    queryKey: ["dash-fin-catalogos"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CatalogosFinanceiros> => {
      type Nomeado = { id: string; name: string };
      const [rc, cc] = await Promise.all([
        supabase.from("revenue_categories").select("id, name"),
        supabase.from("cost_centers").select("id, name"),
      ]);
      if (rc.error) throw rc.error;
      if (cc.error) throw cc.error;
      const centros = (cc.data ?? []) as Nomeado[];
      return {
        ids: resolverIdsFinanceiros((rc.data ?? []) as Nomeado[], centros),
        nomesCentros: new Map(centros.map((c) => [c.id, c.name])),
      };
    },
  });
  return {
    catalogos: query.data,
    idsFin: query.data?.ids ?? IDS_VAZIOS,
    idsCarregados: query.data != null,
  };
}
