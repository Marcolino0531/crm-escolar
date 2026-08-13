import type { Tables } from "@/integrations/supabase/types";
import type {
  AlunoLead,
  EstadoCivil,
  Funcionario,
  Genero,
  ItemMatricula,
  Falta,
  Lead,
  OnboardingAluno,
  PeriodoFerias,
  TarefaOnboardingId,
} from "./types";
import { TAREFAS_INICIAIS } from "./constants";
import type { ColunaKanban } from "./types";

// ---------- Leads ----------
export function rowToLead(r: Tables<"leads">): Lead {
  const alunosRaw = (r.alunos as unknown as AlunoLead[] | null) ?? [];
  // Leads antigos (sem array): sintetiza um único aluno dos campos escalares.
  const alunos: AlunoLead[] =
    alunosRaw.length > 0
      ? alunosRaw
      : [
          {
            nome: r.nome_aluno,
            dataNascimento: r.data_nascimento ?? "",
            idade: r.idade ?? "",
            turma: r.turma ?? "",
          },
        ];
  return {
    id: r.id,
    schoolId: r.school_id,
    nomeAluno: r.nome_aluno,
    idade: r.idade ?? "",
    dataNascimento: r.data_nascimento ?? "",
    turma: r.turma ?? "",
    alunos,
    nomePaiMae: r.nome_pai_mae ?? "",
    telefone: r.telefone ?? "",
    origem: r.origem ?? "",
    coluna: (r.coluna as ColunaKanban) ?? "contato-inicial",
    criadoEm: r.created_at,
    dataVisita: r.data_visita ?? undefined,
    horarioVisita: r.horario_visita ?? undefined,
    motivoPerda: r.motivo_perda ?? undefined,
    observacaoPerda: r.observacao_perda ?? undefined,
    itensMatricula: (r.itens_matricula as unknown as ItemMatricula[]) ?? [],
    arquivado: r.arquivado ?? false,
  };
}

// ---------- Onboarding ----------
export function rowToOnboarding(r: Tables<"onboarding">): OnboardingAluno {
  const tarefas = { ...TAREFAS_INICIAIS, ...(r.tarefas as Record<TarefaOnboardingId, boolean>) };
  return {
    id: r.id,
    schoolId: r.school_id,
    leadId: r.lead_id,
    nomeAluno: r.nome_aluno,
    turma: r.turma ?? "",
    nomePaiMae: r.nome_pai_mae ?? "",
    telefone: r.telefone ?? "",
    tarefas,
    concluido: r.concluido,
    criadoEm: r.created_at,
  };
}

// ---------- Funcionarios (RH) ----------
export function rowToFuncionario(r: Tables<"funcionarios">): Funcionario {
  return {
    id: r.id,
    schoolId: r.school_id,
    unidade: "", // filled by the hook from the schools list
    nomeCompleto: r.nome_completo,
    cpf: r.cpf ?? undefined,
    email: r.email ?? undefined,
    dataNascimento: r.data_nascimento ?? undefined,
    genero: (r.genero as Genero) ?? undefined,
    estadoCivil: (r.estado_civil as EstadoCivil) ?? undefined,
    cargo: r.cargo ?? undefined,
    dataAdmissao: r.data_admissao ?? undefined,
    dataInicio: r.data_inicio ?? undefined,
    dataRescisao: r.data_rescisao ?? undefined,
    horarioTrabalhoInicio: r.horario_trabalho_inicio ?? "",
    horarioTrabalhoFim: r.horario_trabalho_fim ?? "",
    horarioAlmocoInicio: r.horario_almoco_inicio ?? undefined,
    horarioAlmocoFim: r.horario_almoco_fim ?? undefined,
    recebeVt: r.recebe_vt ?? true,
    valorDiarioVt: Number(r.valor_diario_vt ?? 0),
    ferias: (r.ferias as unknown as PeriodoFerias[]) ?? [],
    faltas: (r.faltas as unknown as Falta[]) ?? [],
    criadoEm: r.created_at,
  };
}
