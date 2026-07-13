import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/lib/app-context";
import { toast } from "sonner";
import { rowToFuncionario, rowToLead, rowToOnboarding } from "./mappers";
import { TAREFAS_ONBOARDING } from "./constants";
import type {
  AlunoLead,
  ColunaKanban,
  Falta,
  Funcionario,
  ItemMatricula,
  Lead,
  OnboardingAluno,
  PeriodoFerias,
  TarefaOnboardingId,
  TipoFalta,
  CategoriaFalta,
} from "./types";
import type { Json, TablesUpdate } from "@/integrations/supabase/types";

type LeadInput = {
  // Unidade escolhida no próprio modal (independe do filtro global). A RLS de
  // `leads` (can_access_school) rejeita ids fora da permissão do usuário; aqui
  // validamos antes para dar um erro amigável.
  schoolId: string;
  alunos: AlunoLead[];
  nomePaiMae: string;
  telefone: string;
  origem: string;
};

function requireSchool(selected: string): string | null {
  if (selected === "all") {
    toast.error("Selecione uma unidade específica antes de adicionar registros.");
    return null;
  }
  return selected;
}

// ---------- Leads (Admissões) ----------
export function useLeads() {
  const { selected, schools, schoolFilterIds } = useSchool();
  const qc = useQueryClient();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", selected, schoolFilterIds],
    queryFn: async () => {
      let q = supabase.from("leads").select("*").order("created_at", { ascending: true });
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data, error } = await q;
      if (error) throw error;
      return data.map(rowToLead);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["leads"] });
  const m = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: invalidate,
  });
  const run = (fn: () => Promise<void>) => m.mutate(fn);

  const adicionarLead = (dados: LeadInput) => {
    const schoolId = dados.schoolId?.trim();
    if (!schoolId) {
      toast.error("Selecione a unidade do lead.");
      return;
    }
    if (!schools.some((s) => s.id === schoolId)) {
      toast.error("Você não tem permissão para criar leads nesta unidade.");
      return;
    }
    const primeiro = dados.alunos[0];
    run(async () => {
      const { error } = await supabase.from("leads").insert({
        school_id: schoolId,
        // Campos escalares espelham o 1º aluno (compat com Onboarding/Matrícula).
        nome_aluno: primeiro?.nome ?? "",
        idade: primeiro?.idade ?? "",
        data_nascimento: primeiro?.dataNascimento ?? "",
        turma: primeiro?.turma ?? "",
        alunos: dados.alunos as unknown as Json,
        nome_pai_mae: dados.nomePaiMae,
        telefone: dados.telefone,
        origem: dados.origem,
        coluna: "contato-inicial",
        itens_matricula: [] as unknown as Json,
      });
      if (error) throw error;
    });
  };

  const editarLead = (leadId: string, dados: Partial<LeadInput>) =>
    run(async () => {
      const patch: TablesUpdate<"leads"> = {};
      if (dados.alunos !== undefined) {
        patch.alunos = dados.alunos as unknown as Json;
        const primeiro = dados.alunos[0];
        patch.nome_aluno = primeiro?.nome ?? "";
        patch.idade = primeiro?.idade ?? "";
        patch.data_nascimento = primeiro?.dataNascimento ?? "";
        patch.turma = primeiro?.turma ?? "";
      }
      if (dados.nomePaiMae !== undefined) patch.nome_pai_mae = dados.nomePaiMae;
      if (dados.telefone !== undefined) patch.telefone = dados.telefone;
      if (dados.origem !== undefined) patch.origem = dados.origem;
      const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
      if (error) throw error;
    });

  const moverLead = (leadId: string, novaColuna: ColunaKanban) =>
    run(async () => {
      const { error } = await supabase
        .from("leads")
        .update({ coluna: novaColuna })
        .eq("id", leadId);
      if (error) throw error;
    });

  const agendarVisita = (leadId: string, dataVisita: string, horarioVisita: string) =>
    run(async () => {
      const { error } = await supabase
        .from("leads")
        .update({
          coluna: "visita-marcada",
          data_visita: dataVisita,
          horario_visita: horarioVisita,
        })
        .eq("id", leadId);
      if (error) throw error;
    });

  const registrarNaoMatricula = (leadId: string, motivoPerda: string, observacaoPerda?: string) =>
    run(async () => {
      const { error } = await supabase
        .from("leads")
        .update({
          coluna: "nao-matricula",
          motivo_perda: motivoPerda,
          observacao_perda: observacaoPerda ?? null,
        })
        .eq("id", leadId);
      if (error) throw error;
    });

  const registrarMatricula = (leadId: string, itensMatricula: ItemMatricula[]) =>
    run(async () => {
      const { error } = await supabase
        .from("leads")
        .update({ coluna: "matricula", itens_matricula: itensMatricula as unknown as Json })
        .eq("id", leadId);
      if (error) throw error;
    });

  const removerLead = (leadId: string) =>
    run(async () => {
      const { error } = await supabase.from("leads").delete().eq("id", leadId);
      if (error) throw error;
    });

  const leadsporColuna = (coluna: ColunaKanban) => leads.filter((l) => l.coluna === coluna);

  return {
    leads,
    isLoading,
    canAdd: schools.length > 0,
    adicionarLead,
    editarLead,
    moverLead,
    agendarVisita,
    registrarNaoMatricula,
    registrarMatricula,
    removerLead,
    leadsporColuna,
  };
}

// ---------- Onboarding ----------
export function useOnboarding() {
  const { selected, schoolFilterIds } = useSchool();
  const qc = useQueryClient();

  const { data: alunos = [], isLoading } = useQuery({
    queryKey: ["onboarding", selected, schoolFilterIds],
    queryFn: async () => {
      let q = supabase.from("onboarding").select("*").order("created_at", { ascending: true });
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data, error } = await q;
      if (error) throw error;
      return data.map(rowToOnboarding);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["onboarding"] });
  const m = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: invalidate,
  });
  const run = (fn: () => Promise<void>) => m.mutate(fn);

  const adicionarAluno = (
    aluno: Pick<OnboardingAluno, "leadId" | "nomeAluno" | "turma" | "nomePaiMae" | "telefone"> & {
      schoolId?: string;
    },
  ) => {
    const schoolId = aluno.schoolId ?? requireSchool(selected);
    if (!schoolId) return;
    run(async () => {
      const { error } = await supabase.from("onboarding").insert({
        school_id: schoolId,
        lead_id: aluno.leadId,
        nome_aluno: aluno.nomeAluno,
        turma: aluno.turma,
        nome_pai_mae: aluno.nomePaiMae,
        telefone: aluno.telefone,
        tarefas: {} as Json,
        concluido: false,
      });
      if (error) throw error;
    });
  };

  const alternarTarefa = (alunoId: string, tarefaId: TarefaOnboardingId) => {
    const aluno = alunos.find((a) => a.id === alunoId);
    if (!aluno) return;
    run(async () => {
      const tarefas = { ...aluno.tarefas, [tarefaId]: !aluno.tarefas[tarefaId] };
      const concluido = Object.values(tarefas).every(Boolean);
      const { error } = await supabase
        .from("onboarding")
        .update({ tarefas: tarefas as Json, concluido })
        .eq("id", aluno.id);
      if (error) throw error;
    });
  };

  const contarTarefas = (alunoId: string) => {
    const aluno = alunos.find((a) => a.id === alunoId);
    const total = TAREFAS_ONBOARDING.length;
    const concluidas = aluno ? TAREFAS_ONBOARDING.filter((t) => aluno.tarefas[t.id]).length : 0;
    return { concluidas, total };
  };

  const removerAluno = (id: string) =>
    run(async () => {
      const { error } = await supabase.from("onboarding").delete().eq("id", id);
      if (error) throw error;
    });

  const alunosPendentes = alunos.filter((a) => !a.concluido);
  const alunosConcluidos = alunos.filter((a) => a.concluido);

  return {
    alunos,
    alunosPendentes,
    alunosConcluidos,
    isLoading,
    adicionarAluno,
    alternarTarefa,
    contarTarefas,
    removerAluno,
  };
}

// ---------- Funcionarios (RH) ----------
type FuncionarioFormData = Omit<Funcionario, "id" | "criadoEm" | "schoolId" | "ferias" | "faltas">;

function funcionarioToRow(schoolId: string, f: FuncionarioFormData) {
  return {
    school_id: schoolId,
    nome_completo: f.nomeCompleto,
    cpf: f.cpf ?? null,
    data_nascimento: f.dataNascimento || null,
    genero: f.genero ?? null,
    estado_civil: f.estadoCivil ?? null,
    cargo: f.cargo ?? null,
    data_admissao: f.dataAdmissao || null,
    data_inicio: f.dataInicio || null,
    data_rescisao: f.dataRescisao || null,
    horario_trabalho_inicio: f.horarioTrabalhoInicio,
    horario_trabalho_fim: f.horarioTrabalhoFim,
    horario_almoco_inicio: f.horarioAlmocoInicio ?? null,
    horario_almoco_fim: f.horarioAlmocoFim ?? null,
    recebe_vt: f.recebeVt ?? true,
    valor_diario_vt: f.recebeVt ? (f.valorDiarioVt ?? 0) : 0,
  };
}

export function useFuncionarios() {
  const { selected, schools, schoolFilterIds } = useSchool();
  const qc = useQueryClient();

  const idByName = new Map(schools.map((s) => [s.name, s.id]));
  const nameById = new Map(schools.map((s) => [s.id, s.name]));

  const { data: funcionarios = [], isLoading } = useQuery({
    queryKey: ["funcionarios", selected, schools.length, schoolFilterIds],
    queryFn: async () => {
      let q = supabase.from("funcionarios").select("*").order("nome_completo", { ascending: true });
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data, error } = await q;
      if (error) throw error;
      return data.map((r) => {
        const f = rowToFuncionario(r);
        f.unidade = nameById.get(f.schoolId) ?? "";
        return f;
      });
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["funcionarios"] });
  const m = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: invalidate,
  });
  const run = (fn: () => Promise<void>) => m.mutate(fn);

  const resolveSchoolId = (unidade?: string): string | null => {
    const id = (unidade && idByName.get(unidade)) || (selected !== "all" ? selected : null);
    if (!id) {
      toast.error("Selecione uma unidade v\u00e1lida para o funcion\u00e1rio.");
      return null;
    }
    return id;
  };

  const adicionarFuncionario = (dados: FuncionarioFormData) => {
    const schoolId = resolveSchoolId(dados.unidade);
    if (!schoolId) return;
    run(async () => {
      const { error } = await supabase.from("funcionarios").insert({
        ...funcionarioToRow(schoolId, dados),
        ferias: [] as unknown as Json,
        faltas: [] as unknown as Json,
      });
      if (error) throw error;
    });
  };

  const editarFuncionario = (id: string, dados: FuncionarioFormData) => {
    const schoolId = resolveSchoolId(dados.unidade);
    if (!schoolId) return;
    run(async () => {
      const { error } = await supabase
        .from("funcionarios")
        .update(funcionarioToRow(schoolId, dados))
        .eq("id", id);
      if (error) throw error;
    });
  };

  const removerFuncionario = (id: string) =>
    run(async () => {
      const { error } = await supabase.from("funcionarios").delete().eq("id", id);
      if (error) throw error;
    });

  const adicionarFerias = (funcionarioId: string, dataInicio: string, dataFim: string) =>
    run(async () => {
      const atual = funcionarios.find((f) => f.id === funcionarioId);
      const ferias: PeriodoFerias[] = [
        ...(atual?.ferias ?? []),
        { id: crypto.randomUUID(), dataInicio, dataFim },
      ];
      const { error } = await supabase
        .from("funcionarios")
        .update({ ferias: ferias as unknown as Json })
        .eq("id", funcionarioId);
      if (error) throw error;
    });

  const removerFerias = (funcionarioId: string, feriasId: string) =>
    run(async () => {
      const atual = funcionarios.find((f) => f.id === funcionarioId);
      const ferias = (atual?.ferias ?? []).filter((fer) => fer.id !== feriasId);
      const { error } = await supabase
        .from("funcionarios")
        .update({ ferias: ferias as unknown as Json })
        .eq("id", funcionarioId);
      if (error) throw error;
    });

  const adicionarFalta = (
    funcionarioId: string,
    data: string,
    tipo: TipoFalta,
    categoria: CategoriaFalta,
    duracaoMinutos?: number,
  ) =>
    run(async () => {
      const atual = funcionarios.find((f) => f.id === funcionarioId);
      const nova: Falta = { id: crypto.randomUUID(), data, tipo, categoria };
      if (categoria !== "integral" && duracaoMinutos != null && duracaoMinutos > 0) {
        nova.duracaoMinutos = duracaoMinutos;
      }
      const faltas: Falta[] = [...(atual?.faltas ?? []), nova];
      const { error } = await supabase
        .from("funcionarios")
        .update({ faltas: faltas as unknown as Json })
        .eq("id", funcionarioId);
      if (error) throw error;
    });

  // Registra uma falta que abrange N dias consecutivos (ex.: atestado médico),
  // gerando UMA falta por dia a partir de `dataInicio` (ISO) para que o peso
  // total dos dias seja contabilizado no ranking. Grava tudo num único update.
  const adicionarFaltasPeriodo = (
    funcionarioId: string,
    dataInicio: string,
    numeroDias: number,
    tipo: TipoFalta,
    categoria: CategoriaFalta,
    duracaoMinutos?: number,
  ) =>
    run(async () => {
      const atual = funcionarios.find((f) => f.id === funcionarioId);
      const dias = Math.max(1, Math.floor(numeroDias));
      const novas: Falta[] = [];
      for (let i = 0; i < dias; i++) {
        const d = new Date(`${dataInicio}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const dataDia = d.toISOString().slice(0, 10);
        const nova: Falta = { id: crypto.randomUUID(), data: dataDia, tipo, categoria };
        if (categoria !== "integral" && duracaoMinutos != null && duracaoMinutos > 0) {
          nova.duracaoMinutos = duracaoMinutos;
        }
        novas.push(nova);
      }
      const faltas: Falta[] = [...(atual?.faltas ?? []), ...novas];
      const { error } = await supabase
        .from("funcionarios")
        .update({ faltas: faltas as unknown as Json })
        .eq("id", funcionarioId);
      if (error) throw error;
    });

  // Edita uma falta EXISTENTE no array (mesmo id, sem duplicar no ranking).
  const editarFalta = (funcionarioId: string, faltaId: string, patch: Partial<Omit<Falta, "id">>) =>
    run(async () => {
      const atual = funcionarios.find((f) => f.id === funcionarioId);
      const faltas = (atual?.faltas ?? []).map((fa) => {
        if (fa.id !== faltaId) return fa;
        const atualizada: Falta = { ...fa, ...patch };
        // Falta integral não tem tempo de ausência.
        if (atualizada.categoria === "integral") delete atualizada.duracaoMinutos;
        return atualizada;
      });
      const { error } = await supabase
        .from("funcionarios")
        .update({ faltas: faltas as unknown as Json })
        .eq("id", funcionarioId);
      if (error) throw error;
    });

  const removerFalta = (funcionarioId: string, faltaId: string) =>
    run(async () => {
      const atual = funcionarios.find((f) => f.id === funcionarioId);
      const faltas = (atual?.faltas ?? []).filter((fa) => fa.id !== faltaId);
      const { error } = await supabase
        .from("funcionarios")
        .update({ faltas: faltas as unknown as Json })
        .eq("id", funcionarioId);
      if (error) throw error;
    });

  return {
    funcionarios,
    isLoading,
    canAdd: selected !== "all",
    adicionarFuncionario,
    editarFuncionario,
    removerFuncionario,
    adicionarFerias,
    removerFerias,
    adicionarFalta,
    adicionarFaltasPeriodo,
    editarFalta,
    removerFalta,
  };
}

export type { PeriodoFerias };
