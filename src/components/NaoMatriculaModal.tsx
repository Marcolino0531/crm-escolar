import React, { useState } from 'react';

const MOTIVOS = [
  'Valor',
  'Localização',
  'Horário incompatível',
  'Escolheu outra escola',
  'Outros',
];

interface NaoMatriculaModalProps {
  nomeAluno: string;
  onConfirmar: (motivo: string, observacao?: string) => void;
  onCancelar: () => void;
}

const NaoMatriculaModal: React.FC<NaoMatriculaModalProps> = ({
  nomeAluno,
  onConfirmar,
  onCancelar,
}) => {
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo) return;
    onConfirmar(motivo, motivo === 'Outros' ? observacao : undefined);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-gradient-to-r from-red-500 to-rose-500 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">❌</span>
              <h2 className="text-white text-lg font-bold">Não Matrícula</h2>
            </div>
            <button
              onClick={onCancelar}
              className="text-white/80 hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Registrar a não matrícula de <span className="font-semibold text-gray-800">{nomeAluno}</span>.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Motivo da perda <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {MOTIVOS.map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="motivo"
                    value={m}
                    checked={motivo === m}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-700">{m}</span>
                </label>
              ))}
            </div>
          </div>

          {motivo === 'Outros' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Observação
              </label>
              <textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Descreva o motivo..."
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors text-sm resize-none"
              />
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
              disabled={!motivo}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-lg hover:from-red-600 hover:to-rose-600 transition-colors text-sm font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NaoMatriculaModal;
