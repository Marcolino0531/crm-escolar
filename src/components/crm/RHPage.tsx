import React, { useState } from "react";
import { Unidade, Funcionario, Genero, EstadoCivil } from "@/lib/crm/types";
import { useFuncionarios } from "@/lib/crm/hooks";
import FuncionarioModal from "./FuncionarioModal";

interface RHPageProps {
  rhHook: ReturnType<typeof useFuncionarios>;
  unidadeSelecionada: Unidade;
}

const converterParaBR = (dataISO: string): string => {
  if (!dataISO) return "";
  const partes = dataISO.split("-");
  if (partes.length !== 3) return "";
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const generoLabel = (g?: Genero): string => {
  const map: Record<Genero, string> = {
    feminino: "Feminino",
    masculino: "Masculino",
    outro: "Outro",
    "prefiro-nao-informar": "Prefiro não informar",
  };
  return g ? map[g] || "" : "";
};

const estadoCivilLabel = (e?: EstadoCivil): string => {
  const map: Record<EstadoCivil, string> = {
    solteiro: "Solteiro(a)",
    casado: "Casado(a)",
    divorciado: "Divorciado(a)",
    viuvo: "Viúvo(a)",
    outro: "Outro",
  };
  return e ? map[e] || "" : "";
};

interface ColunaExport {
  id: string;
  label: string;
  getValue: (f: Funcionario) => string;
}

const COLUNAS_EXPORT: ColunaExport[] = [
  { id: "nomeCompleto", label: "Nome", getValue: (f) => f.nomeCompleto },
  { id: "cpf", label: "CPF", getValue: (f) => f.cpf || "" },
  {
    id: "dataNascimento",
    label: "Data de Nascimento",
    getValue: (f) => converterParaBR(f.dataNascimento || ""),
  },
  { id: "cargo", label: "Cargo", getValue: (f) => f.cargo || "" },
  { id: "genero", label: "Gênero", getValue: (f) => generoLabel(f.genero) },
  { id: "estadoCivil", label: "Estado Civil", getValue: (f) => estadoCivilLabel(f.estadoCivil) },
  { id: "unidade", label: "Unidade", getValue: (f) => f.unidade },
  {
    id: "dataAdmissao",
    label: "Data de Admissão",
    getValue: (f) => converterParaBR(f.dataAdmissao || ""),
  },
  {
    id: "dataInicio",
    label: "Data de Início",
    getValue: (f) => converterParaBR(f.dataInicio || ""),
  },
  {
    id: "dataRescisao",
    label: "Data de Rescisão",
    getValue: (f) => converterParaBR(f.dataRescisao || ""),
  },
  {
    id: "horarioTrabalho",
    label: "Horário de Trabalho",
    getValue: (f) => `${f.horarioTrabalhoInicio} às ${f.horarioTrabalhoFim}`,
  },
  {
    id: "horarioAlmoco",
    label: "Horário de Almoço",
    getValue: (f) =>
      f.horarioAlmocoInicio && f.horarioAlmocoFim
        ? `${f.horarioAlmocoInicio} às ${f.horarioAlmocoFim}`
        : "",
  },
  { id: "status", label: "Status", getValue: (f) => (f.dataRescisao ? "Desligado" : "Ativo") },
];

const gerarCSV = (funcionarios: Funcionario[], colunasIds: string[]): string => {
  const colunas = COLUNAS_EXPORT.filter((c) => colunasIds.includes(c.id));
  const header = colunas.map((c) => `"${c.label}"`).join(",");
  const rows = funcionarios.map((f) =>
    colunas
      .map((c) => {
        const val = c.getValue(f);
        return `"${val.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  return [header, ...rows].join("\n");
};

const downloadCSV = (csv: string, filename: string) => {
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const RHPage: React.FC<RHPageProps> = ({ rhHook, unidadeSelecionada }) => {
  const { funcionarios, adicionarFuncionario, removerFuncionario, adicionarFerias, removerFerias } =
    rhHook;
  const [modalAberto, setModalAberto] = useState(false);
  const [funcionarioSelecionadoId, setFuncionarioSelecionadoId] = useState<string | null>(null);
  const [exportModalAberto, setExportModalAberto] = useState(false);
  const [colunasExport, setColunasExport] = useState<string[]>(COLUNAS_EXPORT.map((c) => c.id));

  const funcionarioSelecionado = funcionarioSelecionadoId
    ? funcionarios.find((f) => f.id === funcionarioSelecionadoId) || null
    : null;

  const handleSalvar = (dados: Omit<Funcionario, "id" | "ferias" | "criadoEm" | "schoolId">) => {
    adicionarFuncionario(dados);
    setModalAberto(false);
  };

  const handleClickFuncionario = (funcionario: Funcionario) => {
    setFuncionarioSelecionadoId(funcionario.id);
  };

  const handleFecharDetalhes = () => {
    setFuncionarioSelecionadoId(null);
  };

  const toggleColunaExport = (id: string) => {
    setColunasExport((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const marcarTodos = () => {
    setColunasExport(COLUNAS_EXPORT.map((c) => c.id));
  };

  const handleGerarPlanilha = () => {
    if (colunasExport.length === 0) return;
    const csv = gerarCSV(funcionarios, colunasExport);
    const filename = `funcionarios-${unidadeSelecionada.replace(/\s+/g, "-").toLowerCase()}.csv`;
    downloadCSV(csv, filename);
    setExportModalAberto(false);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Funcionários — {unidadeSelecionada}</h2>
          <p className="text-sm text-gray-500">
            {funcionarios.length} funcionário(s) cadastrado(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExportModalAberto(true)}
            disabled={funcionarios.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Exportar Planilha
          </button>
          <button
            onClick={() => setModalAberto(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md"
          >
            <span>+</span>
            Novo Funcionário
          </button>
        </div>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Nome
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    CPF
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Cargo
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Admissão
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Horário
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Ações
                  </th>
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
                        <span className="text-sm font-medium text-gray-800">
                          {func.nomeCompleto}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{func.cpf || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{func.cargo || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {converterParaBR(func.dataAdmissao || "")}
                    </td>
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

      {/* Export Modal */}
      {exportModalAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <h2 className="text-white text-lg font-bold">Escolha os dados para exportar</h2>
                </div>
                <button
                  onClick={() => setExportModalAberto(false)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500">
                  {colunasExport.length} de {COLUNAS_EXPORT.length} colunas selecionadas
                </p>
                <button
                  type="button"
                  onClick={marcarTodos}
                  className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 font-medium transition-colors"
                >
                  Marcar todos
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {COLUNAS_EXPORT.map((col) => (
                  <label
                    key={col.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={colunasExport.includes(col.id)}
                      onChange={() => toggleColunaExport(col.id)}
                      className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-700">{col.label}</span>
                  </label>
                ))}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setExportModalAberto(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGerarPlanilha}
                  disabled={colunasExport.length === 0}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Gerar Planilha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RHPage;
