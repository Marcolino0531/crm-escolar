import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
  Trash2,
  Check,
  RotateCcw,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateBR, todayISOLocal } from "@/lib/date-utils";
import {
  resolveOccurrenceDate,
  resolveOccurrenceDay,
  monthKey as monthKeyOf,
  completedKey,
  occurrenceStatus,
  dueOccurrences,
  type RecurringTaskDef,
  type OccurrenceStatus,
} from "@/lib/recurring-tasks";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type Completion = { def_id: string; month_key: string };

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - r.getDay());
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATUS_CHIP: Record<OccurrenceStatus, string> = {
  cumprida: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  vencida: "border-red-300 bg-red-50 text-red-800 hover:bg-red-100",
  futura: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
};
const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  cumprida: "Cumprida",
  vencida: "Vencida",
  futura: "Pendente",
};

export function PlannerView() {
  const { session } = useAuth();
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("tasks");
  const me = session?.user?.id ?? "";
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(() => new Date());
  const [novaOpen, setNovaOpen] = useState(false);
  const today = todayISOLocal();

  const { data: defs = [], isLoading: loadingDefs } = useQuery({
    queryKey: ["recurring_task_defs", me],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_task_defs" as never)
        .select("id, title, description, day_of_month")
        .eq("active", true)
        .order("day_of_month", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as RecurringTaskDef[];
    },
  });

  const { data: completions = [], isLoading: loadingComp } = useQuery({
    queryKey: ["recurring_task_completions", me],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_task_completions" as never)
        .select("def_id, month_key");
      if (error) throw error;
      return (data ?? []) as unknown as Completion[];
    },
  });

  const completedSet = useMemo(
    () => new Set(completions.map((c) => completedKey(c.def_id, c.month_key))),
    [completions],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["recurring_task_defs"] });
    qc.invalidateQueries({ queryKey: ["recurring_task_completions"] });
    qc.invalidateQueries({ queryKey: ["recurring_planner_due"] });
  };

  const createDef = useMutation({
    mutationFn: async (p: { title: string; day_of_month: number; description: string }) => {
      const { error } = await supabase.from("recurring_task_defs" as never).insert({
        user_id: me,
        title: p.title,
        day_of_month: p.day_of_month,
        description: p.description || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Rotina criada.");
      setNovaOpen(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "Erro ao criar rotina."),
  });

  const deleteDef = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("recurring_task_defs" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Rotina excluída.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Erro ao excluir rotina."),
  });

  const toggleComplete = useMutation({
    mutationFn: async (p: { defId: string; mk: string; done: boolean }) => {
      if (p.done) {
        const { error } = await supabase
          .from("recurring_task_completions" as never)
          .upsert({ def_id: p.defId, user_id: me, month_key: p.mk } as never, {
            onConflict: "def_id,month_key",
          });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("recurring_task_completions" as never)
          .delete()
          .eq("def_id", p.defId)
          .eq("month_key", p.mk);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message ?? "Erro ao atualizar a rotina."),
  });

  const title = useMemo(
    () => capitalize(cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })),
    [cursor],
  );

  const go = (dir: -1 | 1) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));

  // Ocorrências (rotina + data) do mês em exibição, agrupadas por dia ISO.
  const occByDay = useMemo(() => {
    const y = cursor.getFullYear();
    const m0 = cursor.getMonth();
    const mk = monthKeyOf(y, m0);
    const map = new Map<string, { def: RecurringTaskDef; status: OccurrenceStatus }[]>();
    for (const def of defs) {
      const date = resolveOccurrenceDate(y, m0, def.day_of_month);
      const status = occurrenceStatus(date, completedSet.has(completedKey(def.id, mk)), today);
      const arr = map.get(date) ?? [];
      arr.push({ def, status });
      map.set(date, arr);
    }
    for (const arr of map.values())
      arr.sort((a, b) => a.def.title.localeCompare(b.def.title, "pt-BR"));
    return map;
  }, [defs, completedSet, cursor, today]);

  // Vencidas e pendentes do MÊS CORRENTE (independe do mês visualizado) —
  // mesma base do aviso persistente do sininho.
  const vencidas = useMemo(
    () => dueOccurrences(defs, completedSet, today),
    [defs, completedSet, today],
  );

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);
  const month = cursor.getMonth();
  const loading = loadingDefs || loadingComp;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Tarefas de rotina que se repetem todo mês num dia fixo. Marque como cumprida a cada mês.
        </p>
        {podeEditar && (
          <Button size="sm" className="gap-1" onClick={() => setNovaOpen(true)}>
            <Plus className="h-4 w-4" /> Nova Rotina
          </Button>
        )}
      </div>

      {/* Alerta destacado das rotinas vencidas e pendentes do mês corrente. */}
      {vencidas.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {vencidas.length} rotina{vencidas.length === 1 ? "" : "s"} vencida
            {vencidas.length === 1 ? "" : "s"} e pendente{vencidas.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-col gap-1.5">
            {vencidas.map(({ def, date, monthKey }) => (
              <div
                key={def.id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  <span className="truncate">
                    <span className="font-medium">{def.title}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      · venceu em {formatDateBR(date)}
                    </span>
                  </span>
                </span>
                {podeEditar && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 text-xs"
                    disabled={toggleComplete.isPending}
                    onClick={() =>
                      toggleComplete.mutate({ defId: def.id, mk: monthKey, done: true })
                    }
                  >
                    <Check className="h-3.5 w-3.5" /> Cumprir
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => go(-1)}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => go(1)}
            aria-label="Próximo"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setCursor(new Date())}>
            Hoje
          </Button>
          <span className="ml-2 flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4" /> {title}
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const iso = toISO(d);
              const occ = occByDay.get(iso) ?? [];
              const inMonth = d.getMonth() === month;
              const isToday = iso === today;
              return (
                <div
                  key={i}
                  className={`min-h-[104px] border-b border-r p-1.5 ${i % 7 === 6 ? "border-r-0" : ""} ${
                    inMonth ? "" : "bg-muted/20"
                  }`}
                >
                  <div
                    className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isToday
                        ? "bg-primary font-semibold text-primary-foreground"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground/60"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="flex flex-col gap-1">
                    {occ.map(({ def, status }) => (
                      <OccurrenceChip
                        key={def.id}
                        def={def}
                        status={status}
                        date={iso}
                        monthKey={monthKeyOf(cursor.getFullYear(), cursor.getMonth())}
                        podeEditar={podeEditar}
                        busy={toggleComplete.isPending}
                        onToggle={(done, mk) => toggleComplete.mutate({ defId: def.id, mk, done })}
                        onDelete={() => {
                          if (confirm(`Excluir a rotina "${def.title}"?`)) deleteDef.mutate(def.id);
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {defs.length === 0 && !loading && (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhuma rotina cadastrada. Clique em "Nova Rotina" para começar.
        </p>
      )}

      {podeEditar && (
        <NovaRotinaDialog
          open={novaOpen}
          onClose={() => setNovaOpen(false)}
          onSave={(p) => createDef.mutate(p)}
          saving={createDef.isPending}
        />
      )}
    </div>
  );
}

function OccurrenceChip({
  def,
  status,
  date,
  monthKey,
  podeEditar,
  busy,
  onToggle,
  onDelete,
}: {
  def: RecurringTaskDef;
  status: OccurrenceStatus;
  date: string;
  monthKey: string;
  podeEditar: boolean;
  busy: boolean;
  onToggle: (done: boolean, mk: string) => void;
  onDelete: () => void;
}) {
  const dia = resolveOccurrenceDay(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    def.day_of_month,
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-colors ${STATUS_CHIP[status]}`}
        >
          {status === "cumprida" && <Check className="h-3 w-3 shrink-0" />}
          {status === "vencida" && <AlertTriangle className="h-3 w-3 shrink-0" />}
          <span className="truncate">{def.title}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{def.title}</span>
            <Badge variant="secondary" className="text-[10px]">
              {STATUS_LABEL[status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Todo dia {def.day_of_month} · esta ocorrência: {formatDateBR(date)}
            {dia !== def.day_of_month ? " (ajustado ao fim do mês)" : ""}
          </p>
          {def.description && (
            <p className="whitespace-pre-wrap text-xs text-foreground">{def.description}</p>
          )}
          {podeEditar && (
            <div className="flex flex-col gap-1 pt-1">
              {status === "cumprida" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 justify-start gap-1 text-xs"
                  disabled={busy}
                  onClick={() => onToggle(false, monthKey)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reabrir (marcar como pendente)
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 justify-start gap-1 text-xs"
                  disabled={busy}
                  onClick={() => onToggle(true, monthKey)}
                >
                  <Check className="h-3.5 w-3.5" /> Marcar como cumprida
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 justify-start gap-1 text-xs text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir rotina
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NovaRotinaDialog({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: { title: string; day_of_month: number; description: string }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [dia, setDia] = useState("1");
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setDia("1");
    setDescription("");
  };

  const diaNum = Math.trunc(Number(dia));
  const diaValido = Number.isFinite(diaNum) && diaNum >= 1 && diaNum <= 31;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Rotina</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Título da tarefa</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Enviar o faturamento para a contabilidade"
            />
          </div>
          <div>
            <Label>Dia do mês</Label>
            <Input
              type="number"
              min={1}
              max={31}
              value={dia}
              onChange={(e) => setDia(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              A rotina se repete todo mês neste dia. Dias inexistentes (ex.: 31 em fevereiro) caem
              no último dia do mês.
            </p>
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes da rotina…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Cancelar
          </Button>
          <Button
            disabled={saving || !title.trim() || !diaValido}
            onClick={() => {
              onSave({
                title: title.trim(),
                day_of_month: diaNum,
                description: description.trim(),
              });
              reset();
            }}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
