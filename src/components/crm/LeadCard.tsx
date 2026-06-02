import React from "react";
import { Draggable } from "@hello-pangea/dnd";
import { Lead, ColunaKanban } from "@/lib/crm/types";
import { COLUNAS } from "@/lib/crm/constants";

interface LeadCardProps {
  lead: Lead;
  index: number;
  onRemover: (id: string) => void;
  onMover: (id: string, coluna: ColunaKanban) => void;
  onSolicitarVisita: (leadId: string, nomeAluno: string) => void;
  onSolicitarNaoMatricula: (leadId: string, nomeAluno: string) => void;
  onSolicitarMatricula: (leadId: string, nomeAluno: string) => void;
  onEditar: (lead: Lead) => void;
  isAdmin?: boolean;
  // Visão Consolidada: exibe a etiqueta da unidade do lead. Nas visões
  // individuais fica oculta.
  consolidado?: boolean;
  schoolNameById?: Record<string, string>;
}

const LeadCard: React.FC<LeadCardProps> = ({
  lead,
  index,
  onRemover,
  onMover,
  onSolicitarVisita,
  onSolicitarNaoMatricula,
  onSolicitarMatricula,
  onEditar,
  isAdmin = false,
  consolidado = false,
  schoolNameById,
}) => {
  const colunaAtualIndex = COLUNAS.findIndex((c) => c.id === lead.coluna);
  const unidadeNome = schoolNameById?.[lead.schoolId];

  const formatarData = (data: string) => {
    if (!data) return "";
    const d = new Date(data + "T00:00:00");
    return d.toLocaleDateString("pt-BR");
  };

  const handleAvancar = () => {
    if (lead.coluna === "contato-inicial") {
      onSolicitarVisita(lead.id, lead.nomeAluno);
    } else if (lead.coluna === "negociacao") {
      onSolicitarMatricula(lead.id, lead.nomeAluno);
    } else if (colunaAtualIndex < COLUNAS.length - 1) {
      const nextCol = COLUNAS[colunaAtualIndex + 1];
      if (nextCol.id === "matricula") {
        onSolicitarMatricula(lead.id, lead.nomeAluno);
      } else if (nextCol.id === "nao-matricula") {
        onSolicitarNaoMatricula(lead.id, lead.nomeAluno);
      } else {
        onMover(lead.id, nextCol.id);
      }
    }
  };

  const handleVoltar = () => {
    if (colunaAtualIndex > 0) {
      onMover(lead.id, COLUNAS[colunaAtualIndex - 1].id);
    }
  };

  const handleNaoMatricula = () => {
    onSolicitarNaoMatricula(lead.id, lead.nomeAluno);
  };

  const isTerminal = lead.coluna === "matricula" || lead.coluna === "nao-matricula";

  return (
    <Draggable draggableId={lead.id} index={index} isDragDisabled={!isAdmin}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 transition-shadow ${
            snapshot.isDragging ? "shadow-xl ring-2 ring-indigo-300 rotate-2" : "hover:shadow-md"
          }`}
        >
          {/* Etiqueta de Unidade (somente na visão Consolidada) */}
          {consolidado && unidadeNome && (
            <div className="mb-2 inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-14h2m-2 4h2m-2 4h2m4-8h2m-2 4h2m-2 4h2"
                />
              </svg>
              {unidadeNome}
            </div>
          )}

          {/* Selo Matriculado */}
          {lead.coluna === "matricula" && lead.itensMatricula && (
            <div className="mb-2 inline-flex items-center gap-1 bg-green-100 border border-green-300 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <span>✅</span> Matriculado
            </div>
          )}

          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-gray-800 text-sm leading-tight">{lead.nomeAluno}</h3>
            {isAdmin && (
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                <button
                  onClick={() => onEditar(lead)}
                  className="text-gray-300 hover:text-indigo-500 transition-colors"
                  title="Editar lead"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => onRemover(lead.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                  title="Remover lead"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1.5 text-xs text-gray-500">
            {lead.idade && (
              <div className="flex items-center gap-1.5">
                <span>🎂</span>
                <span>
                  {lead.idade} {lead.idade === "1" ? "ano" : "anos"}
                </span>
                {lead.dataNascimento && (
                  <span className="text-gray-400">· {formatarData(lead.dataNascimento)}</span>
                )}
              </div>
            )}
            {lead.turma && (
              <div className="flex items-center gap-1.5">
                <span>🎓</span>
                <span className="font-medium text-indigo-600">{lead.turma}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span>👤</span>
              <span className="truncate">{lead.nomePaiMae}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>📱</span>
              <span>{lead.telefone}</span>
            </div>
            {lead.origem && (
              <div className="flex items-center gap-1.5">
                <span>📣</span>
                <span className="font-medium text-purple-600">{lead.origem}</span>
              </div>
            )}
          </div>

          {lead.dataVisita && lead.horarioVisita && (
            <div className="mt-2 flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <span className="text-sm">📅</span>
              <span className="text-xs font-medium text-amber-700">
                {formatarData(lead.dataVisita)} às {lead.horarioVisita}
              </span>
            </div>
          )}

          {/* Tag motivo de perda */}
          {lead.motivoPerda && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">🚫</span>
                <span className="text-xs font-medium text-red-700">{lead.motivoPerda}</span>
              </div>
              {lead.observacaoPerda && (
                <p className="text-xs text-red-600 mt-1 italic">{lead.observacaoPerda}</p>
              )}
            </div>
          )}

          {/* Itens de matrícula resumo */}
          {lead.itensMatricula && lead.itensMatricula.length > 0 && (
            <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">💰</span>
                <span className="text-xs font-medium text-green-700">
                  R${" "}
                  {lead.itensMatricula
                    .reduce((sum, item) => sum + (item.valor || 0), 0)
                    .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="text-xs text-green-600">
                {lead.itensMatricula.map((item) => item.tipo).join(", ")}
              </div>
            </div>
          )}

          {!isTerminal && isAdmin && (
            <div className="flex gap-1 mt-3 pt-2 border-t border-gray-50">
              {colunaAtualIndex > 0 && (
                <button
                  onClick={handleVoltar}
                  className="flex-1 text-xs py-1 px-2 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                  title={`Mover para ${COLUNAS[colunaAtualIndex - 1].titulo}`}
                >
                  ← Voltar
                </button>
              )}
              {lead.coluna === "negociacao" ? (
                <>
                  <button
                    onClick={handleAvancar}
                    className="flex-1 text-xs py-1 px-2 rounded-md bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 transition-colors font-medium"
                    title="Matricular"
                  >
                    ✅ Matricular
                  </button>
                  <button
                    onClick={handleNaoMatricula}
                    className="flex-1 text-xs py-1 px-2 rounded-md bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 transition-colors font-medium"
                    title="Não Matrícula"
                  >
                    ❌ Não Matr.
                  </button>
                </>
              ) : (
                <button
                  onClick={handleAvancar}
                  className="flex-1 text-xs py-1 px-2 rounded-md bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors font-medium"
                  title={
                    colunaAtualIndex < COLUNAS.length - 1
                      ? `Mover para ${COLUNAS[colunaAtualIndex + 1].titulo}`
                      : ""
                  }
                >
                  Avançar →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
};

export default LeadCard;
