import React from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { ColunaKanban } from '../types';
import { COLUNAS } from '../constants';
import { useLeads } from '../hooks/useLeads';
import KanbanColumn from './KanbanColumn';

interface KanbanBoardProps {
  leadsHook: ReturnType<typeof useLeads>;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ leadsHook }) => {
  const { moverLead, removerLead, leadsporColuna } = leadsHook;

  const onDragEnd = (result: DropResult) => {
    const { draggableId, destination } = result;
    if (!destination) return;
    const novaColuna = destination.droppableId as ColunaKanban;
    moverLead(draggableId, novaColuna);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 p-4 sm:p-6 overflow-x-auto min-h-[calc(100vh-4rem)]">
        {COLUNAS.map((coluna) => (
          <KanbanColumn
            key={coluna.id}
            coluna={coluna}
            leads={leadsporColuna(coluna.id)}
            onRemover={removerLead}
            onMover={moverLead}
          />
        ))}
      </div>
    </DragDropContext>
  );
};

export default KanbanBoard;
