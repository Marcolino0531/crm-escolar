import React, { useState } from "react";
import { ItemMatricula } from "@/lib/crm/types";

const ITENS_DISPONIVEIS = [
  "Matrícula",
  "Mensalidade",
  "Hora extra",
  "Lanche da manhã",
  "Lanche da tarde",
  "Almoço",
  "Jantar",
  "Material Pedagógico",
];

interface MatriculaModalProps {
  nomeAluno: string;
  onConfirmar: (itens: ItemMatricula[]) => void;
  onCancelar: () => void;
}

const MatriculaModal: React.FC<MatriculaModalProps> = ({ nomeAluno, onConfirmar, onCancelar }) => {
  const [itens, setItens] = useState<ItemMatricula[]>([]);

  const adicionarItem = () => {
    setItens((prev) => [...prev, { id: crypto.randomUUID(), tipo: "", valor: undefined }]);
  };

  const atualizarItem = (id: string, campo: Partial<ItemMatricula>) => {
    setItens((prev) => prev.map((item) => (item.id === id ? { ...item, ...campo } : item)));
  };

  const removerItem = (id: string) => {
    setItens((prev) => prev.filter((item) => item.id !== id));
  };

  const handleTipoChange = (id: string, tipo: string) => {
    if (tipo === "Material Pedagógico") {
      atualizarItem(id, { tipo, valor: undefined, materialPedagogico: false, observacoes: "" });
    } else {
      atualizarItem(id, {
        tipo,
        valor: undefined,
        materialPedagogico: undefined,
        observacoes: undefined,
      });
    }
  };

  const formatarMoeda = (valor: number | undefined): string => {
    if (valor === undefined || isNaN(valor)) return "";
    return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleValorChange = (id: string, valorStr: string) => {
    const limpo = valorStr.replace(/[^\d,]/g, "").replace(",", ".");
    const valor = limpo ? parseFloat(limpo) : undefined;
    atualizarItem(id, { valor });
  };

  const calcularTotal = (): number => {
    return itens.reduce((total, item) => {
      if (item.tipo !== "Material Pedagógico" && item.valor) {
        return total + item.valor;
      }
      return total;
    }, 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (itens.length === 0) return;
    const itensValidos = itens.every((item) => {
      if (!item.tipo) return false;
      if (item.tipo !== "Material Pedagógico" && (!item.valor || item.valor <= 0)) return false;
      return true;
    });
    if (!itensValidos) return;
    onConfirmar(itens);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">💰</span>
              <h2 className="text-white text-lg font-bold">Composição de Valores</h2>
            </div>
            <button
              onClick={onCancelar}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <p className="text-sm text-gray-600">
            Defina os valores para a matrícula de{" "}
            <span className="font-semibold text-gray-800">{nomeAluno}</span>.
          </p>

          <div className="space-y-3">
            {itens.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50"
              >
                <div className="flex items-center gap-2">
                  <select
                    value={item.tipo}
                    onChange={(e) => handleTipoChange(item.id, e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm bg-white"
                  >
                    <option value="">Selecione o item...</option>
                    {ITENS_DISPONIVEIS.map((opcao) => (
                      <option key={opcao} value={opcao}>
                        {opcao}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removerItem(item.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    title="Remover item"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
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

                {item.tipo && item.tipo !== "Material Pedagógico" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-medium">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.valor ?? ""}
                      onChange={(e) => handleValorChange(item.id, e.target.value)}
                      placeholder="0,00"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm"
                    />
                  </div>
                )}

                {item.tipo === "Material Pedagógico" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">Incluir?</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`mp-${item.id}`}
                          checked={item.materialPedagogico === true}
                          onChange={() => atualizarItem(item.id, { materialPedagogico: true })}
                          className="text-green-500 focus:ring-green-500"
                        />
                        <span className="text-sm">Sim</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`mp-${item.id}`}
                          checked={item.materialPedagogico === false}
                          onChange={() => atualizarItem(item.id, { materialPedagogico: false })}
                          className="text-red-500 focus:ring-red-500"
                        />
                        <span className="text-sm">Não</span>
                      </label>
                    </div>
                    <textarea
                      value={item.observacoes ?? ""}
                      onChange={(e) => atualizarItem(item.id, { observacoes: e.target.value })}
                      placeholder="Observações..."
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-sm resize-none"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={adicionarItem}
            className="w-full py-2.5 border-2 border-dashed border-green-300 text-green-600 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors text-sm font-medium flex items-center justify-center gap-1"
          >
            <span className="text-lg">+</span> Adicionar Item
          </button>

          {itens.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-medium text-green-700">Total:</span>
              <span className="text-lg font-bold text-green-800">
                R$ {formatarMoeda(calcularTotal())}
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancelar}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={itens.length === 0}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg hover:from-green-600 hover:to-emerald-600 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirmar Matrícula
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MatriculaModal;
