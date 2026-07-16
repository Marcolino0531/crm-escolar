import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toTitleCase } from "@/lib/name-format";

export type Reuniao = {
  id: string;
  data: string; // YYYY-MM-DD
  horario: string;
  responsavelNome: string;
  alunoNome: string;
  colaboradores: string[];
};

export type ReuniaoInput = {
  data: string;
  horario: string;
  responsavelNome: string;
  alunoNome: string;
  colaboradores: string[];
};

type ReuniaoRow = {
  id: string;
  data: string;
  horario: string | null;
  responsavel_nome: string | null;
  aluno_nome: string | null;
  colaboradores: string[] | null;
};

function rowToReuniao(r: ReuniaoRow): Reuniao {
  return {
    id: r.id,
    data: String(r.data).slice(0, 10),
    horario: r.horario ?? "",
    responsavelNome: r.responsavel_nome ?? "",
    alunoNome: r.aluno_nome ?? "",
    colaboradores: r.colaboradores ?? [],
  };
}

// ---------- Reuniões (eventos manuais da Agenda) ----------
export function useReunioes() {
  const qc = useQueryClient();

  const { data: reunioes = [], isLoading } = useQuery({
    queryKey: ["agenda_reunioes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_reunioes" as never)
        .select("*")
        .order("data", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as ReuniaoRow[]).map(rowToReuniao);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["agenda_reunioes"] });
  const m = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erro ao salvar reunião."),
  });

  const adicionarReuniao = (input: ReuniaoInput) =>
    m.mutate(async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("agenda_reunioes" as never).insert({
        data: input.data,
        horario: input.horario || null,
        responsavel_nome: toTitleCase(input.responsavelNome) || null,
        aluno_nome: toTitleCase(input.alunoNome) || null,
        colaboradores: input.colaboradores,
        created_by: auth.user?.id ?? null,
      } as never);
      if (error) throw error;
      toast.success("Reunião agendada.");
    });

  const removerReuniao = (id: string) =>
    m.mutate(async () => {
      const { error } = await supabase
        .from("agenda_reunioes" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Reunião removida.");
    });

  return { reunioes, isLoading, adicionarReuniao, removerReuniao };
}

// ---------- Colaboradores (fonte do multi-select) ----------
type ColaboradorRow = { id: string; nome: string; ativo: boolean };

export function useColaboradores() {
  const qc = useQueryClient();

  const { data: colaboradores = [], isLoading } = useQuery({
    queryKey: ["agenda_colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_colaboradores" as never)
        .select("id, nome, ativo")
        .eq("ativo", true)
        .order("nome", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as ColaboradorRow[]).map((r) => r.nome);
    },
  });

  const m = useMutation({
    mutationFn: async (nome: string) => {
      const clean = toTitleCase(nome);
      if (!clean) throw new Error("Informe um nome válido.");
      const { error } = await supabase
        .from("agenda_colaboradores" as never)
        .upsert({ nome: clean } as never, { onConflict: "nome" });
      if (error) throw error;
      return clean;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_colaboradores"] }),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar colaborador."),
  });

  const adicionarColaborador = (nome: string) => m.mutateAsync(nome);

  return { colaboradores, isLoading, adicionarColaborador };
}
