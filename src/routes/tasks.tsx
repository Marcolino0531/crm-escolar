import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, ArrowRight, Trash2, Play, Check, Inbox, Loader2, CheckCircle2, MessageSquare, Send } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateBR } from "@/lib/date-utils";

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  aberto: "Aberto",
  em_resolucao: "Em Resolução",
  concluido: "Concluído",
};

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
  completed_at: string | null;
};

// Concluídos só exibe entregas dos últimos 7 dias; as mais antigas seguem
// salvas no banco (arquivadas), apenas fora do quadro.
const CONCLUIDO_VISIBLE_DAYS = 7;
function isRecentlyCompleted(completedAt: string | null): boolean {
  if (!completedAt) return false;
  const done = new Date(completedAt).getTime();
  if (isNaN(done)) return false;
  return Date.now() - done <= CONCLUIDO_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
}
type DirUser = { id: string; name: string };

const COLUMNS: { status: TaskStatus; label: string; icon: any; accent: string }[] = [
  { status: "aberto", label: "Tickets Abertos", icon: Inbox, accent: "border-t-blue-500" },
  { status: "em_resolucao", label: "Em Resolução", icon: Loader2, accent: "border-t-amber-500" },
  { status: "concluido", label: "Concluídos", icon: CheckCircle2, accent: "border-t-emerald-500" },
];

function TasksPage() {
  const { session } = useAuth();
  const { canEdit } = usePermissions();
  const podeCriar = canEdit("tasks");
  const me = session?.user?.id ?? "";
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [view, setView] = useState<"recebidas" | "enviadas">("recebidas");
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

  const visibleTasks = useMemo(() => {
    if (view === "recebidas") {
      // Tasks que vou executar (inclui as que deleguei a mim mesmo).
      return tasks.filter((t) => t.recipient_id === me);
    }
    // Enviadas: criadas por mim e direcionadas a outra pessoa.
    return tasks.filter((t) => t.sender_id === me && t.recipient_id !== me);
  }, [tasks, view, me]);

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { aberto: [], em_resolucao: [], concluido: [] };
    for (const t of visibleTasks) {
      // Arquivamento automático: concluídas há mais de 7 dias somem do quadro.
      if (t.status === "concluido" && !isRecentlyCompleted(t.completed_at)) continue;
      map[t.status].push(t);
    }
    return map;
  }, [visibleTasks]);

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
      qc.invalidateQueries({ queryKey: ["task_open_for_me"] });
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
      qc.invalidateQueries({ queryKey: ["task_open_for_me"] });
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
        {podeCriar && (
          <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Nova Task
          </Button>
        )}
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as "recebidas" | "enviadas")}>
        <TabsList>
          <TabsTrigger value="recebidas">Recebidas</TabsTrigger>
          <TabsTrigger value="enviadas">Enviadas</TabsTrigger>
        </TabsList>
      </Tabs>

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
                        onOpen={() => setOpenTaskId(t.id)}
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
        users={users}
        me={me}
        onSave={(p) => createTask.mutate(p)}
        saving={createTask.isPending}
      />

      <TaskChatSheet
        task={tasks.find((t) => t.id === openTaskId) ?? null}
        me={me}
        userName={userName}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}

function TaskChatSheet({
  task,
  me,
  userName,
  onClose,
}: {
  task: Task | null;
  me: string;
  userName: (id: string) => string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["task_messages", task?.id ?? "none"],
    enabled: !!task,
    refetchInterval: task ? 10000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_messages" as any)
        .select("*")
        .eq("task_id", task!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as {
        id: string;
        author_id: string;
        body: string;
        created_at: string;
      }[];
    },
  });

  const send = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase.from("task_messages" as any).insert({
        task_id: task!.id,
        author_id: me,
        body: text,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["task_messages", task?.id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao enviar mensagem."),
  });

  return (
    <Sheet open={!!task} onOpenChange={(v) => { if (!v) { onClose(); setBody(""); } }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {task && (
          <>
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="pr-6 text-base leading-tight">{task.title}</SheetTitle>
              <div className="space-y-1.5 pt-1 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-medium text-foreground">De: {userName(task.sender_id)}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium text-foreground">Para: {userName(task.recipient_id)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{STATUS_LABEL[task.status]}</Badge>
                  <span>Criada: {formatDateBR(task.created_at)}</span>
                  {task.completed_at && (
                    <span className="text-emerald-600">Finalizada: {formatDateBR(task.completed_at)}</span>
                  )}
                </div>
                {task.description && (
                  <p className="whitespace-pre-wrap pt-1 text-foreground">{task.description}</p>
                )}
              </div>
            </SheetHeader>

            <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> Observações
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
              {isLoading ? (
                <p className="text-xs text-muted-foreground">Carregando…</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  Nenhuma mensagem ainda. Inicie a conversa abaixo.
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.author_id === me;
                  return (
                    <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <div className={`mb-0.5 text-[10px] font-semibold ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                          {userName(m.author_id)}
                        </div>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                      <span className="mt-0.5 text-[10px] text-muted-foreground">{fmtDateTime(m.created_at)}</span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Escreva uma observação…"
                  rows={2}
                  className="resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (body.trim()) send.mutate(body.trim());
                    }
                  }}
                />
                <Button
                  size="icon"
                  disabled={send.isPending || !body.trim()}
                  onClick={() => body.trim() && send.mutate(body.trim())}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskCard({
  task,
  me,
  userName,
  onOpen,
  onAdvance,
  onDelete,
}: {
  task: Task;
  me: string;
  userName: (id: string) => string;
  onOpen: () => void;
  onAdvance: (status: TaskStatus) => void;
  onDelete: () => void;
}) {
  const isRecipient = task.recipient_id === me;
  const isSender = task.sender_id === me;
  // Keep action-button clicks from also opening the chat panel.
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <Card
      className="cursor-pointer space-y-2 p-3 shadow-sm transition-colors hover:bg-accent/40"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{task.title}</h3>
        <div className="flex shrink-0 flex-col items-end text-[11px] text-muted-foreground">
          <span>Criada: {formatDateBR(task.created_at)}</span>
          {task.completed_at && (
            <span className="text-emerald-600">Finalizada: {formatDateBR(task.completed_at)}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">De: {userName(task.sender_id)}</span>
        <ArrowRight className="h-3 w-3" />
        <span className="font-medium text-foreground">Para: {userName(task.recipient_id)}</span>
      </div>

      {task.description && (
        <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{task.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-1 pt-1">
        {/* The recipient drives the workflow. */}
        {isRecipient && task.status === "aberto" && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={stop(() => onAdvance("em_resolucao"))}>
            <Play className="h-3 w-3" /> Iniciar
          </Button>
        )}
        {isRecipient && task.status === "em_resolucao" && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={stop(() => onAdvance("concluido"))}>
            <Check className="h-3 w-3" /> Concluir
          </Button>
        )}
        {isRecipient && task.status === "concluido" && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={stop(() => onAdvance("em_resolucao"))}>
            Reabrir
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={stop(onOpen)}>
          <MessageSquare className="h-3 w-3" /> Observações
        </Button>
        {isSender && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1 text-xs text-destructive"
            onClick={stop(onDelete)}
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
  me,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  users: DirUser[];
  me: string;
  onSave: (p: { recipient_id: string; title: string; description: string }) => void;
  saving: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // O próprio usuário aparece como opção (autoatribuição), listado primeiro.
  const orderedUsers = useMemo(
    () => [...users].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0)),
    [users, me],
  );

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
                {orderedUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.id === me ? `${u.name} (Você)` : u.name}
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
