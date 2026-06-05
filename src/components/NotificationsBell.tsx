import { Bell, AlertTriangle, CalendarClock } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions, useSchool } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateBR, todayISOLocal } from "@/lib/date-utils";

type Notification = {
  id: string;
  task_id: string;
  message: string;
  read: boolean;
  created_at: string;
};

type Forecast = {
  id: string;
  description: string;
  due_date: string | null;
  projected_amount: number;
  status: string;
  school_id: string;
};

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function NotificationsBell() {
  const { session } = useAuth();
  const { canView } = usePermissions();
  const { schools } = useSchool();
  const qc = useQueryClient();
  const userId = session?.user?.id;
  const canTasks = canView("tasks");
  const canFluxo = canView("financeiro_fluxo");

  // --- Task notifications (dismissible: clear on open) ---
  const { data: notifications = [] } = useQuery({
    queryKey: ["task_notifications", userId ?? "anon"],
    enabled: !!userId && canTasks,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_notifications" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) return [] as Notification[];
      return (data ?? []) as unknown as Notification[];
    },
  });

  // --- Accounts payable alerts (derived from Fluxo Futuro; NOT dismissible —
  // they persist until the bill's status becomes "paid" / quitada). ---
  const today = todayISOLocal();
  const { data: forecasts = [] } = useQuery({
    queryKey: ["fluxo_alerts", today],
    enabled: !!userId && canFluxo,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_forecasts")
        .select("id, description, due_date, projected_amount, status, school_id")
        .neq("status", "paid")
        .not("due_date", "is", null)
        .lte("due_date", today)
        .order("due_date", { ascending: true });
      if (error) return [] as Forecast[];
      return (data ?? []) as unknown as Forecast[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("task_notifications" as any)
        .update({ read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task_notifications"] }),
  });

  if (!userId || (!canTasks && !canFluxo)) return null;

  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "";
  const overdue = forecasts.filter((f) => (f.due_date ?? "") < today);
  const dueToday = forecasts.filter((f) => (f.due_date ?? "") === today);
  const unreadTasks = notifications.filter((n) => !n.read);

  // Fluxo alerts always count as active; task notices count while unread.
  const badge = unreadTasks.length + forecasts.length;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && unreadTasks.length > 0) markRead.mutate(unreadTasks.map((n) => n.id));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" title="Notificações">
          <Bell className="h-5 w-5" />
          {badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Notificações</div>
        <div className="max-h-96 overflow-y-auto">
          {/* Accounts payable: overdue first (red), then due today. */}
          {canFluxo && (overdue.length > 0 || dueToday.length > 0) && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Contas a pagar
              </div>
              {overdue.map((f) => (
                <Link
                  key={f.id}
                  to="/fluxo-futuro"
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-red-600">
                        Conta atrasada: {f.description}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtBRL(Number(f.projected_amount) || 0)} · venceu em {formatDateBR(f.due_date)}
                        {schoolName(f.school_id) ? ` · ${schoolName(f.school_id)}` : ""}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
              {dueToday.map((f) => (
                <Link
                  key={f.id}
                  to="/fluxo-futuro"
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <div className="font-medium">Vence hoje: {f.description}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtBRL(Number(f.projected_amount) || 0)} · vence em {formatDateBR(f.due_date)}
                        {schoolName(f.school_id) ? ` · ${schoolName(f.school_id)}` : ""}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Task notifications. */}
          {canTasks && notifications.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tasks
              </div>
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  to="/tasks"
                  className={`block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent ${
                    n.read ? "text-muted-foreground" : "font-medium"
                  }`}
                >
                  {!n.read && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />}
                  {n.message}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {formatDateBR(n.created_at)}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {badge === 0 && notifications.length === 0 && forecasts.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
