import React, { useState } from 'react';
import Sidebar, { Pagina } from './components/Sidebar';
import DashboardPage from './components/DashboardPage';
import ConfiguracoesPage from './components/ConfiguracoesPage';
import KanbanBoard from './components/KanbanBoard';
import OnboardingBoard from './components/OnboardingBoard';
import LeadForm from './components/LeadForm';
import { useLeads } from './hooks/useLeads';
import { useOnboarding } from './hooks/useOnboarding';
import { ItemMatricula } from './types';
import { Plus } from 'lucide-react';

function App() {
  const [paginaAtiva, setPaginaAtiva] = useState<Pagina>('admissoes');
  const [sidebarAberta, setSidebarAberta] = useState(false);
  const [formularioAberto, setFormularioAberto] = useState(false);
  const leadsHook = useLeads();
  const onboardingHook = useOnboarding();

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
      });
    }
  };

  const tituloPagina: Record<Pagina, string> = {
    dashboard: 'Dashboard',
    admissoes: 'Admissões',
    onboarding: 'Onboarding',
    configuracoes: 'Configurações',
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Sidebar
        paginaAtiva={paginaAtiva}
        onNavegar={setPaginaAtiva}
        aberta={sidebarAberta}
        onToggle={() => setSidebarAberta(!sidebarAberta)}
      />

      {/* Conteúdo principal */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="lg:hidden w-8" />
            <h2 className="text-xl font-bold text-gray-800">
              {tituloPagina[paginaAtiva]}
            </h2>
            {paginaAtiva === 'admissoes' && (
              <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {leadsHook.leads.length} leads
              </span>
            )}
            {paginaAtiva === 'onboarding' && (
              <span className="bg-teal-100 text-teal-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                {onboardingHook.alunos.length} alunos
              </span>
            )}
          </div>

          {paginaAtiva === 'admissoes' && (
            <button
              onClick={() => setFormularioAberto(true)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors shadow-md"
            >
              <Plus size={16} />
              Novo Lead
            </button>
          )}
        </header>

        {/* Área de conteúdo */}
        <main className="flex-1 overflow-auto">
          {paginaAtiva === 'dashboard' && <DashboardPage />}
          {paginaAtiva === 'admissoes' && (
            <KanbanBoard
              leadsHook={leadsHook}
              onMatriculaConfirmada={handleMatriculaComOnboarding}
            />
          )}
          {paginaAtiva === 'onboarding' && <OnboardingBoard onboardingHook={onboardingHook} />}
          {paginaAtiva === 'configuracoes' && <ConfiguracoesPage />}
        </main>
      </div>

      {formularioAberto && (
        <LeadForm
          onSubmit={(dados) => {
            leadsHook.adicionarLead(dados);
            setFormularioAberto(false);
          }}
          onFechar={() => setFormularioAberto(false)}
        />
      )}
    </div>
  );
}

export default App;
