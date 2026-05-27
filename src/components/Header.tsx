import React from 'react';

interface HeaderProps {
  onAbrirFormulario: () => void;
  totalLeads: number;
}

const Header: React.FC<HeaderProps> = ({ onAbrirFormulario, totalLeads }) => {
  return (
    <header className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 shadow-lg">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-2">
              <span className="text-2xl">🎓</span>
            </div>
            <div>
              <h1 className="text-white text-xl font-bold tracking-tight">
                Schooler Hub
              </h1>
              <p className="text-indigo-200 text-xs">
                Gestão de Visitas e Matrículas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5">
              <span className="text-indigo-200 text-sm">Total de leads:</span>
              <span className="text-white font-semibold text-sm">
                {totalLeads}
              </span>
            </div>

            <button
              onClick={onAbrirFormulario}
              className="flex items-center gap-2 bg-white text-indigo-700 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-50 transition-colors shadow-md hover:shadow-lg"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Novo Lead
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
