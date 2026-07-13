import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import KanbanBoard from "@/components/crm/KanbanBoard";
import LeadForm from "@/components/crm/LeadForm";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { Button } from "@/components/ui/button";
import { useLeads, useOnboarding } from "@/lib/crm/hooks";
import { useSchool, usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { formatDateBR } from "@/lib/date-utils";
import type { Lead } from "@/lib/crm/types";

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

  // Filtro opcional por data de criação (Mês/Ano). null = mostra todos os leads.
  const [periodo, setPeriodo] = useState<{ start: string; end: string } | null>(null);

  const unidadeNome = schools.find((s) => s.id === selected)?.name ?? "Todas as unidades";
  const consolidado = selected === "all";
  const schoolNameById = Object.fromEntries(schools.map((s) => [s.id, s.name]));

  const now = new Date();
  const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  // "Avançar": envia o(s) aluno(s) da matrícula para o Onboarding e arquiva o
  // lead (some do funil, mas o registro é preservado no banco).
  const handleAvancarParaOnboarding = (leadId: string) => {
    const lead = leadsHook.leads.find((l) => l.id === leadId);
    if (!lead) return;
    const alunos =
      lead.alunos.length > 0
        ? lead.alunos
        : [
            {
              nome: lead.nomeAluno,
              dataNascimento: lead.dataNascimento,
              idade: lead.idade,
              turma: lead.turma,
            },
          ];
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
    leadsHook.arquivarLead(leadId);
  };

  if (loading) return null;
  if (!podeVer) return <AccessDenied message="Você não tem permissão para visualizar Admissões." />;

  const leadsAtivos = leadsHook.leads.filter((l) => !l.arquivado);
  const leadsVisiveis = periodo
    ? leadsAtivos.filter((l) => {
        const dia = (l.criadoEm ?? "").slice(0, 10);
        return dia >= periodo.start && dia <= periodo.end;
      })
    : leadsAtivos;

  return (
    <div className="-m-4 md:-m-8 flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">Admissões</h2>
          <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
            {leadsVisiveis.length} leads
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Período (opcional)
            </label>
            <MonthYearPicker
              startDate={periodo?.start ?? defaultStart}
              onChange={(start, end) => setPeriodo({ start, end })}
            />
          </div>
          {periodo ? (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {formatDateBR(periodo.start)} — {formatDateBR(periodo.end)}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPeriodo(null)}>
                Limpar filtro
              </Button>
            </div>
          ) : (
            <span className="pb-2 text-xs text-muted-foreground">Mostrando todos os leads</span>
          )}

          {podeEditar && (
            <button
              onClick={() => setFormularioAberto(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-indigo-700"
            >
              <Plus size={16} />
              Novo Lead
            </button>
          )}
        </div>
      </header>

      <KanbanBoard
        leadsHook={leadsHook}
        onAvancarParaOnboarding={podeEditar ? handleAvancarParaOnboarding : undefined}
        onEditar={(lead) => setLeadEditando(lead)}
        isAdmin={podeEditar}
        consolidado={consolidado}
        schoolNameById={schoolNameById}
        unidadeNome={unidadeNome}
        periodo={periodo}
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
          escolas={schools}
          schoolIdInicial={selected !== "all" ? selected : (schools[0]?.id ?? "")}
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
