import React, { useState } from 'react';
import { Unidade, Funcionario } from '../types';
import { useRH } from '../hooks/useRH';
import FuncionarioModal from './FuncionarioModal';

interface RHPageProps {
  rhHook: ReturnType<typeof useRH>;
  unidadeSelecionada: Unidade;
}

const converterParaBR = (dataISO: string): string => {
  if (!dataISO) return '';
  const partes = dataISO.split('-');
  if (partes.length !== 3) return '';
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const RHPage: React.FC<RHPageProps> = ({ rhHook, unidadeSelecionada }) => {
  const { funcionarios, adicionarFuncionario, removerFuncionario, adicionarFerias, removerFerias } = rhHook;
  const [modalAberto, setModalAberto] = useState(false);
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<Funcionario | null>(null);

  const handleSalvar = (dados: Omit<Funcionario, 'id' | 'ferias' | 'criadoEm'>) => {
    adicionarFuncionario(dados);
    setModalAberto(false);
  };

  const handleClickFuncionario = (funcionario: Funcionario) => {
    setFuncionarioSelecionado(funcionario);
  };

  const handleFecharDetalhes = () => {
    setFuncionarioSelecionado(null);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Funcionários — {unidadeSelecionada}</h2>
          <p className="text-sm text-gray-500">{funcionarios.length} funcionário(s) cadastrado(s)</p>
        </div>
        <button
          onClick={() => setModalAberto(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md"
        >
          <span>+</span>
          Novo Funcionário
        </button>
      </div>

      {funcionarios.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <span className="text-5xl mb-4">👤</span>
          <p className="text-lg font-medium">Nenhum funcionário cadastrado</p>
          <p className="text-sm">Clique em "Novo Funcionário" para começar.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cargo</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Admissão</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Horário</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {funcionarios.map((func) => (
                  <tr
                    key={func.id}
                    onClick={() => handleClickFuncionario(func)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                          <span className="text-emerald-600 text-sm font-bold">
                            {func.nomeCompleto.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-800">{func.nomeCompleto}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{func.cargo}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{converterParaBR(func.dataAdmissao)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {func.horarioTrabalhoInicio} às {func.horarioTrabalhoFim}
                    </td>
                    <td className="px-4 py-3">
                      {func.dataRescisao ? (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">
                          Desligado
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full font-medium">
                          Ativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Remover ${func.nomeCompleto}?`)) {
                            removerFuncionario(func.id);
                          }
                        }}
                        className="text-red-400 hover:text-red-600 text-xs font-medium"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalAberto && (
        <FuncionarioModal
          unidadeSelecionada={unidadeSelecionada}
          onSalvar={handleSalvar}
          onFechar={() => setModalAberto(false)}
        />
      )}

      {funcionarioSelecionado && (
        <FuncionarioModal
          unidadeSelecionada={unidadeSelecionada}
          funcionarioExistente={funcionarioSelecionado}
          onSalvar={() => {}}
          onFechar={handleFecharDetalhes}
          onAdicionarFerias={adicionarFerias}
          onRemoverFerias={removerFerias}
        />
      )}
    </div>
  );
};

export default RHPage;
