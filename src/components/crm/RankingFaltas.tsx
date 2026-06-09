import React from "react";
import { Funcionario } from "@/lib/crm/types";

interface RankingFaltasProps {
  funcionarios: Funcionario[];
}

interface RankingItem {
  id: string;
  nome: string;
  total: number;
  comAtestado: number;
  semAtestado: number;
}

const RankingFaltas: React.FC<RankingFaltasProps> = ({ funcionarios }) => {
  const ranking: RankingItem[] = funcionarios
    .map((f) => {
      const faltas = f.faltas ?? [];
      const comAtestado = faltas.filter((fa) => fa.tipo === "com_atestado").length;
      const semAtestado = faltas.filter((fa) => fa.tipo === "sem_atestado").length;
      return {
        id: f.id,
        nome: f.nomeCompleto,
        total: faltas.length,
        comAtestado,
        semAtestado,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const maxTotal = ranking.length > 0 ? ranking[0].total : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <span>🏆</span>
        <h3 className="text-sm font-bold text-gray-700">Ranking de Faltas</h3>
      </div>

      {ranking.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">
          <span className="text-3xl block mb-2">📋</span>
          <p className="text-sm">Nenhuma falta registrada.</p>
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

              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-1.5">
                {item.semAtestado > 0 && (
                  <div
                    className="bg-red-400"
                    style={{ width: `${(item.semAtestado / maxTotal) * 100}%` }}
                  />
                )}
                {item.comAtestado > 0 && (
                  <div
                    className="bg-emerald-400"
                    style={{ width: `${(item.comAtestado / maxTotal) * 100}%` }}
                  />
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {item.comAtestado} com atestado
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {item.semAtestado} sem atestado
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RankingFaltas;
