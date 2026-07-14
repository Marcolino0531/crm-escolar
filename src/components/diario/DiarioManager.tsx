import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Tag, Users, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DiarioClass } from "@/lib/diario";

type StudentRow = { id: string; name: string; class_id: string | null; class_name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string | null;
  schoolName: string;
};

export function DiarioManager({ open, onOpenChange, schoolId, schoolName }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerenciar — {schoolName}</DialogTitle>
        </DialogHeader>
        {!schoolId ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Selecione uma unidade específica no topo da página para gerenciar turmas e alunos.
          </p>
        ) : (
          <Tabs defaultValue="alunos" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="alunos">
                <Users className="mr-1 h-4 w-4" /> Alunos
              </TabsTrigger>
              <TabsTrigger value="turmas">
                <Tag className="mr-1 h-4 w-4" /> Turmas
              </TabsTrigger>
            </TabsList>
            <TabsContent value="alunos">
              <StudentsTab schoolId={schoolId} />
            </TabsContent>
            <TabsContent value="turmas">
              <ClassesTab schoolId={schoolId} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useClasses(schoolId: string) {
  return useQuery({
    queryKey: ["diario_classes", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diario_classes" as never)
        .select("id, name, school_id")
        .eq("school_id", schoolId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as DiarioClass[];
    },
  });
}

function ClassesTab({ schoolId }: { schoolId: string }) {
  const qc = useQueryClient();
  const { data: classes = [], isLoading } = useClasses(schoolId);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<DiarioClass | null>(null);
  const [editName, setEditName] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["diario_classes"] });
    qc.invalidateQueries({ queryKey: ["diario_students"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("diario_classes" as never)
        .insert({ school_id: schoolId, name: name.trim() } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Turma criada");
      setName("");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error("Erro", { description: e instanceof Error ? e.message : "" }),
  });

  const rename = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("diario_classes" as never)
        .update({ name: editName.trim() } as never)
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Turma atualizada");
      setEditing(null);
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error("Erro", { description: e instanceof Error ? e.message : "" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("diario_classes" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Turma removida");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error("Erro", { description: e instanceof Error ? e.message : "" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da nova turma…"
          className="h-10"
        />
        <Button
          onClick={() => create.mutate()}
          disabled={!name.trim() || create.isPending}
          className="shrink-0"
        >
          <Plus className="mr-1 h-4 w-4" /> Adicionar
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : classes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma turma cadastrada.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {classes.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
            >
              {editing?.id === c.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-9"
                  />
                  <Button size="sm" onClick={() => rename.mutate()} disabled={rename.isPending}>
                    Salvar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditing(c);
                      setEditName(c.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => remove.mutate(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StudentsTab({ schoolId }: { schoolId: string }) {
  const qc = useQueryClient();
  const { data: classes = [] } = useClasses(schoolId);
  const { data: students = [], isLoading } = useQuery({
    queryKey: ["diario_students_manage", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diario_students" as never)
        .select("id, name, class_id, class_name")
        .eq("school_id", schoolId)
        .order("class_name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as StudentRow[];
    },
  });

  const [name, setName] = useState("");
  const [classId, setClassId] = useState<string>("");
  const [editing, setEditing] = useState<StudentRow | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["diario_students_manage"] });
    qc.invalidateQueries({ queryKey: ["diario_students"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("diario_students" as never).insert({
        school_id: schoolId,
        name: name.trim(),
        class_id: classId || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aluno cadastrado");
      setName("");
      setClassId("");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error("Erro", { description: e instanceof Error ? e.message : "" }),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("diario_students" as never)
        .update({ name: editing.name.trim(), class_id: editing.class_id || null } as never)
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aluno atualizado");
      setEditing(null);
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error("Erro", { description: e instanceof Error ? e.message : "" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("diario_students" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aluno removido");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error("Erro", { description: e instanceof Error ? e.message : "" }),
  });

  const classOptions = useMemo(() => classes.map((c) => ({ id: c.id, name: c.name })), [classes]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Novo aluno
        </p>
        <div className="flex flex-col gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do aluno…"
            className="h-10"
          />
          <div className="flex gap-2">
            <Select
              value={classId || "none"}
              onValueChange={(v) => setClassId(v === "none" ? "" : v)}
            >
              <SelectTrigger className="h-10 flex-1">
                <SelectValue placeholder="Turma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem turma</SelectItem>
                {classOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => create.mutate()}
              disabled={!name.trim() || create.isPending}
              className="shrink-0"
            >
              <Plus className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : students.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum aluno cadastrado.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {students.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-card p-2">
              {editing?.id === s.id ? (
                <div className="flex flex-col gap-2">
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="h-9"
                  />
                  <div className="flex gap-2">
                    <Select
                      value={editing.class_id || "none"}
                      onValueChange={(v) =>
                        setEditing({ ...editing, class_id: v === "none" ? null : v })
                      }
                    >
                      <SelectTrigger className="h-9 flex-1">
                        <SelectValue placeholder="Turma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem turma</SelectItem>
                        {classOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>
                      Salvar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.class_name || "Sem turma"}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setEditing(s)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => remove.mutate(s.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
