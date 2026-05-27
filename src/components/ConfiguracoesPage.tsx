import React from 'react';
import { Settings } from 'lucide-react';

const ConfiguracoesPage: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="bg-gray-100 rounded-full p-6 mb-6">
        <Settings size={48} className="text-gray-500" />
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Configurações</h2>
      <p className="text-gray-500 max-w-md">
        Em breve, aqui você poderá configurar turmas, valores padrão,
        usuários e permissões do sistema.
      </p>
      <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6 w-full max-w-lg">
        <p className="text-sm text-gray-400 italic">
          🚧 Página em construção — disponível em uma próxima atualização.
        </p>
      </div>
    </div>
  );
};

export default ConfiguracoesPage;
