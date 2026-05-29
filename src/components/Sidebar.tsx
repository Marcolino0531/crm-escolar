import React from 'react';
import { BarChart3, Users, Settings, Menu, X, ClipboardList, BadgeCheck, Building2, LogOut, DollarSign } from 'lucide-react';
import { Unidade } from '../types';
import { UNIDADES } from '../constants';
import { useAuth } from '../contexts/AuthContext';

export type Pagina = 'dashboard' | 'admissoes' | 'onboarding' | 'rh' | 'financeiro' | 'configuracoes';

interface SidebarProps {
  paginaAtiva: Pagina;
  onNavegar: (pagina: Pagina) => void;
  aberta: boolean;
  onToggle: () => void;
  unidadeSelecionada: Unidade;
  onMudarUnidade: (unidade: Unidade) => void;
}

const todosItensMenu: { id: Pagina; titulo: string; icone: React.ElementType }[] = [
  { id: 'dashboard', titulo: 'Dashboard', icone: BarChart3 },
  { id: 'admissoes', titulo: 'Admissões', icone: Users },
  { id: 'onboarding', titulo: 'Onboarding', icone: ClipboardList },
  { id: 'rh', titulo: 'Recursos Humanos', icone: BadgeCheck },
  { id: 'financeiro', titulo: 'Financeiro', icone: DollarSign },
  { id: 'configuracoes', titulo: 'Configurações', icone: Settings },
];

const Sidebar: React.FC<SidebarProps> = ({
  paginaAtiva,
  onNavegar,
  aberta,
  onToggle,
  unidadeSelecionada,
  onMudarUnidade,
}) => {
  const { usuario, logout, isAdmin, temPermissao } = useAuth();

  const itensMenu = todosItensMenu.filter((item) => {
    if (item.id === 'dashboard') return true;
    if (item.id === 'configuracoes') return isAdmin;
    if (item.id === 'admissoes') return temPermissao('admissoes');
    if (item.id === 'onboarding') return temPermissao('onboarding');
    if (item.id === 'rh') return temPermissao('rh');
    if (item.id === 'financeiro') return temPermissao('financeiro');
    return true;
  });

  return (
    <>
      {/* Botão mobile para abrir sidebar */}
      <button
        onClick={onToggle}
        className="lg:hidden fixed top-4 left-4 z-50 bg-slate-800 text-white p-2 rounded-lg shadow-lg hover:bg-slate-700 transition-colors"
      >
        {aberta ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay mobile */}
      {aberta && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-screen w-64 bg-slate-900 text-white flex flex-col z-40 transition-transform duration-300 lg:translate-x-0 ${
          aberta ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="px-6 py-5 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-500 rounded-lg p-2">
              <span className="text-xl">🎓</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Schooler Hub</h1>
              <p className="text-slate-400 text-xs">ERP Multi-Unidades</p>
            </div>
          </div>
        </div>

        {/* Seletor de Unidade */}
        <div className="px-3 py-3 border-b border-slate-700/50">
          <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 px-1">
            <Building2 size={12} />
            Unidade
          </label>
          <select
            value={unidadeSelecionada}
            onChange={(e) => onMudarUnidade(e.target.value as Unidade)}
            className="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 appearance-none cursor-pointer"
          >
            {UNIDADES.map((unidade) => (
              <option key={unidade} value={unidade}>
                {unidade}
              </option>
            ))}
          </select>
        </div>

        {/* Navegação */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {itensMenu.map((item) => {
            const ativo = paginaAtiva === item.id;
            const Icone = item.icone;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavegar(item.id);
                  if (window.innerWidth < 1024) onToggle();
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  ativo
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icone size={20} />
                <span>{item.titulo}</span>
              </button>
            );
          })}
        </nav>

        {/* Usuário logado + Logout */}
        <div className="px-3 py-3 border-t border-slate-700/50">
          {usuario && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                {usuario.nome.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{usuario.nome}</p>
                <p className="text-xs text-slate-400 truncate">{usuario.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-red-400 transition-all"
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700/50">
          <p className="text-slate-500 text-xs text-center">
            © 2026 Schooler Hub
          </p>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
