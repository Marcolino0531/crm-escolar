import { Bell, AlertTriangle, CalendarClock, ClipboardList, HandCoins } from "lucide-react";
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
import { formatDateBR, todayISOLocal, monthKeyFromISO } from "@/lib/date-utils";

type Notification = {
  id: string;
  task_id: string;
  message: string;
  read: boolean;
  created_at: string;
};

type OpenTask = {
  id: string;
  title: string;
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
  const { canView, canEdit } = usePermissions();
  const { schools } = useSchool();
  const qc = useQueryClient();
  const userId = session?.user?.id;
  const canTasks = canView("tasks");
  const canFluxo = canView("financeiro_fluxo");
  // Alerta do dia 25 é para o Administrador responsável pelo envio dos boletos
  // (quem pode marcar o checklist no módulo de Cobrança).
  const canCobranca = canEdit("cobranca");

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

  // --- New-task alerts for the recipient (derived from `tasks`; persistent and
  // NON-dismissible: they cannot be read/cleared manually. They stay active
  // while the task is in "Tickets Abertos" (status 'aberto') and disappear on
  // their own once the recipient moves the card to "Em Resolução"/"Concluídos". ---
  const { data: openTasks = [] } = useQuery({
    queryKey: ["task_open_for_me", userId ?? "anon"],
    enabled: !!userId && canTasks,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks" as any)
        .select("id, title, created_at")
        .eq("recipient_id", userId)
        .eq("status", "aberto")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [] as OpenTask[];
      return (data ?? []) as unknown as OpenTask[];
    },
  });

  // --- Accounts payable alerts (derived from Fluxo Futuro; NOT dismissible —
  // they persist until the bill's status becomes "paid" / quitada). ---
  const today = todayISOLocal();

  // --- Alerta do dia 25: data limite para envio dos boletos de mensalidade.
  // Aparece a partir do dia 25 e some assim que o checklist do mês é marcado. ---
  const competenciaAtual = monthKeyFromISO(today);
  const { data: cobrancaChecklist } = useQuery({
    queryKey: ["cobranca_checklist_alert", competenciaAtual, userId ?? "anon"],
    enabled: !!userId && canCobranca,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cobranca_checklist" as any)
        .select("boletos_enviados")
        .eq("competencia", competenciaAtual)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as { boletos_enviados: boolean } | null;
    },
  });
  const diaDoMes = new Date().getDate();
  const alertaBoletos = canCobranca && diaDoMes >= 25 && !cobrancaChecklist?.boletos_enviados;

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

  if (!userId || (!canTasks && !canFluxo && !canCobranca)) return null;

  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "";
  const overdue = forecasts.filter((f) => (f.due_date ?? "") < today);
  const dueToday = forecasts.filter((f) => (f.due_date ?? "") === today);
  const unreadTasks = notifications.filter((n) => !n.read);

  // Fluxo alerts + persistent new-task alerts always count as active; the
  // dismissible task notices count only while unread.
  const badge =
    unreadTasks.length + forecasts.length + openTasks.length + (alertaBoletos ? 1 : 0);

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
          {/* Cobrança: data limite (dia 25) para envio dos boletos de mensalidade. */}
          {alertaBoletos && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cobrança
              </div>
              <Link
                to="/cobranca"
                className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
              >
                <div className="flex items-start gap-2">
                  <HandCoins className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div className="min-w-0">
                    <div className="font-medium text-amber-600">
                      Atenção: Data limite para envio dos boletos de mensalidade
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Realize o envio dos boletos de todos os colégios e marque o checklist no
                      módulo de Cobrança.
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          )}

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

          {/* New tasks assigned to me: persistent until I move the card. */}
          {canTasks && openTasks.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tarefas atribuídas a você
              </div>
              {openTasks.map((t) => (
                <Link
                  key={t.id}
                  to="/tasks"
                  className="block border-b px-3 py-2 text-sm font-medium last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <div className="min-w-0">
                      <div>Nova tarefa: {t.title}</div>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatDateBR(t.created_at)}
                      </span>
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

          {badge === 0 &&
            notifications.length === 0 &&
            forecasts.length === 0 &&
            openTasks.length === 0 &&
            !alertaBoletos && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
