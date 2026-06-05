import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, ArrowRight, Trash2, Play, Check, Inbox, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions } from "@/lib/app-context";
import { listDirectoryUsers } from "@/lib/tasks.functions";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateBR } from "@/lib/date-utils";

export const Route = createFileRoute("/tasks")({
  component: TasksGate,
});

function TasksGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("tasks"))
    return <AccessDenied message="Você não tem permissão para visualizar as Tasks." />;
  return <TasksPage />;
}

type TaskStatus = "aberto" | "em_resolucao" | "concluido";
type Task = {
  id: string;
  sender_id: string;
  recipient_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: string;
};
type DirUser = { id: string; email: string; name: string };

const COLUMNS: { status: TaskStatus; label: string; icon: any; accent: string }[] = [
  { status: "aberto", label: "Tickets Abertos", icon: Inbox, accent: "border-t-blue-500" },
  { status: "em_resolucao", label: "Em Resolução", icon: Loader2, accent: "border-t-amber-500" },
  { status: "concluido", label: "Concluídos", icon: CheckCircle2, accent: "border-t-emerald-500" },
];

function TasksPage() {
  const { session } = useAuth();
  const me = session?.user?.id ?? "";
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const listUsersFn = useServerFn(listDirectoryUsers);

  const { data: users = [] } = useQuery({
    queryKey: ["directory_users"],
    queryFn: () => listUsersFn() as Promise<DirUser[]>,
  });

  const userName = (id: string) => {
    if (id === me) return "Você";
    const u = users.find((x) => x.id === id);
    return u?.name ?? "Usuário";
  };

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", me],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Task[];
    },
  });

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { aberto: [], em_resolucao: [], concluido: [] };
    for (const t of tasks) map[t.status].push(t);
    return map;
  }, [tasks]);

  const createTask = useMutation({
    mutationFn: async (p: { recipient_id: string; title: string; description: string }) => {
      const { error } = await supabase.from("tasks" as any).insert({
        sender_id: me,
        recipient_id: p.recipient_id,
        title: p.title,
        description: p.description || null,
        status: "aberto",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task enviada.");
      setShowCreate(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao enviar task."),
  });

  const setStatus = useMutation({
    mutationFn: async (p: { id: string; status: TaskStatus }) => {
      const { error } = await supabase
        .from("tasks" as any)
        .update({ status: p.status })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task_notifications"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar status."),
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task excluída.");
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir task."),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Gerenciador interno de tarefas. Você vê apenas as tasks que enviou ou recebeu.
          </p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Nova Task
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const Icon = col.icon;
            const items = byStatus[col.status];
            return (
              <div key={col.status} className="flex flex-col">
                <div className={`mb-3 flex items-center gap-2 rounded-md border-t-4 ${col.accent} bg-card px-3 py-2 shadow-sm`}>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
                </div>
                <div className="flex flex-col gap-3">
                  {items.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                      Nenhuma task aqui.
                    </p>
                  ) : (
                    items.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        me={me}
                        userName={userName}
                        onAdvance={(status) => setStatus.mutate({ id: t.id, status })}
                        onDelete={() => {
                          if (confirm(`Excluir a task "${t.title}"?`)) deleteTask.mutate(t.id);
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        users={users.filter((u) => u.id !== me)}
        onSave={(p) => createTask.mutate(p)}
        saving={createTask.isPending}
      />
    </div>
  );
}

function TaskCard({
  task,
  me,
  userName,
  onAdvance,
  onDelete,
}: {
  task: Task;
  me: string;
  userName: (id: string) => string;
  onAdvance: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const isRecipient = task.recipient_id === me;
  const isSender = task.sender_id === me;

  return (
    <Card className="space-y-2 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{task.title}</h3>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateBR(task.created_at)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">De: {userName(task.sender_id)}</span>
        <ArrowRight className="h-3 w-3" />
        <span className="font-medium text-foreground">Para: {userName(task.recipient_id)}</span>
      </div>

      {task.description && (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{task.description}</p>
      )}

      <div className="flex flex-wrap gap-1 pt-1">
        {/* The recipient drives the workflow. */}
        {isRecipient && task.status === "aberto" && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onAdvance("em_resolucao")}>
            <Play className="h-3 w-3" /> Iniciar
          </Button>
        )}
        {isRecipient && task.status === "em_resolucao" && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onAdvance("concluido")}>
            <Check className="h-3 w-3" /> Concluir
          </Button>
        )}
        {isRecipient && task.status === "concluido" && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onAdvance("em_resolucao")}>
            Reabrir
          </Button>
        )}
        {isSender && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1 text-xs text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" /> Excluir
          </Button>
        )}
      </div>
    </Card>
  );
}

function CreateTaskDialog({
  open,
  onClose,
  users,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  users: DirUser[];
  onSave: (p: { recipient_id: string; title: string; description: string }) => void;
  saving: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => { setRecipient(""); setTitle(""); setDescription(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Destinatário</Label>
            <Select value={recipient} onValueChange={setRecipient}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o destinatário" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} <span className="text-muted-foreground">({u.email})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Título do Pedido</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Revisar contrato" />
          </div>
          <div>
            <Label>Descrição detalhada</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o pedido…"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); reset(); }}>Cancelar</Button>
          <Button
            disabled={saving || !recipient || !title.trim()}
            onClick={() => { onSave({ recipient_id: recipient, title: title.trim(), description: description.trim() }); reset(); }}
          >
            {saving ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
