import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  GraduationCap,
  Percent,
  Wallet,
  UserPlus,
  CheckCircle2,
  PieChart as PieChartIcon,
  AlertTriangle,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSchool, usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { fetchSponteAlunosAtivos, fetchSponteInadimplenciaAnual } from "@/lib/sponte.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — School Hub" },
      { name: "description", content: "Painel gerencial com indicadores da unidade." },
    ],
  }),
  component: DashboardGate,
});

function DashboardGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("dashboard"))
    return <AccessDenied message="Você não tem permissão para visualizar o Dashboard." />;
  return <MainDashboard />;
}

// Unidades com integração Sponte ativa (nomes = chaves das escolas).
const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

// Paleta de cores para o gráfico de Origem das Leads.
const ORIGEM_CORES = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#eab308",
  "#64748b",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function firstDayOfMonth(d = new Date()): string {
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function lastDayOfMonth(d = new Date()): string {
  return toLocalISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function MainDashboard() {
  const { selected, schools, schoolFilterIds } = useSchool();
  const [startDate, setStartDate] = useState<string>(firstDayOfMonth());
  const [endDate, setEndDate] = useState<string>(lastDayOfMonth());

  const fetchAlunosFn = useServerFn(fetchSponteAlunosAtivos);
  const fetchAnualFn = useServerFn(fetchSponteInadimplenciaAnual);

  // Mapeia o seletor global de Unidade (school_id) para a unidade do Sponte.
  const unidadeNome =
    selected === "all" ? null : (schools.find((s) => s.id === selected)?.name ?? null);
  const integracaoDisponivel = unidadeNome === null || UNIDADES_SPONTE.includes(unidadeNome);
  const schoolLabel =
    selected === "all" ? "Todas as Unidades" : (schools.find((s) => s.id === selected)?.name ?? "");

  // ── Card 1: Alunos Matriculados Ativos (Sponte) ──────────────────────────
  const { data: alunos, isFetching: alunosFetching } = useQuery({
    queryKey: ["dash-alunos-ativos", unidadeNome ?? "consolidado"],
    enabled: integracaoDisponivel,
    staleTime: 5 * 60_000,
    queryFn: () => fetchAlunosFn({ data: { unidade: unidadeNome ?? undefined } }),
  });

  // ── Card 4/5/6: Leads do período (Admissões) ─────────────────────────────
  const { data: leads, isFetching: leadsFetching } = useQuery({
    queryKey: ["dash-leads", startDate, endDate, schoolFilterIds],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select("origem, coluna, created_at")
        .gte("created_at", `${startDate}T00:00:00`)
        .lte("created_at", `${endDate}T23:59:59.999`);
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { origem: string | null; coluna: string | null; created_at: string }[];
    },
  });

  const totalLeads = leads?.length ?? 0;
  const matriculasEfetivadas = useMemo(
    () => (leads ?? []).filter((l) => l.coluna === "matricula").length,
    [leads],
  );
  const origemData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leads ?? []) {
      const key = (l.origem ?? "").trim() || "Não informado";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [leads]);

  // ── Card 3: Saldo Atual (consolidado bancário) ───────────────────────────
  const { data: saldoAtual, isFetching: saldoFetching } = useQuery({
    queryKey: ["dash-saldo", selected, schoolFilterIds],
    staleTime: 60_000,
    queryFn: async () => {
      let txQuery = supabase.from("transactions").select("id, type, amount, parent_transaction_id");
      if (schoolFilterIds) txQuery = txQuery.in("school_id", schoolFilterIds);
      const { data: txs, error } = await txQuery;
      if (error) throw error;
      const rows = (txs ?? []) as {
        id: string;
        type: string;
        amount: number;
        parent_transaction_id: string | null;
      }[];
      const splitParents = new Set(
        rows.map((t) => t.parent_transaction_id).filter((v): v is string => !!v),
      );
      const net = rows
        .filter((t) => !splitParents.has(t.id))
        .reduce((s, t) => s + (t.type === "entrada" ? Number(t.amount) : -Number(t.amount)), 0);
      if (rows.length > 0) return net;
      // Sem transações: usa o Saldo Inicial manual da unidade (quando específica).
      if (selected === "all") return 0;
      const { data: ib } = await supabase
        .from("initial_balances")
        .select("amount")
        .eq("school_id", selected)
        .order("reference_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return Number((ib as { amount?: number } | null)?.amount ?? 0);
    },
  });

  // ── Card 2: Inadimplência Anual (índice %) ───────────────────────────────
  // % = Total Inadimplente (Sponte, 01/01 → hoje, sem "Acordo") ÷ Faturamento
  // Total do Ano (retroativo Jan–Mai + receitas reais do extrato Jun → hoje).
  const anoAtual = new Date().getFullYear();
  const anoInicioYMD = `${anoAtual}-01-01`;
  const anoJunhoYMD = `${anoAtual}-06-01`;
  const hojeYMD = toLocalISO(new Date());

  const { data: schoolsFaturamento } = useQuery({
    queryKey: ["dash-faturamento-schools"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("id, faturamento_retroativo_jan_mai");
      if (error) throw error;
      return (data ?? []) as { id: string; faturamento_retroativo_jan_mai: number | null }[];
    },
  });

  const { retroativoAno, retroativoConfigurado } = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const s of schoolsFaturamento ?? []) map.set(s.id, s.faturamento_retroativo_jan_mai);
    if (selected === "all") {
      const valores = schools.map((s) => map.get(s.id)).filter((v): v is number => v != null);
      return {
        retroativoAno: valores.reduce((a, b) => a + b, 0),
        retroativoConfigurado: valores.length > 0,
      };
    }
    const v = map.get(selected);
    return { retroativoAno: v ?? 0, retroativoConfigurado: v != null };
  }, [schoolsFaturamento, selected, schools]);

  const { data: receitasAno, isFetching: receitasAnoFetching } = useQuery({
    queryKey: ["dash-receitas-ano", anoAtual, selected, schoolFilterIds],
    enabled: integracaoDisponivel && retroativoConfigurado,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("transactions")
        .select("amount, description")
        .eq("type", "entrada")
        .is("parent_transaction_id", null)
        .gte("date", anoJunhoYMD)
        .lte("date", hojeYMD);
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data: rows, error } = await q;
      if (error) throw error;
      return (rows ?? []).reduce((sum, t) => {
        const desc = String(t.description ?? "")
          .trim()
          .toUpperCase();
        const amt = Number(t.amount ?? 0);
        if (desc.includes("SALDO DIA")) return sum;
        if (amt === 1) return sum;
        return sum + amt;
      }, 0);
    },
  });

  const { data: anual, isFetching: anualFetching } = useQuery({
    queryKey: ["dash-inadimplencia-anual", anoAtual, unidadeNome ?? "consolidado"],
    enabled: integracaoDisponivel && retroativoConfigurado,
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchAnualFn({
        data: { dataInicio: anoInicioYMD, dataFim: hojeYMD, unidade: unidadeNome ?? undefined },
      }),
  });

  const faturamentoTotalAno = retroativoAno + (receitasAno ?? 0);
  const inadimplenteAno = anual?.totalInadimplente ?? 0;
  const indiceAnual = faturamentoTotalAno > 0 ? (inadimplenteAno / faturamentoTotalAno) * 100 : 0;
  const anualCarregando = anualFetching || receitasAnoFetching;
  const anualErro = anual?.error ?? null;

  function setMesAtual() {
    setStartDate(firstDayOfMonth());
    setEndDate(lastDayOfMonth());
  }

  const alunosErro = alunos?.error ?? null;
  const alunosIndisponivel = alunos?.indisponivel ?? false;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Exibindo: <span className="font-medium text-foreground">{schoolLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <MonthYearPicker
            startDate={startDate}
            onChange={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
          />
          <Button variant="outline" className="h-9" onClick={setMesAtual}>
            Mês atual
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Alunos Matriculados Ativos"
          icon={GraduationCap}
          tone="primary"
          loading={alunosFetching}
          value={
            !integracaoDisponivel || alunosIndisponivel
              ? "—"
              : alunosErro
                ? "Erro"
                : String(alunos?.total ?? 0)
          }
          hint={alunosErro ?? (alunosIndisponivel ? "Integração indisponível" : "Fonte: Sponte")}
        />

        <MetricCard
          label="Inadimplência Anual"
          icon={Percent}
          tone="warning"
          loading={anualCarregando}
          value={
            !retroativoConfigurado
              ? "—"
              : anualErro
                ? "Erro"
                : `${indiceAnual.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
          }
          hint={
            !retroativoConfigurado
              ? "Configure o faturamento retroativo nas Configurações"
              : anualErro
                ? anualErro
                : `${formatBRL(inadimplenteAno)} inadimplente no ano`
          }
        />

        <MetricCard
          label="Saldo Atual"
          icon={Wallet}
          tone={(saldoAtual ?? 0) >= 0 ? "success" : "destructive"}
          loading={saldoFetching}
          value={formatBRL(saldoAtual ?? 0)}
          hint="Saldo bancário consolidado"
        />

        <MetricCard
          label="Criação de Leads"
          icon={UserPlus}
          tone="primary"
          loading={leadsFetching}
          value={String(totalLeads)}
          hint="Leads no período (Admissões)"
        />

        <MetricCard
          label="Matrículas Efetivadas"
          icon={CheckCircle2}
          tone="success"
          loading={leadsFetching}
          value={String(matriculasEfetivadas)}
          hint="Leads convertidas em matrícula"
        />

        <MetricCard
          label="Conversão de Leads"
          icon={CheckCircle2}
          tone="primary"
          loading={leadsFetching}
          value={totalLeads > 0 ? `${Math.round((matriculasEfetivadas / totalLeads) * 100)}%` : "—"}
          hint="Matrículas ÷ Leads do período"
        />
      </div>

      {/* Origem das Leads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChartIcon className="h-5 w-5 text-muted-foreground" />
            Origem das Leads
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leadsFetching ? (
            <Skeleton className="h-72 w-full" />
          ) : origemData.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-6 w-6" />
              Nenhuma lead criada no período selecionado.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={origemData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={2}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                >
                  {origemData.map((entry, i) => (
                    <Cell key={entry.name} fill={ORIGEM_CORES[i % ORIGEM_CORES.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number, name: string) => [`${value} lead(s)`, name]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "success" | "destructive" | "warning";
  hint?: string;
  loading?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "destructive"
        ? "bg-destructive/10 text-destructive"
        : tone === "warning"
          ? "bg-amber-500/10 text-amber-600"
          : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${toneClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-24" />
          ) : (
            <div className="text-2xl font-bold">{value}</div>
          )}
          {hint && (
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger asChild>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>
                </TooltipTrigger>
                <TooltipContent>{hint}</TooltipContent>
              </UITooltip>
            </TooltipProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
