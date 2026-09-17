import React from "react";
import { Funcionario } from "@/lib/crm/types";
import { PeriodoRh, rotuloPeriodo } from "@/lib/rh-periodo";
import { ItemRankingFaltas, rankingFaltasPorTipo } from "@/lib/rh-ranking-faltas";

interface RankingFaltasProps {
  funcionarios: Funcionario[];
  periodo: PeriodoRh;
}

interface RankingCardProps {
  titulo: string;
  icone: string;
  vazio: string;
  ranking: ItemRankingFaltas[];
  corBarra: string;
}

const RankingCard: React.FC<RankingCardProps> = ({ titulo, icone, vazio, ranking, corBarra }) => {
  const maxTotal = ranking.length > 0 ? ranking[0].total : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <span>{icone}</span>
        <h3 className="text-sm font-bold text-gray-700">{titulo}</h3>
      </div>

      {ranking.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">
          <span className="text-3xl block mb-2">📋</span>
          <p className="text-sm">{vazio}</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {ranking.map((item, idx) => (
            <div key={item.id} className="px-4 py-3">
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
                  {item.total} {item.total === 1 ? "falta" : "faltas"}
                </span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                <div className={corBarra} style={{ width: `${(item.total / maxTotal) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RankingFaltas: React.FC<RankingFaltasProps> = ({ funcionarios, periodo }) => {
  const rotulo = rotuloPeriodo(periodo);

  return (
    <div className="space-y-4">
      <RankingCard
        titulo="Ranking de Faltas com Atestado"
        icone="🩺"
        vazio={`Nenhuma falta com atestado registrada em ${rotulo}.`}
        ranking={rankingFaltasPorTipo(funcionarios, "com_atestado", periodo)}
        corBarra="bg-emerald-400"
      />
      <RankingCard
        titulo="Ranking de Faltas sem Atestado"
        icone="🏆"
        vazio={`Nenhuma falta sem atestado registrada em ${rotulo}.`}
        ranking={rankingFaltasPorTipo(funcionarios, "sem_atestado", periodo)}
        corBarra="bg-red-400"
      />
    </div>
  );
};

export default RankingFaltas;
