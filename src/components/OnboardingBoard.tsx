import React from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { ColunaOnboarding } from '../types';
import { COLUNAS_ONBOARDING } from '../constants';
import { useOnboarding } from '../hooks/useOnboarding';
import OnboardingCard from './OnboardingCard';

interface OnboardingBoardProps {
  onboardingHook: ReturnType<typeof useOnboarding>;
}

const OnboardingBoard: React.FC<OnboardingBoardProps> = ({ onboardingHook }) => {
  const { moverAluno, alunosPorColuna } = onboardingHook;

  const onDragEnd = (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination) return;

    const colunaOrigem = source.droppableId as ColunaOnboarding;
    const novaColuna = destination.droppableId as ColunaOnboarding;

    if (colunaOrigem === novaColuna) return;

    moverAluno(draggableId, novaColuna);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 p-4 sm:p-6 overflow-x-auto h-full">
        {COLUNAS_ONBOARDING.map((coluna) => {
          const alunosColuna = alunosPorColuna(coluna.id);
          return (
            <div
              key={coluna.id}
              className="flex-shrink-0 w-60"
            >
              <div className={`rounded-xl border-t-4 ${coluna.corBorda} ${coluna.corFundo} p-3 h-full`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span>{coluna.icone}</span>
                    <h2 className={`font-bold text-sm ${coluna.cor}`}>
                      {coluna.titulo}
                    </h2>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${coluna.corFundo} ${coluna.cor}`}>
                    {alunosColuna.length}
                  </span>
                </div>

                <Droppable droppableId={coluna.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`min-h-[200px] rounded-lg transition-colors ${
                        snapshot.isDraggingOver ? 'bg-teal-100/50' : ''
                      }`}
                    >
                      {alunosColuna.length === 0 && !snapshot.isDraggingOver && (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-8 w-8 mb-2"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <span className="text-xs">Arraste alunos aqui</span>
                        </div>
                      )}
                      {alunosColuna.map((aluno, index) => (
                        <OnboardingCard
                          key={aluno.id}
                          aluno={aluno}
                          index={index}
                          onMover={moverAluno}
                        />
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
};

export default OnboardingBoard;
