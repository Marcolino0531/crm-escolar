// Rankings de faltas integrais do RH, separados por tipo (com/sem atestado).
// Cada ranking conta só as ocorrências do próprio tipo, dentro do período, e
// ordena do maior para o menor; em empate, por nome.

import type { CategoriaFalta, TipoFalta } from "@/lib/crm/types";
import { PeriodoRh, dentroDoPeriodo } from "@/lib/rh-periodo";

export type FaltaRankeavel = {
  data: string;
  tipo: TipoFalta;
  categoria?: CategoriaFalta;
};

export type FuncionarioRankeavel = {
  id: string;
  nomeCompleto: string;
  faltas?: FaltaRankeavel[];
};

export type ItemRankingFaltas = {
  id: string;
  nome: string;
  total: number;
};

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

// Registros antigos não têm categoria e contam como falta integral.
const ehIntegral = (f: FaltaRankeavel) => (f.categoria ?? "integral") === "integral";

export function rankingFaltasPorTipo(
  funcionarios: readonly FuncionarioRankeavel[],
  tipo: TipoFalta,
  periodo: PeriodoRh,
): ItemRankingFaltas[] {
  return funcionarios
    .map((f) => ({
      id: f.id,
      nome: f.nomeCompleto,
      total: (f.faltas ?? []).filter(
        (fa) => ehIntegral(fa) && fa.tipo === tipo && dentroDoPeriodo(fa.data, periodo),
      ).length,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || collator.compare(a.nome, b.nome));
}
