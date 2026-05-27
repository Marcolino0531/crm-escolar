import React, { useState } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { ColunaKanban, ItemMatricula } from '../types';
import { COLUNAS } from '../constants';
import { useLeads } from '../hooks/useLeads';
import KanbanColumn from './KanbanColumn';
import VisitaModal from './VisitaModal';
import NaoMatriculaModal from './NaoMatriculaModal';
import MatriculaModal from './MatriculaModal';

interface KanbanBoardProps {
  leadsHook: ReturnType<typeof useLeads>;
}

interface PendingAction {
  leadId: string;
  nomeAluno: string;
  colunaOrigem: ColunaKanban;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ leadsHook }) => {
  const {
    leads,
    moverLead,
    agendarVisita,
    registrarNaoMatricula,
    registrarMatricula,
    removerLead,
    leadsporColuna,
  } = leadsHook;

  const [pendingVisita, setPendingVisita] = useState<PendingAction | null>(null);
  const [pendingNaoMatricula, setPendingNaoMatricula] = useState<PendingAction | null>(null);
  const [pendingMatricula, setPendingMatricula] = useState<PendingAction | null>(null);

  const onDragEnd = (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination) return;

    const colunaOrigem = source.droppableId as ColunaKanban;
    const novaColuna = destination.droppableId as ColunaKanban;

    if (colunaOrigem === novaColuna) return;

    const lead = leads.find((l) => l.id === draggableId);
    if (!lead) return;

    if (colunaOrigem === 'contato-inicial' && novaColuna === 'visita-marcada') {
      setPendingVisita({ leadId: draggableId, nomeAluno: lead.nomeAluno, colunaOrigem });
      return;
    }

    if (novaColuna === 'nao-matricula') {
      setPendingNaoMatricula({ leadId: draggableId, nomeAluno: lead.nomeAluno, colunaOrigem });
      return;
    }

    if (novaColuna === 'matricula') {
      setPendingMatricula({ leadId: draggableId, nomeAluno: lead.nomeAluno, colunaOrigem });
      return;
    }

    moverLead(draggableId, novaColuna);
  };

  const handleSolicitarVisita = (leadId: string, nomeAluno: string) => {
    setPendingVisita({ leadId, nomeAluno, colunaOrigem: 'contato-inicial' });
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

  const handleSolicitarNaoMatricula = (leadId: string, nomeAluno: string) => {
    const lead = leads.find((l) => l.id === leadId);
    setPendingNaoMatricula({ leadId, nomeAluno, colunaOrigem: lead?.coluna || 'negociacao' });
  };

  const handleConfirmarNaoMatricula = (motivo: string, observacao?: string) => {
    if (pendingNaoMatricula) {
      registrarNaoMatricula(pendingNaoMatricula.leadId, motivo, observacao);
      setPendingNaoMatricula(null);
    }
  };

  const handleCancelarNaoMatricula = () => {
    setPendingNaoMatricula(null);
  };

  const handleSolicitarMatricula = (leadId: string, nomeAluno: string) => {
    const lead = leads.find((l) => l.id === leadId);
    setPendingMatricula({ leadId, nomeAluno, colunaOrigem: lead?.coluna || 'negociacao' });
  };

  const handleConfirmarMatricula = (itens: ItemMatricula[]) => {
    if (pendingMatricula) {
      registrarMatricula(pendingMatricula.leadId, itens);
      setPendingMatricula(null);
    }
  };

  const handleCancelarMatricula = () => {
    setPendingMatricula(null);
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
              onSolicitarNaoMatricula={handleSolicitarNaoMatricula}
              onSolicitarMatricula={handleSolicitarMatricula}
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

      {pendingNaoMatricula && (
        <NaoMatriculaModal
          nomeAluno={pendingNaoMatricula.nomeAluno}
          onConfirmar={handleConfirmarNaoMatricula}
          onCancelar={handleCancelarNaoMatricula}
        />
      )}

      {pendingMatricula && (
        <MatriculaModal
          nomeAluno={pendingMatricula.nomeAluno}
          onConfirmar={handleConfirmarMatricula}
          onCancelar={handleCancelarMatricula}
        />
      )}
    </>
  );
};

export default KanbanBoard;
