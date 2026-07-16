import React from "react";
import { Draggable } from "@hello-pangea/dnd";
import { Lead, ColunaKanban } from "@/lib/crm/types";
import { COLUNAS } from "@/lib/crm/constants";
import { displayPhoneBR, toWhatsAppNumber } from "@/lib/phone";

interface LeadCardProps {
  lead: Lead;
  index: number;
  onRemover: (id: string) => void;
  onMover: (id: string, coluna: ColunaKanban) => void;
  onSolicitarVisita: (leadId: string, nomeAluno: string) => void;
  onSolicitarNaoMatricula: (leadId: string, nomeAluno: string) => void;
  onSolicitarMatricula: (leadId: string, nomeAluno: string) => void;
  onAvancarParaOnboarding?: (leadId: string, nomeAluno: string) => void;
  onEditar: (lead: Lead) => void;
  isAdmin?: boolean;
  // Visão Consolidada: exibe a etiqueta da unidade do lead. Nas visões
  // individuais fica oculta.
  consolidado?: boolean;
  schoolNameById?: Record<string, string>;
  unidadeNome?: string;
}

const LeadCard: React.FC<LeadCardProps> = ({
  lead,
  index,
  onRemover,
  onMover,
  onSolicitarVisita,
  onSolicitarNaoMatricula,
  onSolicitarMatricula,
  onAvancarParaOnboarding,
  onEditar,
  isAdmin = false,
  consolidado = false,
  schoolNameById,
  unidadeNome,
}) => {
  const colunaAtualIndex = COLUNAS.findIndex((c) => c.id === lead.coluna);
  const unidadeNomeBadge = schoolNameById?.[lead.schoolId];

  const whatsappNumero = toWhatsAppNumber(lead.telefone);
  const whatsappLink = whatsappNumero
    ? `https://wa.me/${whatsappNumero}?text=${encodeURIComponent(
        "Olá, meu nome é Charline e sou coordenadora do Colégio CEC. Vimos o seu interesse no colégio e estou à disposição.",
      )}`
    : "";

  const formatarData = (data: string) => {
    if (!data) return "";
    const d = new Date(data + "T00:00:00");
    return d.toLocaleDateString("pt-BR");
  };

  const formatarDataCriacao = (data: string) => {
    if (!data) return "";
    const d = new Date(data);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("pt-BR");
  };

  const handleAvancar = () => {
    if (colunaAtualIndex < 0 || colunaAtualIndex >= COLUNAS.length - 1) return;
    const nextCol = COLUNAS[colunaAtualIndex + 1];
    if (nextCol.id === "visita-marcada") {
      onSolicitarVisita(lead.id, lead.nomeAluno);
    } else if (nextCol.id === "matricula") {
      onSolicitarMatricula(lead.id, lead.nomeAluno);
    } else if (nextCol.id === "nao-matricula") {
      onSolicitarNaoMatricula(lead.id, lead.nomeAluno);
    } else {
      onMover(lead.id, nextCol.id);
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

  const handleAvancarOnboarding = () => {
    if (!onAvancarParaOnboarding) return;
    const ok = window.confirm(
      `Avançar ${lead.nomeAluno} para o Onboarding? O cartão será arquivado e sairá do funil (o histórico é preservado).`,
    );
    if (ok) onAvancarParaOnboarding(lead.id, lead.nomeAluno);
  };

  return (
    <Draggable draggableId={lead.id} index={index} isDragDisabled={!isAdmin || lead.arquivado}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-white rounded-xl shadow-sm border p-4 mb-3 transition-shadow ${
            lead.arquivado ? "border-dashed border-gray-300 opacity-60" : "border-gray-100"
          } ${snapshot.isDragging ? "shadow-xl ring-2 ring-indigo-300 rotate-2" : "hover:shadow-md"}`}
        >
          {/* Etiqueta de lead arquivado */}
          {lead.arquivado && (
            <div className="mb-2 inline-flex items-center gap-1 bg-gray-200 border border-gray-300 text-gray-600 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">
              <span>📦</span> Arquivado
            </div>
          )}
          {/* Etiqueta de Unidade (somente na visão Consolidada) */}
          {consolidado && unidadeNomeBadge && (
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
              {unidadeNomeBadge}
            </div>
          )}

          {/* Selo Matriculado */}
          {lead.coluna === "matricula" && lead.itensMatricula && (
            <div className="mb-2 inline-flex items-center gap-1 bg-green-100 border border-green-300 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <span>✅</span> Matriculado
            </div>
          )}

          {/* Badge irmãos (mais de um aluno na mesma negociação) */}
          {lead.alunos.length > 1 && (
            <div className="mb-2 inline-flex items-center gap-1 bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">
              <span>👨‍👩‍👧</span> {lead.alunos.length} alunos (irmãos)
            </div>
          )}

          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-gray-800 text-sm leading-tight">
              {lead.alunos.length > 1 ? `Família ${lead.nomePaiMae}` : lead.nomeAluno}
            </h3>
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
            {lead.alunos.length > 1 ? (
              <div className="space-y-1.5">
                {lead.alunos.map((aluno, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5"
                  >
                    <div className="font-semibold text-gray-700">{aluno.nome}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {aluno.idade && (
                        <span>
                          🎂 {aluno.idade} {aluno.idade === "1" ? "ano" : "anos"}
                        </span>
                      )}
                      {aluno.turma && (
                        <span className="font-medium text-indigo-600">🎓 {aluno.turma}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
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
              </>
            )}
            <div className="flex items-center gap-1.5">
              <span>👤</span>
              <span className="truncate">{lead.nomePaiMae}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>📱</span>
              <span>{displayPhoneBR(lead.telefone)}</span>
              {whatsappLink && (
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Conversar no WhatsApp"
                  aria-label="Conversar no WhatsApp"
                  className="ml-1 inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5d] transition-colors flex-shrink-0"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.36.101 11.945c0 2.096.547 4.142 1.588 5.945L0 24l6.305-1.654a11.95 11.95 0 005.71 1.454h.005c6.582 0 11.945-5.36 11.948-11.945a11.88 11.88 0 00-3.48-8.418z" />
                  </svg>
                </a>
              )}
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

          {/* Itens de matrícula — detalhamento item a item */}
          {lead.itensMatricula && lead.itensMatricula.length > 0 && (
            <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
              <ul className="space-y-1">
                {lead.itensMatricula.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                      <span className="text-sm">💰</span>
                      {item.tipo}
                    </span>
                    <span className="text-xs font-semibold text-green-700 whitespace-nowrap">
                      R${" "}
                      {(item.valor || 0).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 pt-1.5 border-t border-green-200 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-green-800">Total</span>
                <span className="text-xs font-bold text-green-800 whitespace-nowrap">
                  R${" "}
                  {lead.itensMatricula
                    .reduce((sum, item) => sum + (item.valor || 0), 0)
                    .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* Data de criação do lead */}
          {lead.criadoEm && formatarDataCriacao(lead.criadoEm) && (
            <div className="mt-2 flex items-center gap-1 text-[10px] text-gray-400">
              <span>🗓️</span>
              <span>Criado em: {formatarDataCriacao(lead.criadoEm)}</span>
            </div>
          )}

          {lead.coluna === "matricula" && isAdmin && !lead.arquivado && onAvancarParaOnboarding && (
            <div className="mt-3 pt-2 border-t border-gray-50">
              <button
                onClick={handleAvancarOnboarding}
                className="w-full text-xs py-1.5 px-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-semibold"
                title="Enviar para o Onboarding e arquivar o cartão"
              >
                Avançar para Onboarding →
              </button>
            </div>
          )}

          {!isTerminal && isAdmin && !lead.arquivado && (
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
