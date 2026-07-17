import {
  Bell,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  HandCoins,
  Shirt,
  CreditCard,
  BookOpen,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions, useSchool } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateBR, todayISOLocal, monthKeyFromISO } from "@/lib/date-utils";
import { STORES, isValeDoSerenoProductName, type StoreKey } from "@/lib/nuvemshop.stores";

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

type AgendaNotification = {
  id: string;
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
  month: string;
};

type LowStockVariant = {
  id: string;
  store_key: StoreKey;
  ns_product_id: string;
  stock: number;
  min_stock: number;
};

type AvailableReceivable = {
  id: string;
  valor_liquido: number;
};

type ExtraEvent = {
  id: string;
  label: string;
  meal: string | null;
  created_at: string;
  student: { name: string } | null;
};

// Texto fixo por loja exibido no sininho (1 alerta agrupado por loja).
const LOW_STOCK_ALERT_TEXT: Record<StoreKey, string> = {
  belvedere: "Estoque baixo detectado no Núcleo Belvedere e Vale do Sereno",
  cec: "Estoque baixo detectado no CEC e CEC Baby",
};

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function NotificationsBell() {
  const { session } = useAuth();
  const { canView, canEdit } = usePermissions();
  const { schools, setSelected } = useSchool();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const userId = session?.user?.id;
  const canTasks = canView("tasks");
  const canFluxo = canView("financeiro_fluxo");
  const canUniformes = canView("uniformes");
  const canCartao = canView("financeiro_cartao");
  const canDiario = canView("diario");
  const canAgenda = canView("agenda");
  // Alerta do dia 25 é para o Administrador responsável pelo envio dos boletos
  // (quem pode marcar o checklist no módulo de Cobrança).
  const canCobranca = canEdit("financeiro_cobranca");

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
        .select("id, description, due_date, projected_amount, status, school_id, month")
        .neq("status", "paid")
        .not("due_date", "is", null)
        .lte("due_date", today)
        .order("due_date", { ascending: true });
      if (error) return [] as Forecast[];
      return (data ?? []) as unknown as Forecast[];
    },
  });

  // --- Low-stock uniform alerts (derived from uniform_variants; NOT dismissible —
  // persist while any variant is at/under its min_stock threshold). ---
  const { data: lowStock = [] } = useQuery({
    queryKey: ["uniform_low_stock"],
    enabled: !!userId && canUniformes,
    refetchInterval: 60000,
    queryFn: async () => {
      const [vRes, pRes] = await Promise.all([
        supabase
          .from("uniform_variants" as any)
          .select("id, store_key, ns_product_id, stock, min_stock")
          .order("stock", { ascending: true })
          .limit(1000),
        supabase.from("uniform_products" as any).select("store_key, ns_product_id, name"),
      ]);
      if (vRes.error) return [] as LowStockVariant[];
      const nameByKey = new Map<string, string>();
      for (const p of (pRes.data ?? []) as unknown as {
        store_key: string;
        ns_product_id: string;
        name: string | null;
      }[]) {
        nameByKey.set(`${p.store_key}:${p.ns_product_id}`, p.name ?? "");
      }
      return ((vRes.data ?? []) as unknown as LowStockVariant[])
        .filter((v) => v.stock <= v.min_stock)
        // Vale do Sereno em descontinuação: não dispara alerta no sininho.
        .filter((v) => !isValeDoSerenoProductName(nameByKey.get(`${v.store_key}:${v.ns_product_id}`)));
    },
  });

  // --- Recebíveis de cartão disponíveis para transferência (derivado ao vivo:
  // status != 'transferido' e a data de disponibilidade já chegou). NÃO
  // dismissível — some quando o recebível é marcado como transferido. ---
  const { data: availableReceivables = [] } = useQuery({
    queryKey: ["credit_card_available", today],
    enabled: !!userId && canCartao,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_card_receivables" as any)
        .select("id, valor_liquido")
        .neq("status", "transferido")
        .lte("data_disponibilidade", today)
        .order("data_disponibilidade", { ascending: true });
      if (error) return [] as AvailableReceivable[];
      return (data ?? []) as unknown as AvailableReceivable[];
    },
  });

  // --- Consumos extras do Diário do Aluno registrados HOJE (refeição/horário
  // fora do contratado). NÃO dismissível — a lista some naturalmente no dia
  // seguinte. Alerta a gestão sobre cobranças extras geradas. ---
  const { data: extraEvents = [] } = useQuery({
    queryKey: ["diario_extra_today", today],
    enabled: !!userId && canDiario,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diario_events" as never)
        .select("id, label, meal, created_at, student:diario_students(name)")
        .eq("extra_charge", true)
        .gte("created_at", `${today}T00:00:00`)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) return [] as ExtraEvent[];
      return (data ?? []) as unknown as ExtraEvent[];
    },
  });

  // --- Agenda notifications (dismissible: clear on open) — geradas quando o
  // usuário é incluído no campo "Equipe" de uma reunião. ---
  const { data: agendaNotifications = [] } = useQuery({
    queryKey: ["agenda_notifications", userId ?? "anon"],
    enabled: !!userId && canAgenda,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_notifications" as any)
        .select("id, message, read, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) return [] as AgendaNotification[];
      return (data ?? []) as unknown as AgendaNotification[];
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

  const markAgendaRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("agenda_notifications" as any)
        .update({ read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_notifications"] }),
  });

  if (
    !userId ||
    (!canTasks &&
      !canFluxo &&
      !canCobranca &&
      !canUniformes &&
      !canCartao &&
      !canDiario &&
      !canAgenda)
  )
    return null;

  // Agrupa as variações em baixo estoque por loja: 1 alerta por grupo de
  // unidades, na ordem canônica das lojas.
  const lowStockStores = STORES.map((s) => s.key).filter((key) =>
    lowStock.some((v) => v.store_key === key),
  );

  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "";
  const overdue = forecasts.filter((f) => (f.due_date ?? "") < today);
  const dueToday = forecasts.filter((f) => (f.due_date ?? "") === today);
  const unreadTasks = notifications.filter((n) => !n.read);
  const unreadAgenda = agendaNotifications.filter((n) => !n.read);

  // Fluxo alerts + persistent new-task alerts always count as active; the
  // dismissible task notices count only while unread.
  const badge =
    unreadTasks.length +
    forecasts.length +
    openTasks.length +
    lowStockStores.length +
    availableReceivables.length +
    extraEvents.length +
    unreadAgenda.length +
    (alertaBoletos ? 1 : 0);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && unreadTasks.length > 0) markRead.mutate(unreadTasks.map((n) => n.id));
        if (o && unreadAgenda.length > 0) markAgendaRead.mutate(unreadAgenda.map((n) => n.id));
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

          {/* Uniformes: 1 alerta agrupado por loja quando há itens em baixo estoque. */}
          {canUniformes && lowStockStores.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Uniformes
              </div>
              {lowStockStores.map((key) => (
                <Link
                  key={key}
                  to="/uniformes"
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <Shirt className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-red-600">{LOW_STOCK_ALERT_TEXT[key]}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Recebíveis de cartão liberados: transferir para a conta do colégio. */}
          {canCartao && availableReceivables.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cartão de Crédito
              </div>
              {availableReceivables.map((r) => (
                <Link
                  key={r.id}
                  to="/cartao-credito"
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-emerald-600">
                        Crédito de {fmtBRL(Number(r.valor_liquido) || 0)} disponível.
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        É necessário realizar a transferência para a conta do colégio.
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Diário do Aluno: consumos extras (refeição/horário fora do contratado). */}
          {canDiario && extraEvents.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Diário do Aluno
              </div>
              {extraEvents.map((e) => (
                <Link
                  key={e.id}
                  to="/diario"
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-amber-600">
                        Consumo extra: {e.student?.name ?? "Aluno"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {e.label} — cobrança extra gerada para a família.
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Agenda: você foi incluído na Equipe de uma reunião. */}
          {canAgenda && agendaNotifications.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Agenda
              </div>
              {agendaNotifications.map((n) => (
                <Link
                  key={n.id}
                  to="/agenda"
                  className={`block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent ${
                    n.read ? "text-muted-foreground" : "font-medium"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <div className="min-w-0">
                      <div>{n.message}</div>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatDateBR(n.created_at)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
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
                  search={{ focus: f.id, month: f.month }}
                  onClick={() => {
                    setSelected(f.school_id);
                    setOpen(false);
                  }}
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-red-600">
                        Conta atrasada: {f.description}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtBRL(Number(f.projected_amount) || 0)} · venceu em{" "}
                        {formatDateBR(f.due_date)}
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
                  search={{ focus: f.id, month: f.month }}
                  onClick={() => {
                    setSelected(f.school_id);
                    setOpen(false);
                  }}
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <div className="font-medium">Vence hoje: {f.description}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmtBRL(Number(f.projected_amount) || 0)} · vence em{" "}
                        {formatDateBR(f.due_date)}
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
                  {!n.read && (
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
                  )}
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
            agendaNotifications.length === 0 &&
            forecasts.length === 0 &&
            openTasks.length === 0 &&
            lowStockStores.length === 0 &&
            availableReceivables.length === 0 &&
            extraEvents.length === 0 &&
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
