import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import KanbanBoard from "@/components/crm/KanbanBoard";
import LeadForm from "@/components/crm/LeadForm";
import { useLeads, useOnboarding } from "@/lib/crm/hooks";
import { useSchool, useRole } from "@/lib/app-context";
import type { ItemMatricula, Lead } from "@/lib/crm/types";

export const Route = createFileRoute("/admissoes")({
  head: () => ({ meta: [{ title: "Admissões — Schooler Hub" }] }),
  component: AdmissoesPage,
});

function AdmissoesPage() {
  const { selected, schools } = useSchool();
  const { isAdmin } = useRole();
  const leadsHook = useLeads();
  const onboardingHook = useOnboarding();

  const [formularioAberto, setFormularioAberto] = useState(false);
  const [leadEditando, setLeadEditando] = useState<Lead | null>(null);

  const unidadeNome = schools.find((s) => s.id === selected)?.name ?? "Todas as unidades";

  const handleMatriculaComOnboarding = (leadId: string, itensMatricula: ItemMatricula[]) => {
    const lead = leadsHook.leads.find((l) => l.id === leadId);
    leadsHook.registrarMatricula(leadId, itensMatricula);
    if (lead) {
      onboardingHook.adicionarAluno({
        schoolId: lead.schoolId,
        leadId: lead.id,
        nomeAluno: lead.nomeAluno,
        turma: lead.turma,
        nomePaiMae: lead.nomePaiMae,
        telefone: lead.telefone,
      });
    }
  };

  return (
    <div className="-m-4 md:-m-8 flex flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">Admissões</h2>
          <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
            {leadsHook.leads.length} leads
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => setFormularioAberto(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-indigo-700"
          >
            <Plus size={16} />
            Novo Lead
          </button>
        )}
      </header>

      <KanbanBoard
        leadsHook={leadsHook}
        onMatriculaConfirmada={handleMatriculaComOnboarding}
        onEditar={(lead) => setLeadEditando(lead)}
      />

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
          unidadeSelecionada={unidadeNome}
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
