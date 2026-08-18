import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/lib/app-context";
import { toast } from "sonner";
import type { FaltaTerceirizado, GradeTurnos, Terceirizado, TurnoFalta } from "./types";
import { DIAS_SEMANA, gradeVazia } from "./terceirizados-datas";

export { DIAS_SEMANA, TURNOS, gradeVazia } from "./terceirizados-datas";

// Preenche dias/turnos ausentes para tolerar registros antigos ou parciais.
function normalizarGrade(raw: unknown): GradeTurnos {
  const base = gradeVazia();
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const { id } of DIAS_SEMANA) {
      const dia = obj[id];
      if (dia && typeof dia === "object") {
        const d = dia as Record<string, unknown>;
        base[id] = { manha: d.manha === true, tarde: d.tarde === true };
      }
    }
  }
  return base;
}

function normalizarFaltas(raw: unknown): FaltaTerceirizado[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      id: typeof f.id === "string" ? f.id : crypto.randomUUID(),
      data: typeof f.data === "string" ? f.data : "",
      turno: (f.turno === "manha" || f.turno === "tarde" ? f.turno : "dia") as TurnoFalta,
      observacao: typeof f.observacao === "string" ? f.observacao : undefined,
    }))
    .filter((f) => f.data);
}

interface TerceirizadoRow {
  id: string;
  school_id: string | null;
  nome_completo: string;
  especialidade: string | null;
  telefone: string | null;
  valor_turno: number | null;
  grade: unknown;
  faltas: unknown;
  ativo: boolean | null;
  created_at: string;
}

function rowToTerceirizado(r: TerceirizadoRow, nameById: Map<string, string>): Terceirizado {
  return {
    id: r.id,
    schoolId: r.school_id ?? "",
    unidade: r.school_id ? (nameById.get(r.school_id) ?? "") : "",
    nomeCompleto: r.nome_completo,
    especialidade: r.especialidade ?? "",
    telefone: r.telefone ?? undefined,
    valorTurno: Number(r.valor_turno ?? 0),
    grade: normalizarGrade(r.grade),
    faltas: normalizarFaltas(r.faltas),
    ativo: r.ativo ?? true,
    criadoEm: r.created_at,
  };
}

export type TerceirizadoFormData = {
  unidade?: string;
  nomeCompleto: string;
  especialidade: string;
  telefone?: string;
  valorTurno: number;
  grade: GradeTurnos;
};

// Quantidade de turnos de uma falta (dia completo conta como 2).
export function turnosDaFalta(turno: TurnoFalta): number {
  return turno === "dia" ? 2 : 1;
}

export function useTerceirizados() {
  const { selected, schools, schoolFilterIds } = useSchool();
  const qc = useQueryClient();

  const idByName = new Map(schools.map((s) => [s.name, s.id]));
  const nameById = new Map(schools.map((s) => [s.id, s.name]));

  const { data: terceirizados = [], isLoading } = useQuery({
    queryKey: ["terceirizados", selected, schools.length, schoolFilterIds],
    queryFn: async () => {
      let q = supabase
        .from("terceirizados" as never)
        .select("*")
        .order("nome_completo", { ascending: true });
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as TerceirizadoRow[]).map((r) => rowToTerceirizado(r, nameById));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["terceirizados"] });
  const m = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: invalidate,
    onError: () => toast.error("Não foi possível salvar. Tente novamente."),
  });
  const run = (fn: () => Promise<void>) => m.mutate(fn);

  const resolveSchoolId = (unidade?: string): string | null => {
    const id = (unidade && idByName.get(unidade)) || (selected !== "all" ? selected : null);
    if (!id) {
      toast.error("Selecione uma unidade válida para o terceirizado.");
      return null;
    }
    return id;
  };

  const adicionar = (dados: TerceirizadoFormData) => {
    const schoolId = resolveSchoolId(dados.unidade);
    if (!schoolId) return;
    run(async () => {
      const { error } = await supabase.from("terceirizados" as never).insert({
        school_id: schoolId,
        nome_completo: dados.nomeCompleto,
        especialidade: dados.especialidade,
        telefone: dados.telefone ?? null,
        valor_turno: dados.valorTurno ?? 0,
        grade: dados.grade,
        faltas: [],
        ativo: true,
      } as never);
      if (error) throw error;
    });
  };

  const editar = (id: string, dados: TerceirizadoFormData) => {
    const schoolId = resolveSchoolId(dados.unidade);
    if (!schoolId) return;
    run(async () => {
      const { error } = await supabase
        .from("terceirizados" as never)
        .update({
          school_id: schoolId,
          nome_completo: dados.nomeCompleto,
          especialidade: dados.especialidade,
          telefone: dados.telefone ?? null,
          valor_turno: dados.valorTurno ?? 0,
          grade: dados.grade,
        } as never)
        .eq("id", id);
      if (error) throw error;
    });
  };

  const alternarAtivo = (id: string, ativo: boolean) =>
    run(async () => {
      const { error } = await supabase
        .from("terceirizados" as never)
        .update({ ativo } as never)
        .eq("id", id);
      if (error) throw error;
    });

  const remover = (id: string) =>
    run(async () => {
      const { error } = await supabase
        .from("terceirizados" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    });

  const adicionarFalta = (id: string, data: string, turno: TurnoFalta, observacao?: string) =>
    run(async () => {
      const atual = terceirizados.find((t) => t.id === id);
      const nova: FaltaTerceirizado = { id: crypto.randomUUID(), data, turno };
      if (observacao && observacao.trim()) nova.observacao = observacao.trim();
      const faltas = [...(atual?.faltas ?? []), nova];
      const { error } = await supabase
        .from("terceirizados" as never)
        .update({ faltas } as never)
        .eq("id", id);
      if (error) throw error;
    });

  const removerFalta = (id: string, faltaId: string) =>
    run(async () => {
      const atual = terceirizados.find((t) => t.id === id);
      const faltas = (atual?.faltas ?? []).filter((f) => f.id !== faltaId);
      const { error } = await supabase
        .from("terceirizados" as never)
        .update({ faltas } as never)
        .eq("id", id);
      if (error) throw error;
    });

  return {
    terceirizados,
    isLoading,
    canAdd: selected !== "all",
    adicionar,
    editar,
    alternarAtivo,
    remover,
    adicionarFalta,
    removerFalta,
  };
}
