import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { OnboardingAluno, ColunaOnboarding } from '../types';
import { COLUNAS_ONBOARDING } from '../constants';

interface OnboardingCardProps {
  aluno: OnboardingAluno;
  index: number;
  onMover: (id: string, coluna: ColunaOnboarding) => void;
}

const OnboardingCard: React.FC<OnboardingCardProps> = ({ aluno, index, onMover }) => {
  const colunaAtualIndex = COLUNAS_ONBOARDING.findIndex((c) => c.id === aluno.coluna);
  const isConcluido = aluno.coluna === 'concluido';

  const handleAvancar = () => {
    if (colunaAtualIndex < COLUNAS_ONBOARDING.length - 1) {
      onMover(aluno.id, COLUNAS_ONBOARDING[colunaAtualIndex + 1].id);
    }
  };

  const handleVoltar = () => {
    if (colunaAtualIndex > 0) {
      onMover(aluno.id, COLUNAS_ONBOARDING[colunaAtualIndex - 1].id);
    }
  };

  return (
    <Draggable draggableId={aluno.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 transition-shadow ${
            snapshot.isDragging
              ? 'shadow-xl ring-2 ring-teal-300 rotate-2'
              : 'hover:shadow-md'
          }`}
        >
          {isConcluido && (
            <div className="mb-2 inline-flex items-center gap-1 bg-green-100 border border-green-300 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <span>✅</span> Concluído
            </div>
          )}

          <h3 className="font-semibold text-gray-800 text-sm leading-tight mb-2">
            {aluno.nomeAluno}
          </h3>

          <div className="space-y-1.5 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <span>🎓</span>
              <span className="font-medium text-indigo-600">{aluno.turma}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>👤</span>
              <span className="truncate">{aluno.nomePaiMae}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>📱</span>
              <span>{aluno.telefone}</span>
            </div>
          </div>

          {!isConcluido && (
            <div className="flex gap-1 mt-3 pt-2 border-t border-gray-50">
              {colunaAtualIndex > 0 && (
                <button
                  onClick={handleVoltar}
                  className="flex-1 text-xs py-1 px-2 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                  title={`Mover para ${COLUNAS_ONBOARDING[colunaAtualIndex - 1].titulo}`}
                >
                  ← Voltar
                </button>
              )}
              <button
                onClick={handleAvancar}
                className="flex-1 text-xs py-1 px-2 rounded-md bg-teal-50 text-teal-600 hover:bg-teal-100 hover:text-teal-700 transition-colors font-medium"
                title={
                  colunaAtualIndex < COLUNAS_ONBOARDING.length - 1
                    ? `Mover para ${COLUNAS_ONBOARDING[colunaAtualIndex + 1].titulo}`
                    : ''
                }
              >
                Avançar →
              </button>
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
};

export default OnboardingCard;
