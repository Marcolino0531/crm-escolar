import React, { useState } from "react";
import { OnboardingAluno } from "@/lib/crm/types";
import { TAREFAS_ONBOARDING } from "@/lib/crm/constants";
import { useOnboarding } from "@/lib/crm/hooks";
import { usePermissions } from "@/lib/app-context";
import { displayPhoneBR } from "@/lib/phone";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  User,
  GraduationCap,
  Phone,
  Trash2,
} from "lucide-react";

interface OnboardingBoardProps {
  onboardingHook: ReturnType<typeof useOnboarding>;
}

const OnboardingBoard: React.FC<OnboardingBoardProps> = ({ onboardingHook }) => {
  const { canEdit } = usePermissions();
  const isAdmin = canEdit("onboarding");
  const { alunosPendentes, alunosConcluidos, alternarTarefa, contarTarefas, removerAluno } =
    onboardingHook;
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [mostrarConcluidos, setMostrarConcluidos] = useState(false);

  const toggleExpandido = (alunoId: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(alunoId)) {
        next.delete(alunoId);
      } else {
        next.add(alunoId);
      }
      return next;
    });
  };

  const renderAluno = (aluno: OnboardingAluno) => {
    const isExpandido = expandidos.has(aluno.id);
    const { concluidas, total } = contarTarefas(aluno.id);
    const porcentagem = Math.round((concluidas / total) * 100);

    return (
      <div
        key={aluno.id}
        className={`bg-white rounded-xl border shadow-sm transition-all ${
          aluno.concluido ? "border-green-200 bg-green-50/30" : "border-gray-200 hover:shadow-md"
        }`}
      >
        <button
          onClick={() => toggleExpandido(aluno.id)}
          className="w-full flex items-center gap-4 p-4 text-left"
        >
          <div className="flex-shrink-0">
            {isExpandido ? (
              <ChevronDown size={20} className="text-gray-400" />
            ) : (
              <ChevronRight size={20} className="text-gray-400" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-800 truncate">{aluno.nomeAluno}</h3>
              {aluno.concluido && (
                <span className="inline-flex items-center gap-1 bg-green-100 border border-green-300 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                  Concluído
                </span>
              )}
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm("Tem certeza que deseja remover este aluno do onboarding?")
                    ) {
                      removerAluno(aluno.id);
                    }
                  }}
                  className="flex-shrink-0 p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                  title="Remover aluno do onboarding"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <GraduationCap size={12} />
                {aluno.turma}
              </span>
              <span className="flex items-center gap-1">
                <User size={12} />
                <span className="truncate max-w-[120px]">{aluno.nomePaiMae}</span>
              </span>
              <span className="flex items-center gap-1">
                <Phone size={12} />
                {displayPhoneBR(aluno.telefone)}
              </span>
            </div>
          </div>

          <div className="flex-shrink-0 flex items-center gap-3">
            <span
              className={`text-xs font-semibold ${
                aluno.concluido ? "text-green-600" : "text-gray-500"
              }`}
            >
              {concluidas}/{total}
            </span>
            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  aluno.concluido ? "bg-green-500" : porcentagem > 0 ? "bg-teal-500" : "bg-gray-200"
                }`}
                style={{ width: `${porcentagem}%` }}
              />
            </div>
          </div>
        </button>

        {isExpandido && (
          <div className="border-t border-gray-100 px-4 pb-4">
            <div className="pt-3 space-y-1">
              {TAREFAS_ONBOARDING.map((tarefa, index) => {
                const marcada = aluno.tarefas[tarefa.id];
                return (
                  <label
                    key={tarefa.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isAdmin ? "cursor-pointer" : "cursor-default"
                    } ${marcada ? "bg-green-50 hover:bg-green-100" : "hover:bg-gray-50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      disabled={!isAdmin}
                      onChange={() => {
                        if (isAdmin) alternarTarefa(aluno.id, tarefa.id);
                      }}
                      className="sr-only"
                    />
                    <div className="flex-shrink-0">
                      {marcada ? (
                        <CheckCircle2 size={20} className="text-green-500" />
                      ) : (
                        <Circle size={20} className="text-gray-300" />
                      )}
                    </div>
                    <span className="flex-shrink-0 text-sm">{tarefa.icone}</span>
                    <span
                      className={`text-sm flex-1 ${
                        marcada ? "text-green-700 line-through" : "text-gray-700"
                      }`}
                    >
                      <span className="text-xs text-gray-400 mr-2">{index + 1}.</span>
                      {tarefa.titulo}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Início de Cadastro header */}
      <div className="flex items-center gap-3">
        <div className="bg-teal-100 text-teal-700 p-2 rounded-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">Onboarding</h2>
          <p className="text-xs text-gray-500">
            {alunosPendentes.length} pendente(s) · {alunosConcluidos.length} concluído(s)
          </p>
        </div>
      </div>

      {/* Alunos pendentes */}
      {alunosPendentes.length === 0 && alunosConcluidos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-16 w-16 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-gray-400 font-medium">Nenhum aluno em onboarding</p>
          <p className="text-gray-300 text-sm">
            Os alunos aparecem aqui automaticamente ao serem matriculados em Admissões.
          </p>
        </div>
      )}

      <div className="space-y-3">{alunosPendentes.map(renderAluno)}</div>

      {/* Concluídos */}
      {alunosConcluidos.length > 0 && (
        <div>
          <button
            onClick={() => setMostrarConcluidos(!mostrarConcluidos)}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors mb-3"
          >
            {mostrarConcluidos ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Concluídos ({alunosConcluidos.length})
          </button>
          {mostrarConcluidos && (
            <div className="space-y-3 opacity-75">{alunosConcluidos.map(renderAluno)}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default OnboardingBoard;
