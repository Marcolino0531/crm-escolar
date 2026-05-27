import React from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { Lead, ColunaKanban, ColunaConfig } from '../types';
import LeadCard from './LeadCard';

interface KanbanColumnProps {
  coluna: ColunaConfig;
  leads: Lead[];
  onRemover: (id: string) => void;
  onMover: (id: string, coluna: ColunaKanban) => void;
  onSolicitarVisita: (leadId: string, nomeAluno: string) => void;
  onSolicitarNaoMatricula: (leadId: string, nomeAluno: string) => void;
  onSolicitarMatricula: (leadId: string, nomeAluno: string) => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  coluna,
  leads,
  onRemover,
  onMover,
  onSolicitarVisita,
  onSolicitarNaoMatricula,
  onSolicitarMatricula,
}) => {
  return (
    <div className="flex flex-col min-w-[220px] w-[220px] lg:w-auto lg:flex-1">
      <div
        className={`flex items-center justify-between px-4 py-3 rounded-t-xl border-t-4 ${coluna.corBorda} ${coluna.corFundo}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{coluna.icone}</span>
          <h2 className={`font-bold text-sm ${coluna.cor}`}>{coluna.titulo}</h2>
        </div>
        <span
          className={`${coluna.cor} bg-white/80 text-xs font-bold px-2 py-0.5 rounded-full`}
        >
          {leads.length}
        </span>
      </div>

      <Droppable droppableId={coluna.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 p-3 rounded-b-xl min-h-[200px] transition-colors ${
              snapshot.isDraggingOver
                ? 'bg-indigo-50/50 ring-2 ring-indigo-200 ring-inset'
                : 'bg-gray-50/50'
            }`}
          >
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex flex-col items-center justify-center h-32 text-gray-300">
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
                    d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
                <p className="text-xs">Arraste leads aqui</p>
              </div>
            )}
            {leads.map((lead, index) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                index={index}
                onRemover={onRemover}
                onMover={onMover}
                onSolicitarVisita={onSolicitarVisita}
                onSolicitarNaoMatricula={onSolicitarNaoMatricula}
                onSolicitarMatricula={onSolicitarMatricula}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
};

export default KanbanColumn;
