import React from "react";
import { Funcionario, CategoriaFalta } from "@/lib/crm/types";
import { PeriodoRh, dentroDoPeriodo, rotuloPeriodo } from "@/lib/rh-periodo";

interface RankingFaltasProps {
  funcionarios: Funcionario[];
  periodo: PeriodoRh;
}

interface RankingItem {
  id: string;
  nome: string;
  total: number;
  comAtestado: number;
  semAtestado: number;
  totalMinutos: number;
}

const categoriaDe = (c?: CategoriaFalta): CategoriaFalta => c ?? "integral";

const formatarDuracao = (minutos: number): string => {
  if (!minutos || minutos <= 0) return "0min";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
};

// Soma por funcionário considerando apenas as categorias pedidas, ordenando do
// maior número de ocorrências para o menor e, em empate, priorizando quem tem
// mais ocorrências "Sem Atestado".
const construirRanking = (
  funcionarios: Funcionario[],
  categorias: CategoriaFalta[],
  periodo: PeriodoRh,
): RankingItem[] =>
  funcionarios
    .map((f) => {
      const ocorrencias = (f.faltas ?? []).filter(
        (fa) => categorias.includes(categoriaDe(fa.categoria)) && dentroDoPeriodo(fa.data, periodo),
      );
      return {
        id: f.id,
        nome: f.nomeCompleto,
        total: ocorrencias.length,
        comAtestado: ocorrencias.filter((fa) => fa.tipo === "com_atestado").length,
        semAtestado: ocorrencias.filter((fa) => fa.tipo === "sem_atestado").length,
        totalMinutos: ocorrencias.reduce((acc, fa) => acc + (fa.duracaoMinutos ?? 0), 0),
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || b.semAtestado - a.semAtestado);

interface RankingCardProps {
  titulo: string;
  icone: string;
  vazio: string;
  ranking: RankingItem[];
  unidadeLabel: (total: number) => string;
  mostrarTempo?: boolean;
}

const RankingCard: React.FC<RankingCardProps> = ({
  titulo,
  icone,
  vazio,
  ranking,
  unidadeLabel,
  mostrarTempo = false,
}) => {
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
                  {item.total} {unidadeLabel(item.total)}
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

              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  {item.comAtestado} com atestado
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {item.semAtestado} sem atestado
                </span>
                {mostrarTempo && (
                  <span className="flex items-center gap-1 text-gray-600 font-medium">
                    ⏱ {formatarDuracao(item.totalMinutos)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RankingFaltas: React.FC<RankingFaltasProps> = ({ funcionarios, periodo }) => {
  const rankingFaltas = construirRanking(funcionarios, ["integral"], periodo);
  const rankingParciais = construirRanking(funcionarios, ["atraso", "saida_antecipada"], periodo);
  const rotulo = rotuloPeriodo(periodo);

  return (
    <div className="space-y-4">
      <RankingCard
        titulo="Ranking de Faltas"
        icone="🏆"
        vazio={`Nenhuma falta integral registrada em ${rotulo}.`}
        ranking={rankingFaltas}
        unidadeLabel={(t) => (t === 1 ? "falta" : "faltas")}
      />
      <RankingCard
        titulo="Ranking de Atrasos e Saídas (lançamento manual)"
        icone="⏰"
        vazio={`Nenhum atraso ou saída antecipada registrado em ${rotulo}.`}
        ranking={rankingParciais}
        unidadeLabel={(t) => (t === 1 ? "ocorrência" : "ocorrências")}
        mostrarTempo
      />
    </div>
  );
};

export default RankingFaltas;
