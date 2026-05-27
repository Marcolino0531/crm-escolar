import React, { useState } from 'react';

interface VisitaModalProps {
  nomeAluno: string;
  onConfirmar: (dataVisita: string, horarioVisita: string) => void;
  onCancelar: () => void;
}

const VisitaModal: React.FC<VisitaModalProps> = ({
  nomeAluno,
  onConfirmar,
  onCancelar,
}) => {
  const [dataVisita, setDataVisita] = useState('');
  const [horarioVisita, setHorarioVisita] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dataVisita || !horarioVisita) return;
    onConfirmar(dataVisita, horarioVisita);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📅</span>
              <h2 className="text-white text-lg font-bold">Agendar Visita</h2>
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Agende a visita de <span className="font-semibold text-gray-800">{nomeAluno}</span> para mover para a coluna "Visita Marcada".
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Data da Visita <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={dataVisita}
              onChange={(e) => setDataVisita(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Horário da Visita <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              value={horarioVisita}
              onChange={(e) => setHorarioVisita(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors text-sm"
            />
          </div>

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
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-colors text-sm font-medium shadow-md"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VisitaModal;
