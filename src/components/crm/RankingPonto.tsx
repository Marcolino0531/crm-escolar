import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Funcionario } from "@/lib/crm/types";
import { PeriodoRh, rotuloPeriodo } from "@/lib/rh-periodo";
import { agregarPontoPorFuncionario, formatarMinutos, type DiaPontoGravado } from "@/lib/ponto";

interface RankingPontoProps {
  funcionarios: Funcionario[];
  periodo: PeriodoRh;
}

type DiaRow = {
  employee_id: string | null;
  atraso_min: number;
  antecipacao_min: number;
};

const LOTE = 1000;

// Intervalo do período em datas ISO, para filtrar direto no banco.
function intervalo(periodo: PeriodoRh): { inicio: string; fim: string } {
  if (periodo.modo === "ano") {
    return { inicio: `${periodo.ano}-01-01`, fim: `${periodo.ano}-12-31` };
  }
  const mes = String(periodo.mes).padStart(2, "0");
  const ultimo = new Date(Date.UTC(periodo.ano, periodo.mes, 0)).getUTCDate();
  return { inicio: `${periodo.ano}-${mes}-01`, fim: `${periodo.ano}-${mes}-${ultimo}` };
}

const RankingPonto: React.FC<RankingPontoProps> = ({ funcionarios, periodo }) => {
  const { inicio, fim } = intervalo(periodo);
  const nomePorId = new Map(funcionarios.map((f) => [f.id, f.nomeCompleto]));

  const dias = useQuery({
    queryKey: ["hr-timesheet-days", inicio, fim],
    queryFn: async (): Promise<DiaRow[]> => {
      // O PostgREST devolve no máximo 1000 linhas por requisição e um ano de
      // batidas passa disso com folga: pagina até esgotar.
      const todas: DiaRow[] = [];
      for (let de = 0; ; de += LOTE) {
        const { data, error } = await supabase
          .from("hr_timesheet_days" as never)
          .select("employee_id, atraso_min, antecipacao_min")
          .gte("dia", inicio)
          .lte("dia", fim)
          .range(de, de + LOTE - 1);
        if (error) throw new Error(error.message);
        const lote = (data ?? []) as unknown as DiaRow[];
        todas.push(...lote);
        if (lote.length < LOTE) return todas;
      }
    },
  });

  const gravados: DiaPontoGravado[] = (dias.data ?? [])
    .filter((d) => d.employee_id && nomePorId.has(d.employee_id))
    .map((d) => ({
      funcionarioId: d.employee_id as string,
      nome: nomePorId.get(d.employee_id as string) ?? "",
      atrasoMin: d.atraso_min,
      antecipacaoMin: d.antecipacao_min,
    }));
  const ranking = agregarPontoPorFuncionario(gravados);
  const maxDias = ranking.length > 0 ? ranking[0].dias : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <span>🕒</span>
        <h3 className="text-sm font-bold text-gray-700">
          Ranking de Atrasos e Saídas (ponto eletrônico)
        </h3>
      </div>

      {dias.isLoading ? (
        <p className="px-4 py-6 text-sm text-gray-400 text-center">Carregando…</p>
      ) : ranking.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">
          <span className="text-3xl block mb-2">📋</span>
          <p className="text-sm">
            Nenhuma ocorrência no ponto em {rotuloPeriodo(periodo)}. Importe o PDF do relógio de
            ponto na aba "Folha de Ponto".
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {ranking.map((item, idx) => (
            <div key={item.funcionarioId} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      idx === 0
                        ? "bg-amber-100 text-amber-700"
                        : idx === 1
                          ? "bg-gray-200 text-gray-600"
                          : idx === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium text-gray-800 truncate">{item.nome}</span>
                </div>
                <span className="flex-shrink-0 text-sm font-bold text-gray-700 ml-2">
                  {item.dias} {item.dias === 1 ? "dia" : "dias"}
                </span>
              </div>

              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-1.5">
                {item.diasAtraso > 0 && (
                  <div
                    className="bg-red-400"
                    style={{ width: `${(item.diasAtraso / maxDias) * 100}%` }}
                  />
                )}
                {item.diasAntecipacao > 0 && (
                  <div
                    className="bg-amber-400"
                    style={{ width: `${(item.diasAntecipacao / maxDias) * 100}%` }}
                  />
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {item.diasAtraso} atrasos
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {item.diasAntecipacao} saídas antecipadas
                </span>
                <span className="flex items-center gap-1 text-gray-600 font-medium">
                  ⏱ {formatarMinutos(item.totalMinutos)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RankingPonto;
