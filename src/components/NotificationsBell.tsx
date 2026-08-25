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
  PartyPopper,
  Check,
  Tags,
  FileSpreadsheet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { useAuth, usePermissions, useSchool } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateBR, todayISOLocal, monthKeyFromISO } from "@/lib/date-utils";
import { STORES, type StoreKey } from "@/lib/nuvemshop.stores";
import { pendenteDePedido } from "@/lib/uniformes-pedido";
import {
  mondayOf,
  addDays,
  toYMD,
  descricaoPendenciaPortaria,
  labelPendenciaPortaria,
  pendenciaPortaria,
  type ColoniaRecordType,
  type PendenciaPortaria,
  type RegistroPortaria,
} from "@/lib/colonia";
import {
  dueOccurrences,
  completedKey,
  type RecurringTaskDef,
  type DueOccurrence,
} from "@/lib/recurring-tasks";
import {
  mensagemCategorizacao,
  mensagemConciliacao,
  pendenciasCategorizacao,
  pendenciasConciliacao,
  type PendenciaMensal,
  type TransacaoPendencia,
} from "@/lib/financeiro-pendencias";
import { alertaExecucaoCron, type ExecucaoCron } from "@/lib/billing-cron-runs";
import {
  contadorNaoLidas,
  idsParaConcluirAutomaticamente,
  momentoLocal,
  notificacoesPendentes,
  type NotificacaoReuniao,
} from "@/lib/agenda-notifications";
import { isDiaUtil } from "@/lib/billing-schedule";

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
  month: string;
};

type LowStockVariant = {
  id: string;
  store_key: StoreKey;
  ns_product_id: string;
  stock: number;
  min_stock: number;
  order_placed_at: string | null;
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

type ColoniaPendencia = {
  studentId: string;
  name: string;
};

type ColoniaDiaIncompleto = {
  studentId: string;
  schoolId: string;
  name: string;
  dia: string; // YYYY-MM-DD
  pendencia: PendenciaPortaria;
};

type EmbeddedStudentName = { name: string } | { name: string }[] | null;

type ColoniaRegistroSemana = {
  student_id: string;
  school_id: string;
  diario_students: EmbeddedStudentName;
};

type ColoniaRegistroIntegridade = {
  student_id: string;
  school_id: string;
  record_type: ColoniaRecordType;
  occurred_at: string;
  diario_students: EmbeddedStudentName;
};

type PagedRows<T> = { data: T[] | null; error: PostgrestError | null };

// Janela de varredura das pendências financeiras do sininho (meses para trás).
const PENDENCIAS_MESES = 12;

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
  const canColonia = canView("colonia");
  const canColoniaFin = canView("colonia_financeiro");
  const canExtrato = canView("financeiro_dashboard");
  const canConciliacao = canView("financeiro_conciliacao");
  // Alerta do dia 25 é para o Administrador responsável pelo envio dos boletos
  // (quem pode marcar o checklist no módulo de Cobrança).
  const canCobranca = canEdit("financeiro_cobranca");

  // --- Task notifications ("Task Concluída" — únicas descartáveis: cada uma
  // tem um check para marcar como lida e sair da lista; não há descarte em
  // massa). ---
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

  const today = todayISOLocal();

  // --- Rotinas do Planner vencidas e pendentes (derivadas ao vivo; persistem
  // enquanto a ocorrência do mês não for marcada como cumprida — não somem por
  // passar o dia nem por recarregar; só ao cumprir). ---
  const { data: plannerDue = [] } = useQuery({
    queryKey: ["recurring_planner_due", userId ?? "anon", today],
    enabled: !!userId && canTasks,
    refetchInterval: 60000,
    queryFn: async () => {
      const [defsRes, compRes] = await Promise.all([
        supabase
          .from("recurring_task_defs" as never)
          .select("id, title, description, day_of_month, start_month")
          .eq("active", true),
        supabase.from("recurring_task_completions" as never).select("def_id, month_key"),
      ]);
      if (defsRes.error) return [] as DueOccurrence[];
      const defs = (defsRes.data ?? []) as unknown as RecurringTaskDef[];
      const completed = new Set(
        ((compRes.data ?? []) as unknown as { def_id: string; month_key: string }[]).map((c) =>
          completedKey(c.def_id, c.month_key),
        ),
      );
      return dueOccurrences(defs, completed, today);
    },
  });

  // --- Accounts payable alerts (derived from Fluxo Futuro; NOT dismissible —
  // they persist until the bill's status becomes "paid" / quitada). ---

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

  // --- Cobrança automática: aviso quando nenhuma tentativa do dia foi concluída
  // (disparo perdido) ou quando alguma falhou. Some sozinho quando uma tentativa
  // posterior conclui o dia. ---
  const hojeBRT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const { data: cronRuns = [] } = useQuery({
    queryKey: ["cobranca_cron_runs_alert", hojeBRT, userId ?? "anon"],
    enabled: !!userId && canCobranca,
    refetchInterval: 300000,
    queryFn: async (): Promise<ExecucaoCron[]> => {
      const { data, error } = await supabase
        .from("whatsapp_cron_runs" as never)
        .select("data_ref, slot, status, enviados, falhas")
        .eq("data_ref", hojeBRT);
      if (error) return [];
      return (data ?? []) as unknown as ExecucaoCron[];
    },
  });
  const horaBRT = Number(
    new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }),
  );
  const alertaCron = canCobranca
    ? alertaExecucaoCron(cronRuns, hojeBRT, horaBRT, isDiaUtil(hojeBRT))
    : null;

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
          .select("id, store_key, ns_product_id, stock, min_stock, order_placed_at")
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
      // Só as peças que ainda são repostas e cujo pedido à fábrica ainda não
      // foi marcado: fora ficam as de algodão (sob encomenda), o uniforme
      // antigo do CEC/CEC Baby (sem "/ Azul") e o Vale do Sereno, em
      // descontinuação.
      return ((vRes.data ?? []) as unknown as LowStockVariant[]).filter((v) =>
        pendenteDePedido({
          storeKey: v.store_key,
          produto: nameByKey.get(`${v.store_key}:${v.ns_product_id}`),
          stock: v.stock,
          minStock: v.min_stock,
          orderPlacedAt: v.order_placed_at,
        }),
      );
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

  // --- Agenda notifications — geradas quando o usuário é incluído no campo
  // "Equipe" de uma reunião. Concluir (check ou reunião que passou) tira da
  // lista sem apagar do banco. ---
  const { data: agendaTodas = [] } = useQuery({
    queryKey: ["agenda_notifications", userId ?? "anon"],
    enabled: !!userId && canAgenda,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_notifications" as any)
        .select("id, message, read, created_at, concluded_at, reuniao:reuniao_id(data, horario)")
        .is("concluded_at", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) return [] as NotificacaoReuniao[];
      return (data ?? []) as unknown as NotificacaoReuniao[];
    },
  });

  // Reunião que já aconteceu sai da lista sozinha; a conclusão é gravada num
  // efeito, para o histórico acompanhar o que a tela deixou de mostrar.
  const agoraLocal = momentoLocal(new Date());

  // --- Colônia de Férias: verificação de fim de semana. Lista os alunos que
  // têm consumos registrados na semana Mon–Fri encerrada mas cujo fechamento
  // NÃO foi resolvido (nem "Faturar no Sponte" nem "Já lançado / Acordo
  // manual"). O alerta aparece a partir do sábado e persiste pela semana
  // seguinte até ser resolvido. NÃO dismissível — some ao resolver. ---
  const coloniaNow = new Date();
  const coloniaDow = coloniaNow.getDay();
  const coloniaThisMonday = mondayOf(coloniaNow);
  // No fim de semana (sáb/dom) referencia a semana atual (que acabou na sexta);
  // de seg a sex ainda referencia a semana anterior — janela rolante de 7 dias.
  const coloniaWeekMonday =
    coloniaDow === 0 || coloniaDow === 6 ? coloniaThisMonday : addDays(coloniaThisMonday, -7);
  const coloniaWeekSaturday = addDays(coloniaWeekMonday, 5);
  const coloniaWeekStartYMD = toYMD(coloniaWeekMonday);
  const { data: coloniaPendencias = [] } = useQuery({
    queryKey: ["colonia_pendencias_semana", coloniaWeekStartYMD, userId ?? "anon"],
    enabled: !!userId && canColoniaFin,
    refetchInterval: 60000,
    queryFn: async () => {
      const [registros, statusRes] = await Promise.all([
        fetchAllRows<ColoniaRegistroSemana>(
          (from, to) =>
            supabase
              .from("holiday_camp_records" as never)
              .select("student_id, school_id, diario_students(name)")
              .gte("occurred_at", coloniaWeekMonday.toISOString())
              .lt("occurred_at", coloniaWeekSaturday.toISOString())
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<PagedRows<ColoniaRegistroSemana>>,
        ).catch(() => null),
        supabase
          .from("holiday_camp_week_status" as never)
          .select("school_id, status")
          .eq("week_start", coloniaWeekStartYMD),
      ]);
      if (!registros) return [] as ColoniaPendencia[];
      // O aviso deriva exclusivamente do status interno da semana: unidade
      // marcada como faturada no School Hub não gera pendência.
      const faturadas = new Set(
        ((statusRes.data ?? []) as unknown as { school_id: string; status: string }[])
          .filter((r) => r.status === "faturado")
          .map((r) => r.school_id),
      );
      const pendentes = new Map<string, string>();
      for (const r of registros) {
        if (faturadas.has(r.school_id) || pendentes.has(r.student_id)) continue;
        const st = Array.isArray(r.diario_students) ? r.diario_students[0] : r.diario_students;
        pendentes.set(r.student_id, st?.name ?? "Aluno");
      }
      return [...pendentes.entries()].map(([studentId, name]) => ({ studentId, name }));
    },
  });

  // --- Colônia de Férias: integridade da portaria. Dia com movimentação mas sem
  // Entrada e/ou Saída — ou com mais de uma de cada — quebra o controle de horas. Janela
  // rolante de duas semanas e TRAVA DE DATA: só dias já finalizados (o corte é
  // hoje 00:00 local), para não acusar enquanto as crianças estão na colônia. ---
  const coloniaIntegridadeInicio = addDays(coloniaThisMonday, -7);
  const coloniaHojeInicio = new Date(
    coloniaNow.getFullYear(),
    coloniaNow.getMonth(),
    coloniaNow.getDate(),
  );
  const { data: coloniaIncompletos = [] } = useQuery({
    queryKey: [
      "colonia_dias_incompletos",
      toYMD(coloniaIntegridadeInicio),
      today,
      userId ?? "anon",
    ],
    enabled: !!userId && (canColonia || canColoniaFin),
    refetchInterval: 60000,
    queryFn: async () => {
      const registros = await fetchAllRows<ColoniaRegistroIntegridade>(
        (from, to) =>
          supabase
            .from("holiday_camp_records" as never)
            .select("student_id, school_id, record_type, occurred_at, diario_students(name)")
            .gte("occurred_at", coloniaIntegridadeInicio.toISOString())
            .lt("occurred_at", coloniaHojeInicio.toISOString())
            .order("occurred_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<PagedRows<ColoniaRegistroIntegridade>>,
      ).catch(() => null);
      if (!registros) return [] as ColoniaDiaIncompleto[];

      const porDia = new Map<
        string,
        {
          studentId: string;
          schoolId: string;
          name: string;
          dia: string;
          registros: RegistroPortaria[];
        }
      >();
      for (const r of registros) {
        const d = new Date(r.occurred_at);
        const wd = d.getDay();
        if (wd < 1 || wd > 5) continue; // a colônia opera de segunda a sexta
        const dia = toYMD(d);
        const key = `${r.student_id}|${dia}`;
        let acc = porDia.get(key);
        if (!acc) {
          const st = Array.isArray(r.diario_students) ? r.diario_students[0] : r.diario_students;
          acc = {
            studentId: r.student_id,
            schoolId: r.school_id,
            name: st?.name ?? "Aluno",
            dia,
            registros: [],
          };
          porDia.set(key, acc);
        }
        acc.registros.push({ record_type: r.record_type, occurred_at: r.occurred_at });
      }

      const incompletos: ColoniaDiaIncompleto[] = [];
      for (const a of porDia.values()) {
        const pendencia = pendenciaPortaria(a.registros, a.dia, today);
        if (!pendencia) continue;
        incompletos.push({
          studentId: a.studentId,
          schoolId: a.schoolId,
          name: a.name,
          dia: a.dia,
          pendencia,
        });
      }
      return incompletos.sort(
        (a, b) => b.dia.localeCompare(a.dia) || a.name.localeCompare(b.name, "pt-BR"),
      );
    },
  });

  // --- Pendências financeiras por colégio/mês (derivadas ao vivo: o aviso some
  // sozinho quando a última transação é categorizada / a última receita é
  // conciliada). Um aviso por colégio e mês, nunca por transação. ---
  const janelaPendencias = (() => {
    const [ano, mes] = monthKeyFromISO(today).split("-").map(Number);
    const d = new Date(ano, (mes ?? 1) - 1 - PENDENCIAS_MESES, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();
  const { data: pendenciasFinanceiras } = useQuery({
    queryKey: ["financeiro_pendencias", janelaPendencias, userId ?? "anon"],
    enabled: !!userId && (canExtrato || canConciliacao),
    refetchInterval: 300000,
    queryFn: async () => {
      const [transacoes, conciliacoes] = await Promise.all([
        fetchAllRows<TransacaoPendencia>(
          (from, to) =>
            supabase
              .from("transactions")
              .select(
                "id, school_id, date, type, cost_center_id, revenue_category_id, parent_transaction_id, description, amount",
              )
              .gte("date", janelaPendencias)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<PagedRows<TransacaoPendencia>>,
        ),
        fetchAllRows<{ transaction_id: string }>(
          (from, to) =>
            supabase
              .from("boleto_reconciliations")
              .select("transaction_id")
              .order("transaction_id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<PagedRows<{ transaction_id: string }>>,
        ),
      ]);
      return {
        categorizacao: canExtrato ? pendenciasCategorizacao(transacoes) : [],
        conciliacao: canConciliacao
          ? pendenciasConciliacao(
              transacoes,
              conciliacoes.map((r) => r.transaction_id),
            )
          : [],
      };
    },
  });
  const pendenciasCategoria: PendenciaMensal[] = pendenciasFinanceiras?.categorizacao ?? [];
  const pendenciasFaturamento: PendenciaMensal[] = pendenciasFinanceiras?.conciliacao ?? [];

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

  const concluirAgenda = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("agenda_notifications" as any)
        .update({ concluded_at: new Date().toISOString(), read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_notifications"] }),
  });

  // Conclusão automática das reuniões que já passaram.
  const idsAutoConcluir = idsParaConcluirAutomaticamente(agendaTodas, agoraLocal);
  const chaveAutoConcluir = idsAutoConcluir.join(",");
  useEffect(() => {
    if (chaveAutoConcluir) concluirAgenda.mutate(chaveAutoConcluir.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveAutoConcluir]);

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
      !canAgenda &&
      !canColonia &&
      !canColoniaFin &&
      !canExtrato &&
      !canConciliacao)
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
  const agendaNotifications = notificacoesPendentes(agendaTodas, agoraLocal);
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
    contadorNaoLidas(agendaTodas, agoraLocal) +
    coloniaPendencias.length +
    coloniaIncompletos.length +
    plannerDue.length +
    pendenciasCategoria.length +
    pendenciasFaturamento.length +
    (alertaBoletos ? 1 : 0) +
    (alertaCron ? 1 : 0);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
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

          {/* Cobrança automática: disparo diário perdido ou com falha. */}
          {alertaCron && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Mensagens Automáticas
              </div>
              <Link
                to="/cobranca-automatica"
                className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
              >
                <div className="flex items-start gap-2">
                  <HandCoins className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <div className="min-w-0">
                    <div className="font-medium text-red-600">{alertaCron}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Veja as execuções da automação em Mensagens Automáticas.
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

          {/* Colônia de Férias: fechamento semanal pendente (verificação de fim de semana). */}
          {canColoniaFin && coloniaPendencias.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Colônia de Férias
              </div>
              {coloniaPendencias.map((p) => (
                <Link
                  key={p.studentId}
                  to="/colonia"
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-amber-600">
                        Fechamento pendente: {p.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Há consumos na semana sem faturamento resolvido (Faturar no Sponte ou Já
                        lançado).
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Colônia de Férias: dia com movimentação sem — ou com mais de uma — Entrada/Saída. */}
          {(canColonia || canColoniaFin) && coloniaIncompletos.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Colônia — integridade dos registros
              </div>
              {coloniaIncompletos.map((p) => (
                <Link
                  key={`${p.studentId}-${p.dia}`}
                  to="/colonia"
                  search={{ aluno: p.studentId, dia: p.dia }}
                  onClick={() => {
                    setSelected(p.schoolId);
                    setOpen(false);
                  }}
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-red-600">
                        {p.name} — {labelPendenciaPortaria(p.pendencia)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateBR(p.dia)}: {descricaoPendenciaPortaria(p.pendencia)} Clique para
                        corrigir.
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
                <div
                  key={n.id}
                  className="flex items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <Link
                    to="/agenda"
                    className={`min-w-0 flex-1 ${n.read ? "text-muted-foreground" : "font-medium"}`}
                  >
                    <div>{n.message}</div>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {formatDateBR(n.created_at)}
                    </span>
                  </Link>
                  <button
                    type="button"
                    title="Marcar reunião como concluída"
                    aria-label="Marcar reunião como concluída"
                    onClick={() => concluirAgenda.mutate([n.id])}
                    disabled={concluirAgenda.isPending}
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-emerald-100 hover:text-emerald-600 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Extrato Bancário: transações sem categoria (1 aviso por colégio/mês). */}
          {pendenciasCategoria.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Extrato Bancário
              </div>
              {pendenciasCategoria.map((p) => (
                <Link
                  key={`cat-${p.schoolId}-${p.monthKey}`}
                  to="/extrato-bancario"
                  onClick={() => {
                    setSelected(p.schoolId);
                    setOpen(false);
                  }}
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <Tags className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-amber-600">
                        {mensagemCategorizacao(schoolName(p.schoolId) || "—", p.monthKey)}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Faturamento: receitas do período ainda pendentes de conciliação. */}
          {pendenciasFaturamento.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Faturamento
              </div>
              {pendenciasFaturamento.map((p) => (
                <Link
                  key={`conc-${p.schoolId}-${p.monthKey}`}
                  to="/conciliacao"
                  onClick={() => {
                    setSelected(p.schoolId);
                    setOpen(false);
                  }}
                  className="block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0">
                      <div className="font-medium text-amber-600">
                        {mensagemConciliacao(schoolName(p.schoolId) || "—", p.monthKey)}
                      </div>
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

          {/* Rotinas do Planner vencidas e pendentes: persistem até serem
              marcadas como cumpridas (não somem por passar o dia/recarregar). */}
          {canTasks && plannerDue.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Rotinas vencidas (Planner)
              </div>
              {plannerDue.map(({ def, date }) => (
                <Link
                  key={def.id}
                  to="/tasks"
                  className="block border-b px-3 py-2 text-sm font-medium last:border-b-0 hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <div>{def.title}</div>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Venceu em {formatDateBR(date)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Task concluída: única notificação descartável (check p/ marcar lida). */}
          {canTasks && unreadTasks.length > 0 && (
            <div>
              <div className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tasks
              </div>
              {unreadTasks.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent"
                >
                  <Link to="/tasks" className="min-w-0 flex-1 font-medium">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
                    {n.message}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {formatDateBR(n.created_at)}
                    </span>
                  </Link>
                  <button
                    type="button"
                    title="Marcar como lida"
                    aria-label="Marcar como lida"
                    onClick={() => markRead.mutate([n.id])}
                    disabled={markRead.isPending}
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-emerald-100 hover:text-emerald-600 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {badge === 0 &&
            unreadTasks.length === 0 &&
            agendaNotifications.length === 0 &&
            forecasts.length === 0 &&
            openTasks.length === 0 &&
            lowStockStores.length === 0 &&
            availableReceivables.length === 0 &&
            extraEvents.length === 0 &&
            coloniaPendencias.length === 0 &&
            coloniaIncompletos.length === 0 &&
            plannerDue.length === 0 &&
            pendenciasCategoria.length === 0 &&
            pendenciasFaturamento.length === 0 &&
            !alertaBoletos &&
            !alertaCron && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhuma notificação.
              </p>
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
