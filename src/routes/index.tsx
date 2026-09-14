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
  TrendingUp,
  TrendingDown,
  Scale,
  Landmark,
  ArrowUpCircle,
  ArrowDownCircle,
  ArrowLeftRight,
  LineChart as LineChartIcon,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import { fetchAllRows, type PagedRows } from "@/lib/supabase-paginate";
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
import { saldosDoPeriodo, transacoesDoPeriodo } from "@/lib/extrato-lista";
import { serieTotalPatrimonio, seriePatrimonioPorFundo } from "@/lib/fundos";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import {
  despesaPorCentroCusto,
  fechamentoMensal,
  fechamentoPorUnidade,
  resolverIdsFinanceiros,
  FECHAMENTO_ZERADO,
  IDS_VAZIOS,
  type TransacaoFinanceira,
} from "@/lib/dashboard-financeiro";

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
      return selectAll<{ origem: string | null; coluna: string | null; created_at: string }>(() => {
        let q = supabase
          .from("leads")
          .select("origem, coluna, created_at")
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59.999`)
          .order("id", { ascending: true });
        if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
        return q;
      });
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
      type SaldoRow = {
        id: string;
        type: string;
        amount: number;
        parent_transaction_id: string | null;
      };
      // Saldo consolidado usa todas as transações da unidade; sem paginação o
      // PostgREST devolveria apenas as primeiras 1000 linhas e o saldo sairia menor.
      const rows = await fetchAllRows<SaldoRow>((from, to) => {
        let q = supabase
          .from("transactions")
          .select("id, type, amount, parent_transaction_id")
          .order("id", { ascending: true })
          .range(from, to);
        if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
        return q as unknown as PromiseLike<PagedRows<SaldoRow>>;
      });
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
      const rows = await fetchAllRows<{ amount: number; description: string | null }>(
        (from, to) => {
          let q = supabase
            .from("transactions")
            .select("amount, description")
            .eq("type", "entrada")
            .is("parent_transaction_id", null)
            .gte("date", anoJunhoYMD)
            .lte("date", hojeYMD)
            .order("id", { ascending: true })
            .range(from, to);
          if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
          return q as unknown as PromiseLike<
            PagedRows<{ amount: number; description: string | null }>
          >;
        },
      );
      return rows.reduce((sum, t) => {
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

  // ── Fechamento mensal (Extrato Bancário) ─────────────────────────────────
  const { data: catalogos } = useQuery({
    queryKey: ["dash-fin-catalogos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      type Nomeado = { id: string; name: string };
      const [rc, cc] = await Promise.all([
        supabase.from("revenue_categories").select("id, name"),
        supabase.from("cost_centers").select("id, name"),
      ]);
      if (rc.error) throw rc.error;
      if (cc.error) throw cc.error;
      const centros = (cc.data ?? []) as Nomeado[];
      return {
        ids: resolverIdsFinanceiros((rc.data ?? []) as Nomeado[], centros),
        nomesCentros: new Map(centros.map((c) => [c.id, c.name])),
      };
    },
  });
  const idsFin = catalogos?.ids ?? IDS_VAZIOS;

  // Histórico completo da(s) unidade(s), igual ao Extrato Bancário: o Saldo
  // Inicial do período vem das transações anteriores a ele.
  const { data: txsTodas, isFetching: finFetching } = useQuery({
    queryKey: ["dash-fin-transacoes", schoolFilterIds],
    staleTime: 60_000,
    queryFn: () =>
      fetchAllRows<TransacaoFinanceira>((from, to) => {
        let q = supabase
          .from("transactions")
          .select(
            "id, school_id, date, type, amount, cost_center_id, revenue_category_id, parent_transaction_id",
          )
          .order("id", { ascending: true })
          .range(from, to);
        if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
        return q as unknown as PromiseLike<PagedRows<TransacaoFinanceira>>;
      }),
  });
  const txsPeriodo = useMemo(
    () => (txsTodas ? transacoesDoPeriodo(txsTodas, startDate, endDate) : undefined),
    [txsTodas, startDate, endDate],
  );

  // Saldo Inicial manual (initial_balances), mesma consulta do Extrato Bancário.
  const { data: saldoManual } = useQuery({
    queryKey: ["initial_balance", selected, startDate],
    queryFn: async () => {
      if (selected === "all") return null;
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("initial_balances" as any)
        .select("amount")
        .eq("school_id", selected)
        .lte("reference_date", startDate)
        .order("reference_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as { amount: number } | null) ?? null;
    },
  });
  const saldos = useMemo(
    () =>
      txsTodas
        ? saldosDoPeriodo(txsTodas, startDate, endDate, saldoManual?.amount)
        : { saldoInicial: 0, entradas: 0, saidas: 0, saldoFinal: 0 },
    [txsTodas, startDate, endDate, saldoManual],
  );

  const fechamento = useMemo(
    () => (txsPeriodo ? fechamentoMensal(txsPeriodo, idsFin) : FECHAMENTO_ZERADO),
    [txsPeriodo, idsFin],
  );
  const despesaCentros = useMemo(
    () =>
      txsPeriodo
        ? despesaPorCentroCusto(txsPeriodo, idsFin, catalogos?.nomesCentros ?? new Map())
        : [],
    [txsPeriodo, idsFin, catalogos],
  );
  const comparativo = useMemo(
    () =>
      selected === "all" && txsPeriodo ? fechamentoPorUnidade(txsPeriodo, idsFin, schools) : [],
    [selected, txsPeriodo, idsFin, schools],
  );

  // ── Evolução do Patrimônio (Fundos) ─────────────────────────────────────
  type FundoDash = { id: string; school_id: string; name: string; destination: string };
  type EntradaFundoDash = { fund_id: string; competencia: string; valor_liquido: number };
  const { data: patrimonio, isFetching: fundosFetching } = useQuery({
    queryKey: ["dash-fundos-patrimonio", schoolFilterIds],
    staleTime: 60_000,
    queryFn: async () => {
      const fundos = await selectAll<FundoDash>(() => {
        let q = supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("provision_funds" as any)
          .select("id, school_id, name, destination")
          .order("name");
        if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
        return q;
      });
      if (fundos.length === 0) return { fundos, entradas: [] as EntradaFundoDash[] };
      const entradas = await selectAll<EntradaFundoDash>(() =>
        supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("provision_fund_entries" as any)
          .select("fund_id, competencia, valor_liquido")
          .in(
            "fund_id",
            fundos.map((f) => f.id),
          )
          .order("competencia", { ascending: true }),
      );
      return { fundos, entradas };
    },
  });
  const fundosVisiveis = useMemo(() => patrimonio?.fundos ?? [], [patrimonio]);
  const patrimonioTotal = useMemo(
    () => serieTotalPatrimonio(patrimonio?.entradas ?? []),
    [patrimonio],
  );
  const patrimonioPorFundo = useMemo(
    () => seriePatrimonioPorFundo(patrimonio?.entradas ?? [], fundosVisiveis, (f) => f.id),
    [patrimonio, fundosVisiveis],
  );

  const avisoIds = [
    idsFin.resgateInvestimento === null && "Resgate Fundo de Investimento",
    idsFin.aporteInvestimento === null && "Aporte em Investimento",
    idsFin.transferenciaRecebida === null && "Aporte Financeiro (receita)",
    idsFin.transferenciaEnviada === null && "Aporte Financeiro (centro de custo)",
  ].filter((x): x is string => typeof x === "string");

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
              ? "Faturamento retroativo (Jan–Mai) não informado"
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

      {/* Fechamento mensal */}
      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Fechamento do Mês</h2>
        {catalogos && avisoIds.length > 0 && (
          <p className="mb-3 flex items-center gap-2 text-xs text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            Categoria/centro não encontrado: {avisoIds.join(", ")}. As exclusões correspondentes não
            foram aplicadas.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Saldo Inicial"
            icon={Wallet}
            tone={saldos.saldoInicial >= 0 ? "success" : "destructive"}
            loading={finFetching}
            value={formatBRL(saldos.saldoInicial)}
          />
          <MetricCard
            label="Entradas"
            icon={ArrowUpCircle}
            tone="success"
            loading={finFetching}
            value={formatBRL(saldos.entradas)}
          />
          <MetricCard
            label="Saídas"
            icon={ArrowDownCircle}
            tone="destructive"
            loading={finFetching}
            value={formatBRL(saldos.saidas)}
          />
          <MetricCard
            label="Saldo Final"
            icon={Wallet}
            tone={saldos.saldoFinal >= 0 ? "success" : "destructive"}
            loading={finFetching}
            value={formatBRL(saldos.saldoFinal)}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Receita do Mês"
            icon={TrendingUp}
            tone="success"
            loading={finFetching}
            value={formatBRL(fechamento.receita)}
            ajuda="Entradas do extrato, sem considerar resgate de fundo de investimento e aporte recebido de outra unidade"
          />
          <MetricCard
            label="Despesa do Mês"
            icon={TrendingDown}
            tone="destructive"
            loading={finFetching}
            value={formatBRL(fechamento.despesa)}
            ajuda="Saídas do extrato, sem considerar aplicação em fundo de investimento e aporte realizado em outra unidade"
          />
          <MetricCard
            label="Resultado do Mês"
            icon={Scale}
            tone={fechamento.resultado >= 0 ? "success" : "destructive"}
            loading={finFetching}
            value={formatBRL(fechamento.resultado)}
            ajuda="Receita − Despesa do período"
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <DuplaCard
            label="Movimentação de Investimentos"
            icon={Landmark}
            loading={finFetching}
            itens={[
              { rotulo: "Aportado no Fundo", valor: fechamento.aportadoFundo },
              { rotulo: "Resgatado do Fundo", valor: fechamento.resgatadoFundo },
            ]}
            ajuda="Não entra em Receita nem Despesa"
          />
          <DuplaCard
            label="Transferências entre Unidades"
            icon={ArrowLeftRight}
            loading={finFetching}
            itens={[
              { rotulo: "Enviado a Outras Unidades", valor: fechamento.enviadoOutras },
              { rotulo: "Recebido de Outras Unidades", valor: fechamento.recebidoOutras },
            ]}
            destaque={{ rotulo: "Saldo líquido", valor: fechamento.saldoTransferencias }}
            ajuda="Não entra em Receita nem Despesa"
          />
        </div>
      </div>

      {selected === "all" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparativo por Unidade</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {finFetching ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Unidade</th>
                    <th className="py-2 pr-3 text-right">Receita do Mês</th>
                    <th className="py-2 pr-3 text-right">Despesa do Mês</th>
                    <th className="py-2 pr-3 text-right">Resultado do Mês</th>
                    <th className="py-2 pr-3 text-right">Enviado a Outras Unidades</th>
                    <th className="py-2 text-right">Recebido de Outras Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {comparativo.map((l) => (
                    <tr key={l.schoolId} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{l.schoolName}</td>
                      <td className="py-2 pr-3 text-right">{formatBRL(l.receita)}</td>
                      <td className="py-2 pr-3 text-right">{formatBRL(l.despesa)}</td>
                      <td
                        className={`py-2 pr-3 text-right font-semibold ${l.resultado >= 0 ? "text-success" : "text-destructive"}`}
                      >
                        {formatBRL(l.resultado)}
                      </td>
                      <td className="py-2 pr-3 text-right">{formatBRL(l.enviadoOutras)}</td>
                      <td className="py-2 text-right">{formatBRL(l.recebidoOutras)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Despesa por Centro de Custo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-muted-foreground" />
              Despesa por Centro de Custo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {finFetching ? (
              <Skeleton className="h-72 w-full" />
            ) : despesaCentros.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-6 w-6" />
                Nenhuma despesa no período selecionado.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={despesaCentros}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={2}
                  >
                    {despesaCentros.map((entry, i) => (
                      <Cell key={entry.id ?? "sem"} fill={ORIGEM_CORES[i % ORIGEM_CORES.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [formatBRL(value), name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Evolução do Patrimônio (Fundos) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LineChartIcon className="h-5 w-5 text-muted-foreground" />
              Evolução do Patrimônio
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fundosFetching ? (
              <Skeleton className="h-72 w-full" />
            ) : fundosVisiveis.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-6 w-6" />
                Nenhum fundo de investimento cadastrado para esta unidade.
              </div>
            ) : patrimonioTotal.length === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-6 w-6" />
                Nenhum lançamento mensal registrado nos fundos.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={fundosVisiveis.length <= 1 ? patrimonioTotal : patrimonioPorFundo}
                  margin={{ top: 10, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatBRL(v)}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  {fundosVisiveis.length <= 1 ? (
                    <Line
                      type="monotone"
                      dataKey="total"
                      name={fundosVisiveis[0]?.destination || "Total"}
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ) : (
                    <>
                      <Legend />
                      {fundosVisiveis.map((f, i) => (
                        <Line
                          key={f.id}
                          type="monotone"
                          dataKey={f.id}
                          name={f.destination || f.name}
                          stroke={ORIGEM_CORES[i % ORIGEM_CORES.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      ))}
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
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

function DuplaCard({
  label,
  icon: Icon,
  itens,
  destaque,
  ajuda,
  loading,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  itens: { rotulo: string; valor: number }[];
  destaque?: { rotulo: string; valor: number };
  ajuda?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
            {label}
            {ajuda && <AjudaTooltip texto={ajuda} rotulo={`Ajuda: ${label}`} />}
          </div>
          {loading ? (
            <Skeleton className="mt-1 h-12 w-40" />
          ) : (
            <div className="mt-1 space-y-0.5 text-sm">
              {itens.map((it) => (
                <div key={it.rotulo} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{it.rotulo}</span>
                  <span className="font-semibold tabular-nums">{formatBRL(it.valor)}</span>
                </div>
              ))}
              {destaque && (
                <div className="flex justify-between gap-3 border-t pt-1">
                  <span className="font-medium">{destaque.rotulo}</span>
                  <span
                    className={`font-bold tabular-nums ${destaque.valor >= 0 ? "text-success" : "text-destructive"}`}
                  >
                    {formatBRL(destaque.valor)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
  ajuda,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "success" | "destructive" | "warning";
  hint?: string;
  ajuda?: string;
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
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
            {label}
            {ajuda && <AjudaTooltip texto={ajuda} rotulo={`Ajuda: ${label}`} />}
          </div>
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
