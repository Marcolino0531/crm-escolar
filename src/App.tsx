import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/LoginPage';
import Sidebar, { Pagina } from './components/Sidebar';
import DashboardPage from './components/DashboardPage';
import ConfiguracoesPage from './components/ConfiguracoesPage';
import KanbanBoard from './components/KanbanBoard';
import OnboardingBoard from './components/OnboardingBoard';
import RHPage from './components/RHPage';
import LeadForm from './components/LeadForm';
import { useLeads } from './hooks/useLeads';
import { useOnboarding } from './hooks/useOnboarding';
import { useRH } from './hooks/useRH';
import { ItemMatricula, Lead, Unidade } from './types';
import { UNIDADE_SELECIONADA_KEY } from './constants';
import { Plus } from 'lucide-react';

function carregarUnidadeSalva(): Unidade {
  try {
    const salva = localStorage.getItem(UNIDADE_SELECIONADA_KEY);
    if (salva === 'CEC' || salva === 'CEC Baby' || salva === 'Núcleo Belvedere' || salva === 'Núcleo Vale do Sereno') {
      return salva;
    }
  } catch {}
  return 'CEC';
}

function AcessoNegado() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="bg-red-100 rounded-full p-6 mb-6">
        <span className="text-4xl">🔒</span>
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Acesso Negado</h2>
      <p className="text-gray-500 max-w-md">
        Você não tem permissão para acessar este módulo. Contate o administrador para solicitar acesso.
      </p>
    </div>
  );
}

function AppContent() {
  const { usuario, temPermissao, isAdmin } = useAuth();

  const [paginaAtiva, setPaginaAtiva] = useState<Pagina>('dashboard');
  const [sidebarAberta, setSidebarAberta] = useState(false);
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [leadEditando, setLeadEditando] = useState<Lead | null>(null);
  const [unidadeSelecionada, setUnidadeSelecionada] = useState<Unidade>(carregarUnidadeSalva);

  const leadsHook = useLeads(unidadeSelecionada);
  const onboardingHook = useOnboarding(unidadeSelecionada);
  const rhHook = useRH(unidadeSelecionada);

  useEffect(() => {
    if (!usuario) return;
    if (paginaAtiva === 'configuracoes' && !isAdmin) {
      setPaginaAtiva('dashboard');
    }
    if (paginaAtiva === 'admissoes' && !temPermissao('admissoes')) {
      setPaginaAtiva('dashboard');
    }
    if (paginaAtiva === 'onboarding' && !temPermissao('onboarding')) {
      setPaginaAtiva('dashboard');
    }
    if (paginaAtiva === 'rh' && !temPermissao('rh')) {
      setPaginaAtiva('dashboard');
    }
  }, [usuario, paginaAtiva, isAdmin, temPermissao]);

  if (!usuario) {
    return <LoginPage />;
  }

  const handleMudarUnidade = (unidade: Unidade) => {
    setUnidadeSelecionada(unidade);
    localStorage.setItem(UNIDADE_SELECIONADA_KEY, unidade);
  };

  const handleMatriculaComOnboarding = (leadId: string, itensMatricula: ItemMatricula[]) => {
    const lead = leadsHook.leads.find((l) => l.id === leadId);
    leadsHook.registrarMatricula(leadId, itensMatricula);

    if (lead) {
      onboardingHook.adicionarAluno({
        leadId: lead.id,
        nomeAluno: lead.nomeAluno,
        turma: lead.turma,
        nomePaiMae: lead.nomePaiMae,
        telefone: lead.telefone,
        unidade: lead.unidade,
      });
    }
  };

  const tituloPagina: Record<Pagina, string> = {
    dashboard: 'Dashboard',
    admissoes: 'Admissões',
    onboarding: 'Onboarding',
    rh: 'Recursos Humanos',
    configuracoes: 'Configurações',
  };

  const renderConteudo = () => {
    switch (paginaAtiva) {
      case 'dashboard':
        return <DashboardPage />;
      case 'admissoes':
        return temPermissao('admissoes') ? (
          <KanbanBoard leadsHook={leadsHook} onMatriculaConfirmada={handleMatriculaComOnboarding} onEditar={(lead) => setLeadEditando(lead)} />
        ) : (
          <AcessoNegado />
        );
      case 'onboarding':
        return temPermissao('onboarding') ? (
          <OnboardingBoard onboardingHook={onboardingHook} />
        ) : (
          <AcessoNegado />
        );
      case 'rh':
        return temPermissao('rh') ? (
          <RHPage rhHook={rhHook} unidadeSelecionada={unidadeSelecionada} />
        ) : (
          <AcessoNegado />
        );
      case 'configuracoes':
        return isAdmin ? <ConfiguracoesPage /> : <AcessoNegado />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Sidebar
        paginaAtiva={paginaAtiva}
        onNavegar={setPaginaAtiva}
        aberta={sidebarAberta}
        onToggle={() => setSidebarAberta(!sidebarAberta)}
        unidadeSelecionada={unidadeSelecionada}
        onMudarUnidade={handleMudarUnidade}
      />

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="lg:hidden w-8" />
            <h2 className="text-xl font-bold text-gray-800">
              {tituloPagina[paginaAtiva]}
            </h2>
            {paginaAtiva === 'admissoes' && temPermissao('admissoes') && (
              <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {leadsHook.leads.length} leads
              </span>
            )}
            {paginaAtiva === 'onboarding' && temPermissao('onboarding') && (
              <span className="bg-teal-100 text-teal-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {onboardingHook.alunos.length} alunos
              </span>
            )}
            {paginaAtiva === 'rh' && temPermissao('rh') && (
              <span className="bg-emerald-100 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {rhHook.funcionarios.length} funcionários
              </span>
            )}
          </div>

          {paginaAtiva === 'admissoes' && temPermissao('admissoes') && (
            <button
              onClick={() => setFormularioAberto(true)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors shadow-md"
            >
              <Plus size={16} />
              Novo Lead
            </button>
          )}
        </header>

        <main className="flex-1 overflow-auto">
          {renderConteudo()}
        </main>
      </div>

      {(formularioAberto || leadEditando) && (
        <LeadForm
          onSubmit={(dados) => {
            leadsHook.adicionarLead(dados);
            setFormularioAberto(false);
          }}
          onFechar={() => {
            setFormularioAberto(false);
            setLeadEditando(null);
          }}
          unidadeSelecionada={unidadeSelecionada}
          leadParaEditar={leadEditando}
          onEditar={(leadId, dados) => {
            leadsHook.editarLead(leadId, dados);
            setLeadEditando(null);
          }}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
