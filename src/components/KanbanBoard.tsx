import React, { useState } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { ColunaKanban } from '../types';
import { COLUNAS } from '../constants';
import { useLeads } from '../hooks/useLeads';
import KanbanColumn from './KanbanColumn';
import VisitaModal from './VisitaModal';

interface KanbanBoardProps {
  leadsHook: ReturnType<typeof useLeads>;
}

interface PendingVisita {
  leadId: string;
  nomeAluno: string;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ leadsHook }) => {
  const { leads, moverLead, agendarVisita, removerLead, leadsporColuna } = leadsHook;
  const [pendingVisita, setPendingVisita] = useState<PendingVisita | null>(null);

  const onDragEnd = (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination) return;

    const colunaOrigem = source.droppableId as ColunaKanban;
    const novaColuna = destination.droppableId as ColunaKanban;

    if (colunaOrigem === novaColuna) return;

    if (colunaOrigem === 'contato-inicial' && novaColuna === 'visita-marcada') {
      const lead = leads.find((l) => l.id === draggableId);
      if (lead) {
        setPendingVisita({ leadId: draggableId, nomeAluno: lead.nomeAluno });
      }
      return;
    }

    moverLead(draggableId, novaColuna);
  };

  const handleSolicitarVisita = (leadId: string, nomeAluno: string) => {
    setPendingVisita({ leadId, nomeAluno });
  };

  const handleConfirmarVisita = (dataVisita: string, horarioVisita: string) => {
    if (pendingVisita) {
      agendarVisita(pendingVisita.leadId, dataVisita, horarioVisita);
      setPendingVisita(null);
    }
  };

  const handleCancelarVisita = () => {
    setPendingVisita(null);
  };

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 p-4 sm:p-6 overflow-x-auto min-h-[calc(100vh-4rem)]">
          {COLUNAS.map((coluna) => (
            <KanbanColumn
              key={coluna.id}
              coluna={coluna}
              leads={leadsporColuna(coluna.id)}
              onRemover={removerLead}
              onMover={moverLead}
              onSolicitarVisita={handleSolicitarVisita}
            />
          ))}
        </div>
      </DragDropContext>

      {pendingVisita && (
        <VisitaModal
          nomeAluno={pendingVisita.nomeAluno}
          onConfirmar={handleConfirmarVisita}
          onCancelar={handleCancelarVisita}
        />
      )}
    </>
  );
};

export default KanbanBoard;
