import React, { useState } from 'react';
import Header from './components/Header';
import LeadForm from './components/LeadForm';
import KanbanBoard from './components/KanbanBoard';
import { useLeads } from './hooks/useLeads';

function App() {
  const [formularioAberto, setFormularioAberto] = useState(false);
  const leadsHook = useLeads();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Header
        onAbrirFormulario={() => setFormularioAberto(true)}
        totalLeads={leadsHook.leads.length}
      />

      <KanbanBoard leadsHook={leadsHook} />

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
