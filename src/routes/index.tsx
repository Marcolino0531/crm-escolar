import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  GraduationCap,
  Percent,
  Wallet,
  ArrowRight,
  UserPlus,
  CheckCircle2,
  PieChart as PieChartIcon,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Scale,
  Landmark,
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
import { fetchSponteInadimplenciaAnual } from "@/lib/sponte.functions";
import { fetchAlunosAtivosAno, fetchAlunosAtivosHistorico } from "@/lib/alunos-ativos.functions";
import { serieHistorico } from "@/lib/alunos-ativos";
import { saldosDoPeriodo, transacoesDoPeriodo } from "@/lib/extrato-lista";
import { serieTotalPatrimonio, seriePatrimonioPorFundo } from "@/lib/fundos";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import {
  despesaPorCentroCusto,
  fechamentoMensal,
  fechamentoPorUnidade,
  FECHAMENTO_ZERADO,
  type TransacaoFinanceira,
} from "@/lib/dashboard-financeiro";
import {
  faturamentoRecebido,
  janelaAnual,
  type ReceitaExtrato,
} from "@/lib/inadimplencia-faturamento";
import { retroativoParaJanela } from "@/lib/dashboard-inadimplencia-anual";
import { useCatalogosFinanceiros } from "@/hooks/use-catalogos-financeiros";
import { fetchHistoricoInadimplencia } from "@/lib/inadimplencia-fechamento.functions";
import {
  anoMesDeData,
  formatarPercentual,
  mesAnterior,
  resumoMesPorUnidade,
  rotuloMes,
  serieInadimplencia,
  ultimoFechamento,
  type PontoInadimplencia,
} from "@/lib/inadimplencia-fechamento";
import { hojeEmBrasilia } from "@/lib/alunos-ativos";
import {
  FechamentoInadimplenciaModal,
  QUERY_HISTORICO_INADIMPLENCIA,
} from "@/components/dashboard/FechamentoInadimplenciaModal";

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
  const { isAdmin } = usePermissions();
  const [startDate, setStartDate] = useState<string>(firstDayOfMonth());
  const [endDate, setEndDate] = useState<string>(lastDayOfMonth());
  const [fechamentoAberto, setFechamentoAberto] = useState(false);

  const fetchAlunosFn = useServerFn(fetchAlunosAtivosAno);
  const fetchHistoricoFn = useServerFn(fetchAlunosAtivosHistorico);
  const fetchAnualFn = useServerFn(fetchSponteInadimplenciaAnual);

  // Mapeia o seletor global de Unidade (school_id) para a unidade do Sponte.
  const unidadeNome =
    selected === "all" ? null : (schools.find((s) => s.id === selected)?.name ?? null);
  const integracaoDisponivel = unidadeNome === null || UNIDADES_SPONTE.includes(unidadeNome);
  const schoolLabel =
    selected === "all" ? "Todas as Unidades" : (schools.find((s) => s.id === selected)?.name ?? "");

  // ── Card 1: Alunos Matriculados Ativos (diario_matriculas_ano, ano vigente) ──
  const { data: alunos, isFetching: alunosFetching } = useQuery({
    queryKey: ["dash-alunos-ativos", schoolFilterIds],
    staleTime: 5 * 60_000,
    queryFn: () => fetchAlunosFn({ data: { schoolIds: schoolFilterIds ?? undefined } }),
  });
  const { data: historicoAlunos, isFetching: historicoFetching } = useQuery({
    queryKey: ["dash-alunos-ativos-historico"],
    staleTime: 5 * 60_000,
    queryFn: () => fetchHistoricoFn({ data: undefined }),
  });
  const serieAlunos = useMemo(
    () => serieHistorico(historicoAlunos ?? [], schoolFilterIds),
    [historicoAlunos, schoolFilterIds],
  );

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

  // ── Card 2: Inadimplência Anual (índice %) ───────────────────────────────
  // % = Total Inadimplente (Sponte, 01/01 → hoje, sem "Acordo") ÷ Faturamento
  // Total do Ano. Janela por ano igual à tela de Inadimplência (janelaAnual):
  // 2026 = retroativo Jan–Mai + extrato 01/06 → hoje; 2027+ = extrato
  // 01/01 → hoje, sem retroativo.
  const anoAtual = new Date().getFullYear();
  const hojeYMD = toLocalISO(new Date());
  const janela = useMemo(() => janelaAnual(anoAtual, hojeYMD), [anoAtual, hojeYMD]);

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
    return retroativoParaJanela(
      janela,
      selected,
      schools.map((s) => s.id),
      map,
    );
  }, [schoolsFaturamento, selected, schools, janela]);

  const { catalogos, idsFin, idsCarregados } = useCatalogosFinanceiros();

  // Mesma fonte e exclusões (resgate de fundo, aporte de outra unidade) da
  // tela de Inadimplência, para o percentual bater nas duas telas.
  const { data: receitasAno, isFetching: receitasAnoFetching } = useQuery({
    queryKey: [
      "faturamento-anual",
      "receitas",
      anoAtual,
      janela.receitasDesdeYMD,
      selected,
      schoolFilterIds,
      idsFin,
    ],
    enabled: integracaoDisponivel && retroativoConfigurado && idsCarregados,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await fetchAllRows<ReceitaExtrato>((from, to) => {
        let q = supabase
          .from("transactions")
          .select("amount, description, revenue_category_id")
          .eq("type", "entrada")
          .is("parent_transaction_id", null)
          .gte("date", janela.receitasDesdeYMD)
          .lte("date", janela.fimYMD)
          .order("id", { ascending: true })
          .range(from, to);
        if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
        return q as unknown as PromiseLike<PagedRows<ReceitaExtrato>>;
      });
      return faturamentoRecebido(rows, idsFin);
    },
  });

  const { data: anual, isFetching: anualFetching } = useQuery({
    queryKey: [
      "dash-inadimplencia-anual",
      anoAtual,
      janela.inicioYMD,
      unidadeNome ?? "consolidado",
    ],
    enabled: integracaoDisponivel && retroativoConfigurado,
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchAnualFn({
        data: {
          dataInicio: janela.inicioYMD,
          dataFim: janela.fimYMD,
          unidade: unidadeNome ?? undefined,
        },
      }),
  });

  const faturamentoTotalAno = retroativoAno + (receitasAno ?? 0);
  const inadimplenteAno = anual?.totalInadimplente ?? 0;
  const indiceAnual = faturamentoTotalAno > 0 ? (inadimplenteAno / faturamentoTotalAno) * 100 : 0;
  const anualCarregando = anualFetching || receitasAnoFetching;
  const anualErro = anual?.error ?? null;
  const anualParcialAte = anual?.parcialAte ?? null;

  // ── Fechamento mensal da inadimplência (histórico gravado manualmente) ───
  const fetchHistInadFn = useServerFn(fetchHistoricoInadimplencia);
  const { data: historicoInad, isFetching: historicoInadFetching } = useQuery({
    queryKey: [QUERY_HISTORICO_INADIMPLENCIA, schoolFilterIds],
    staleTime: 5 * 60_000,
    queryFn: () => fetchHistInadFn({ data: { schoolIds: schoolFilterIds ?? undefined } }),
  });
  const unidadesSponte = useMemo(
    () => schools.filter((s) => UNIDADES_SPONTE.includes(s.name)),
    [schools],
  );
  const serieInad = useMemo(() => {
    const exigidas =
      selected === "all" ? unidadesSponte.map((s) => s.id) : (schoolFilterIds ?? [selected]);
    return serieInadimplencia(historicoInad ?? [], exigidas);
  }, [historicoInad, selected, schoolFilterIds, unidadesSponte]);
  const ultimoInad = ultimoFechamento(serieInad);
  const mesAnteriorRef = mesAnterior(anoMesDeData(hojeEmBrasilia()));
  const resumoMesAnterior =
    selected === "all" && unidadesSponte.length > 0
      ? resumoMesPorUnidade(historicoInad ?? [], mesAnteriorRef, unidadesSponte)
      : null;

  // ── Fechamento mensal (Extrato Bancário) ─────────────────────────────────
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

  const nomeEscola = (id: string) => schools.find((s) => s.id === id)?.name ?? id;
  const alunosSemDados = alunos?.semDados ?? [];
  // Nenhuma unidade do filtro tem vínculo sincronizado no ano: não há número a mostrar.
  const alunosSemNenhumDado = !!alunos && Object.keys(alunos.porUnidade).length === 0;
  const alunosHint = alunosSemNenhumDado
    ? `Sem sincronização de ${alunos?.ano ?? ""} para esta unidade`
    : alunosSemDados.length > 0
      ? `Sem sincronização de ${alunos?.ano}: ${alunosSemDados.map(nomeEscola).join(", ")}`
      : `Fonte: matrículas do ano letivo ${alunos?.ano ?? ""}`;

  return (
    <div className="space-y-6">
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

      {catalogos && avisoIds.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          Categoria/centro não encontrado: {avisoIds.join(", ")}. As exclusões correspondentes não
          foram aplicadas.
        </p>
      )}

      {/* Nível 1 — os três números do mês */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          size="lg"
          label="Receita do Mês"
          icon={TrendingUp}
          tone="success"
          loading={finFetching}
          value={formatBRL(fechamento.receita)}
          ajuda="Entradas do extrato, sem considerar resgate de fundo de investimento e aporte recebido de outra unidade"
        />
        <MetricCard
          size="lg"
          label="Despesa do Mês"
          icon={TrendingDown}
          tone="destructive"
          loading={finFetching}
          value={formatBRL(fechamento.despesa)}
          ajuda="Saídas do extrato, sem considerar aplicação em fundo de investimento e aporte realizado em outra unidade"
        />
        <MetricCard
          size="lg"
          label="Resultado do Mês"
          icon={Scale}
          tone={fechamento.resultado >= 0 ? "success" : "destructive"}
          loading={finFetching}
          value={formatBRL(fechamento.resultado)}
          ajuda="Receita − Despesa do período"
        />
      </div>

      {/* Nível 2 — Fechamento de Caixa (Saldo Final = saldo bancário atual) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            Fechamento de Caixa
            <AjudaTooltip
              texto="Movimento bancário do período (Extrato Bancário). O Saldo Final é o saldo bancário consolidado da unidade."
              rotulo="Ajuda: Fechamento de Caixa"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FaixaFluxo
            loading={finFetching}
            etapas={[
              {
                rotulo: "Saldo Inicial",
                valor: saldos.saldoInicial,
                tone: saldos.saldoInicial >= 0 ? "success" : "destructive",
              },
              { rotulo: "Entradas", valor: saldos.entradas, tone: "success", sinal: "+" },
              { rotulo: "Saídas", valor: saldos.saidas, tone: "destructive", sinal: "−" },
              {
                rotulo: "Saldo Final",
                valor: saldos.saldoFinal,
                tone: saldos.saldoFinal >= 0 ? "success" : "destructive",
                destaque: true,
                hint: "Saldo bancário consolidado",
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* Nível 3 — Investimentos e Transferências */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
            Investimentos e Transferências entre Unidades
            <AjudaTooltip
              texto="Movimentações que não entram em Receita nem Despesa do mês."
              rotulo="Ajuda: Investimentos e Transferências entre Unidades"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 md:divide-x">
            <BlocoLiquido
              titulo="Fundos de Investimento"
              icon={Landmark}
              loading={finFetching}
              itens={[
                { rotulo: "Aportado no Fundo", valor: fechamento.aportadoFundo },
                { rotulo: "Resgatado do Fundo", valor: fechamento.resgatadoFundo },
              ]}
              liquido={{
                rotulo: "Saldo líquido aplicado",
                valor: fechamento.aportadoFundo - fechamento.resgatadoFundo,
              }}
            />
            <BlocoLiquido
              titulo="Transferências entre Unidades"
              icon={ArrowLeftRight}
              loading={finFetching}
              className="md:pl-6"
              itens={[
                { rotulo: "Enviado a Outras Unidades", valor: fechamento.enviadoOutras },
                { rotulo: "Recebido de Outras Unidades", valor: fechamento.recebidoOutras },
              ]}
              liquido={{ rotulo: "Saldo líquido recebido", valor: fechamento.saldoTransferencias }}
            />
          </div>
        </CardContent>
      </Card>

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

      {/* Nível 4 — gráficos */}
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
                  {/* Sem <>…</>: o Recharts não enxerga <Line> dentro de Fragment (react-is 18 × React 19). */}
                  {fundosVisiveis.length > 1 && <Legend />}
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
                    fundosVisiveis.map((f, i) => (
                      <Line
                        key={f.id}
                        type="monotone"
                        dataKey={f.id}
                        name={f.destination || f.name}
                        stroke={ORIGEM_CORES[i % ORIGEM_CORES.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Nível 5 — Indicadores de Captação (admissão de alunos, não caixa) */}
      <section className="space-y-3 border-t pt-6">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-muted-foreground">
            Indicadores de Captação
          </h2>
          <p className="text-xs text-muted-foreground">
            Alunos, inadimplência e leads — indicadores de admissão, separados do fechamento
            financeiro do mês.
          </p>
        </div>

        {/* Quadro 1 — Alunos Matriculados Ativos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-5 w-5 text-muted-foreground" />
              Alunos Matriculados Ativos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-1">
              <MetricCard
                size="sm"
                flat
                label="Alunos Matriculados Ativos"
                icon={GraduationCap}
                tone="primary"
                loading={alunosFetching}
                value={alunosSemNenhumDado ? "—" : String(alunos?.total ?? 0)}
                hint={alunosHint}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <LineChartIcon className="h-4 w-4 text-muted-foreground" />
                Evolução de Alunos Ativos
                <AjudaTooltip
                  texto="Total de alunos matriculados ativos no fechamento de cada mês (último dia), por unidade. Só aparecem os meses já capturados — sem estimativa retroativa."
                  rotulo="Ajuda: Evolução de Alunos Ativos"
                />
              </div>
              {historicoFetching ? (
                <Skeleton className="h-72 w-full" />
              ) : serieAlunos.length === 0 ? (
                <div className="flex h-72 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-6 w-6" />
                  Nenhum fechamento mensal registrado ainda para esta unidade. O primeiro ponto
                  entra no último dia do mês.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={serieAlunos} margin={{ top: 10, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${v} aluno(s)`, "Ativos"]}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Alunos ativos"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quadro 2 — Inadimplência */}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Percent className="h-5 w-5 text-muted-foreground" />
              Inadimplência
              {isAdmin && selected !== "all" && integracaoDisponivel && unidadeNome && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setFechamentoAberto(true)}
                >
                  Fechar inadimplência do mês
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                size="sm"
                flat
                label="Inadimplência anual"
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
                      : anualParcialAte
                        ? `Parcial: ${formatBRL(inadimplenteAno)} — boletos varridos só até ${anualParcialAte.split("-").reverse().join("/")}`
                        : `${formatBRL(inadimplenteAno)} inadimplente no ano`
                }
              />
              <MetricCard
                size="sm"
                flat
                label="Último mês fechado"
                icon={Percent}
                tone="warning"
                loading={historicoInadFetching}
                value={ultimoInad ? formatarPercentual(ultimoInad.mensal) : "—"}
                hint={
                  ultimoInad
                    ? `${rotuloMes(ultimoInad.anoMes)}, ${formatBRL(ultimoInad.inadimplenteMes)} inadimplente`
                    : "Nenhum mês fechado ainda"
                }
              />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <LineChartIcon className="h-4 w-4 text-muted-foreground" />
                Evolução da Inadimplência
                <AjudaTooltip
                  texto="Percentual de inadimplência (mensal e acumulada no ano) de cada mês fechado. Os pontos são gravados manualmente pelo botão de fechamento, após o retorno bancário do dia 01. Em Todas as Unidades só aparecem os meses fechados nas quatro unidades, com o percentual calculado sobre a soma dos valores em R$."
                  rotulo="Ajuda: Evolução da Inadimplência"
                />
              </div>
              {historicoInadFetching ? (
                <Skeleton className="h-72 w-full" />
              ) : serieInad.pontos.length === 0 ? (
                <div className="flex h-72 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                  <AlertTriangle className="h-6 w-6" />
                  Nenhum fechamento de inadimplência registrado ainda. O primeiro ponto é gravado
                  pelo botão de fechamento após o retorno bancário.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={serieInad.pontos}
                    margin={{ top: 10, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `${v.toLocaleString("pt-BR")}%`}
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    />
                    <Tooltip
                      formatter={(
                        v: number,
                        name: string,
                        item: { payload?: PontoInadimplencia },
                      ) => {
                        const p = item.payload;
                        const reais =
                          name === "Mensal" ? p?.inadimplenteMes : p?.inadimplenteAcumulado;
                        return [
                          `${formatarPercentual(v)}${reais != null ? ` — ${formatBRL(reais)} inadimplente` : ""}`,
                          name,
                        ];
                      }}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="mensal"
                      name="Mensal"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="acumulada"
                      name="Acumulada no ano"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {serieInad.parciais.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {serieInad.parciais.map((p) => (
                    <li key={p.anoMes}>
                      Fechamento parcial: {rotuloMes(p.anoMes)} (faltam:{" "}
                      {p.faltam
                        .map((id) => schools.find((s) => s.id === id)?.name ?? id)
                        .join(", ")}
                      )
                    </li>
                  ))}
                </ul>
              )}
              {resumoMesAnterior && (
                <p className="mt-2 text-xs text-muted-foreground">{resumoMesAnterior}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quadro 3 — Leads */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-5 w-5 text-muted-foreground" />
              Leads
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard
                size="sm"
                flat
                label="Criação de Leads"
                icon={UserPlus}
                tone="primary"
                loading={leadsFetching}
                value={String(totalLeads)}
                hint="Leads no período (Admissões)"
              />
              <MetricCard
                size="sm"
                flat
                label="Matrículas Efetivadas"
                icon={CheckCircle2}
                tone="success"
                loading={leadsFetching}
                value={String(matriculasEfetivadas)}
                hint="Leads convertidas em matrícula"
              />
              <MetricCard
                size="sm"
                flat
                label="Conversão de Leads"
                icon={CheckCircle2}
                tone="primary"
                loading={leadsFetching}
                value={
                  totalLeads > 0 ? `${Math.round((matriculasEfetivadas / totalLeads) * 100)}%` : "—"
                }
                hint="Matrículas ÷ Leads do período"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <PieChartIcon className="h-4 w-4 text-muted-foreground" />
                Origem das Leads
              </div>
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
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value} lead(s)`, name]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {unidadeNome && (
        <FechamentoInadimplenciaModal
          open={fechamentoAberto}
          onOpenChange={setFechamentoAberto}
          unidade={unidadeNome}
        />
      )}
    </div>
  );
}

type Tone = "primary" | "success" | "destructive" | "warning";

function toneClasses(tone: Tone): string {
  return tone === "success"
    ? "bg-success/10 text-success"
    : tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-600"
        : "bg-primary/10 text-primary";
}

function FaixaFluxo({
  etapas,
  loading,
}: {
  etapas: {
    rotulo: string;
    valor: number;
    tone: Tone;
    sinal?: string;
    destaque?: boolean;
    hint?: string;
  }[];
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
      {etapas.map((e, i) => (
        <div key={e.rotulo} className="flex flex-1 items-center gap-3">
          {i > 0 && (
            <ArrowRight className="hidden h-5 w-5 shrink-0 text-muted-foreground/60 md:block" />
          )}
          <div
            className={`flex-1 rounded-lg border p-4 ${e.destaque ? "border-primary/40 bg-primary/5" : "bg-muted/30"}`}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {e.sinal && <span className="mr-1 font-semibold">{e.sinal}</span>}
              {e.rotulo}
            </div>
            {loading ? (
              <Skeleton className="mt-1 h-8 w-32" />
            ) : (
              <div
                className={`mt-1 tabular-nums font-bold ${e.destaque ? "text-2xl" : "text-xl"} ${toneClasses(e.tone).split(" ")[1]}`}
              >
                {formatBRL(e.valor)}
              </div>
            )}
            {e.hint && <div className="mt-0.5 text-xs text-muted-foreground">{e.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlocoLiquido({
  titulo,
  icon: Icon,
  itens,
  liquido,
  loading,
  className,
}: {
  titulo: string;
  icon: React.ComponentType<{ className?: string }>;
  itens: { rotulo: string; valor: number }[];
  liquido: { rotulo: string; valor: number };
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {titulo}
      </div>
      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-1 text-sm">
          {itens.map((it) => (
            <div key={it.rotulo} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{it.rotulo}</span>
              <span className="font-semibold tabular-nums">{formatBRL(it.valor)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-2">
            <span className="font-medium">{liquido.rotulo}</span>
            <span
              className={`text-xl font-bold tabular-nums ${liquido.valor >= 0 ? "text-success" : "text-destructive"}`}
            >
              {formatBRL(liquido.valor)}
            </span>
          </div>
        </div>
      )}
    </div>
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
  size = "md",
  flat = false,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  hint?: string;
  ajuda?: string;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  /** Dentro de um quadro: borda leve em vez de Card aninhado. */
  flat?: boolean;
}) {
  const toneClass = toneClasses(tone);
  const iconBox = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const iconSize = size === "lg" ? "h-7 w-7" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const valueSize = size === "lg" ? "text-3xl" : size === "sm" ? "text-xl" : "text-2xl";
  const padding = size === "lg" ? "p-6" : size === "sm" ? "p-4" : "p-5";
  const conteudo = (
    <div className={`flex items-start gap-4 ${padding}`}>
      <div
        className={`flex ${iconBox} shrink-0 items-center justify-center rounded-lg ${toneClass}`}
      >
        <Icon className={iconSize} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          {label}
          {ajuda && <AjudaTooltip texto={ajuda} rotulo={`Ajuda: ${label}`} />}
        </div>
        {loading ? (
          <Skeleton className={`mt-1 ${size === "lg" ? "h-10 w-40" : "h-7 w-24"}`} />
        ) : (
          <div className={`${valueSize} font-bold tabular-nums`}>{value}</div>
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
    </div>
  );
  if (flat) return <div className="rounded-lg border bg-muted/30">{conteudo}</div>;
  return (
    <Card className={size === "lg" ? "shadow-md" : undefined}>
      <CardContent className="p-0">{conteudo}</CardContent>
    </Card>
  );
}
