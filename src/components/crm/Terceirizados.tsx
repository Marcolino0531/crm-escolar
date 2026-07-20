import React, { useState } from "react";
import { Plus, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useSchool } from "@/lib/app-context";
import type { GradeTurnos, Terceirizado } from "@/lib/crm/types";
import {
  DIAS_SEMANA,
  turnosDaFalta,
  useTerceirizados,
  type TerceirizadoFormData,
} from "@/lib/crm/terceirizados";
import TerceirizadoModal from "./TerceirizadoModal";

interface TerceirizadosProps {
  unidadeSelecionada: string;
  isAdmin: boolean;
}

// Nº de turnos por semana previstos na grade.
const contarTurnosGrade = (grade: GradeTurnos): number =>
  DIAS_SEMANA.reduce(
    (acc, d) => acc + (grade[d.id].manha ? 1 : 0) + (grade[d.id].tarde ? 1 : 0),
    0,
  );

// Resumo compacto dos dias com pelo menos um turno.
const resumoGrade = (grade: GradeTurnos): string => {
  const dias = DIAS_SEMANA.filter((d) => grade[d.id].manha || grade[d.id].tarde).map((d) =>
    d.label.slice(0, 3),
  );
  return dias.length ? dias.join(", ") : "—";
};

const Terceirizados: React.FC<TerceirizadosProps> = ({ unidadeSelecionada, isAdmin }) => {
  const { schools } = useSchool();
  const { terceirizados, isLoading, adicionar, editar, remover, adicionarFalta, removerFalta } =
    useTerceirizados();

  const [modalAberto, setModalAberto] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);

  const unidades = schools.map((s) => s.name);
  const selecionado = selecionadoId
    ? terceirizados.find((t) => t.id === selecionadoId) || null
    : null;

  const handleCriar = (dados: TerceirizadoFormData) => {
    adicionar(dados);
    setModalAberto(false);
  };

  const handleEditar = (dados: TerceirizadoFormData) => {
    if (!selecionadoId) return;
    editar(selecionadoId, dados);
    setSelecionadoId(null);
    toast.success("Alterações salvas com sucesso.");
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {terceirizados.length} terceirizado(s) cadastrado(s)
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setModalAberto(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-md transition-colors hover:from-emerald-700 hover:to-teal-700"
          >
            <Plus className="h-4 w-4" />
            Novo Terceirizado
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
      ) : terceirizados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <UserCog className="mb-3 h-10 w-10" />
          <p className="text-lg font-medium">Nenhum terceirizado cadastrado</p>
          <p className="text-sm">Clique em "Novo Terceirizado" para começar.</p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Nome
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Atividade
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Grade
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Turnos/sem
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Faltas
                  </th>
                  {isAdmin && (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Ações
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {terceirizados.map((t) => {
                  const turnosFaltados = t.faltas.reduce(
                    (acc, f) => acc + turnosDaFalta(f.turno),
                    0,
                  );
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelecionadoId(t.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                            <span className="text-sm font-bold text-emerald-600">
                              {t.nomeCompleto.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-gray-800">
                            {t.nomeCompleto}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{t.especialidade || "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{resumoGrade(t.grade)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-600">
                        {contarTurnosGrade(t.grade)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">
                        {turnosFaltados > 0 ? (
                          <span className="font-medium text-red-600">{turnosFaltados}</span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Remover ${t.nomeCompleto}?`)) remover(t.id);
                            }}
                            className="text-xs font-medium text-red-400 hover:text-red-600"
                          >
                            Remover
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAberto && (
        <TerceirizadoModal
          unidadeSelecionada={unidadeSelecionada}
          unidades={unidades}
          onSalvar={handleCriar}
          onFechar={() => setModalAberto(false)}
          isAdmin={isAdmin}
        />
      )}

      {selecionado && (
        <TerceirizadoModal
          unidadeSelecionada={unidadeSelecionada}
          unidades={unidades}
          terceirizadoExistente={selecionado}
          onSalvar={handleEditar}
          onFechar={() => setSelecionadoId(null)}
          onAdicionarFalta={isAdmin ? adicionarFalta : undefined}
          onRemoverFalta={isAdmin ? removerFalta : undefined}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};

export default Terceirizados;
