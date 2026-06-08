import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import KanbanBoard from "@/components/crm/KanbanBoard";
import LeadForm from "@/components/crm/LeadForm";
import { useLeads, useOnboarding } from "@/lib/crm/hooks";
import { useSchool, usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import type { ItemMatricula, Lead } from "@/lib/crm/types";

export const Route = createFileRoute("/admissoes")({
  head: () => ({ meta: [{ title: "Admissões — School Hub" }] }),
  component: AdmissoesPage,
});

function AdmissoesPage() {
  const { selected, schools } = useSchool();
  const { canView, canEdit, loading } = usePermissions();
  const podeVer = canView("admissoes");
  const podeEditar = canEdit("admissoes");
  const leadsHook = useLeads();
  const onboardingHook = useOnboarding();

  const [formularioAberto, setFormularioAberto] = useState(false);
  const [leadEditando, setLeadEditando] = useState<Lead | null>(null);

  const unidadeNome = schools.find((s) => s.id === selected)?.name ?? "Todas as unidades";
  const consolidado = selected === "all";
  const schoolNameById = Object.fromEntries(schools.map((s) => [s.id, s.name]));

  const handleMatriculaComOnboarding = (leadId: string, itensMatricula: ItemMatricula[]) => {
    const lead = leadsHook.leads.find((l) => l.id === leadId);
    leadsHook.registrarMatricula(leadId, itensMatricula);
    if (lead) {
      // Cria um aluno no Onboarding para cada criança da negociação (irmãos).
      const alunos =
        lead.alunos.length > 0
          ? lead.alunos
          : [{ nome: lead.nomeAluno, dataNascimento: lead.dataNascimento, idade: lead.idade, turma: lead.turma }];
      alunos.forEach((aluno) => {
        onboardingHook.adicionarAluno({
          schoolId: lead.schoolId,
          leadId: lead.id,
          nomeAluno: aluno.nome,
          turma: aluno.turma,
          nomePaiMae: lead.nomePaiMae,
          telefone: lead.telefone,
        });
      });
    }
  };

  if (loading) return null;
  if (!podeVer) return <AccessDenied message="Você não tem permissão para visualizar Admissões." />;

  return (
    <div className="-m-4 md:-m-8 flex flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">Admissões</h2>
          <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
            {leadsHook.leads.length} leads
          </span>
        </div>
        {podeEditar && (
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
        isAdmin={podeEditar}
        consolidado={consolidado}
        schoolNameById={schoolNameById}
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
