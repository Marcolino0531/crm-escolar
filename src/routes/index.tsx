import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownCircle, ArrowUpCircle, Upload, Wallet, Download, Pencil, Trash2, AlertCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { useSchool, usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { formatDateBR } from "@/lib/date-utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "School Hub" },
      { name: "description", content: "Visão geral das despesas e receitas por centro de custo." },
    ],
  }),
  component: DashboardGate,
});

function DashboardGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro_dashboard"))
    return <AccessDenied message="Você não tem permissão para visualizar o Dashboard." />;
  return <Dashboard />;
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function toLocalISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function firstDayOfMonth(d = new Date()) {
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function lastDayOfMonth(d = new Date()) {
  return toLocalISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function Dashboard() {
  const { selected, schools } = useSchool();
  const { canEdit } = usePermissions();
  const isAdmin = canEdit("financeiro");
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState<string>(firstDayOfMonth());
  const [endDate, setEndDate] = useState<string>(lastDayOfMonth());
  const [categoryFilter, setCategoryFilter] = useState<string>("all"); // "all" | `e:<ccId>` | `r:<rcId>`
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>("all");
  const [editing, setEditing] = useState<any | null>(null);
  const [drill, setDrill] = useState<{ kind: "expense" | "revenue"; id: string | null; name: string; color: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", selected],
    queryFn: async () => {
      let txQuery = supabase.from("transactions").select("*");
      if (selected !== "all") txQuery = txQuery.eq("school_id", selected);
      const [txRes, ccRes, subCcRes, rcRes, rsRes, recRes] = await Promise.all([
        txQuery,
        supabase.from("cost_centers").select("*").order("name"),
        supabase.from("sub_cost_centers").select("*").order("name"),
        supabase.from("revenue_categories").select("*").order("name"),
        supabase.from("revenue_subcategories").select("*").order("name"),
        supabase.from("boleto_reconciliations").select("transaction_id, boleto_reconciliation_items(amount, revenue_category_id, revenue_subcategory_id, subcategory_label)"),
      ]);
      if (txRes.error) throw txRes.error;
      if (ccRes.error) throw ccRes.error;
      if (subCcRes.error) throw subCcRes.error;
      if (rcRes.error) throw rcRes.error;
      if (rsRes.error) throw rsRes.error;
      if (recRes.error) throw recRes.error;
      return {
        transactions: txRes.data ?? [],
        costCenters: ccRes.data ?? [],
        subCostCenters: subCcRes.data ?? [],
        revenueCats: rcRes.data ?? [],
        revenueSubs: rsRes.data ?? [],
        reconciliations: recRes.data ?? [],
      };
    },
  });

  const { data: initialBalance } = useQuery({
    queryKey: ["initial_balance", selected, startDate],
    queryFn: async () => {
      if (selected === "all") return null;
      const { data, error } = await supabase
        .from("initial_balances" as any)
        .select("*")
        .eq("school_id", selected)
        .lte("reference_date", startDate)
        .order("reference_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const schoolLabel = selected === "all" ? "Todas as Unidades" : (schools.find(s => s.id === selected)?.name ?? "");

  const txs = data?.transactions ?? [];
  const ccs = data?.costCenters ?? [];
  const subCcs = data?.subCostCenters ?? [];
  const rcs = data?.revenueCats ?? [];
  const rss = data?.revenueSubs ?? [];
  const recs = data?.reconciliations ?? [];

  // Mapa: transaction_id (pai) -> itens da conciliação (split por subcategoria).
  const recItemsByTx = useMemo(() => {
    const map = new Map<string, Array<{ amount: number; revenue_category_id: string | null; revenue_subcategory_id: string | null; subcategory_label: string }>>();
    for (const r of recs as any[]) {
      const items = (r.boleto_reconciliation_items ?? []) as any[];
      if (items.length) map.set(r.transaction_id, items);
    }
    return map;
  }, [recs]);

  // IDs de transações que foram desmembradas em filhas (split) — não devem ser somadas (evita duplicidade).
  const splitParentIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of txs) {
      const pid = (t as any).parent_transaction_id as string | null | undefined;
      if (pid) set.add(pid);
    }
    return set;
  }, [txs]);

  // Ordenação do extrato: por Data (cronológica); dentro do dia, Entradas antes
  // de Saídas; e, dentro de cada grupo, em ordem alfabética pela descrição.
  const filteredTxs = useMemo(() =>
    [...txs]
      .filter(t => t.date >= startDate && t.date <= endDate)
      .filter(t => !splitParentIds.has(t.id))
      .sort((a, b) =>
        a.date.localeCompare(b.date)
        || (a.type === "entrada" ? 0 : 1) - (b.type === "entrada" ? 0 : 1)
        || String(a.description ?? "").localeCompare(String(b.description ?? ""), "pt-BR", { sensitivity: "base" })
        || a.id.localeCompare(b.id)),
    [txs, startDate, endDate, splitParentIds]);

  const totalIn = filteredTxs.filter(t => t.type === "entrada").reduce((s, t) => s + Number(t.amount), 0);
  const totalOut = filteredTxs.filter(t => t.type === "saida").reduce((s, t) => s + Number(t.amount), 0);

  // Saldo Inicial dinâmico: corresponde ao Saldo Final (running balance) da última
  // transação cronológica anterior ao startDate, respeitando o colégio selecionado e
  // ignorando lançamentos-pai desmembrados. Equivale a somar TODAS as transações
  // anteriores ao período filtrado (sem cortar por baselineDate). Apenas quando NÃO
  // existe nenhuma transação anterior é que usamos o Saldo Inicial manual como ponto
  // de partida (cenário do primeiro mês de uso).
  const priorTxs = useMemo(() =>
    txs
      .filter(t => !splitParentIds.has(t.id))
      .filter(t => t.date < startDate)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    [txs, splitParentIds, startDate]);
  const carryFromPriorTxs = useMemo(() =>
    priorTxs.reduce((s, t) => s + (t.type === "entrada" ? Number(t.amount) : -Number(t.amount)), 0),
    [priorTxs]);
  const manualBaseline = Number(initialBalance?.amount ?? 0);
  const startingBalance = priorTxs.length > 0 ? carryFromPriorTxs : manualBaseline;
  const finalBalance = startingBalance + totalIn - totalOut;

  const rowsWithBalance = useMemo(() => {
    let running = startingBalance;
    return filteredTxs.map(t => {
      running += t.type === "entrada" ? Number(t.amount) : -Number(t.amount);
      return { ...t, running };
    });
  }, [filteredTxs, startingBalance]);

  // Table filters: by category (expense cost_center OR revenue_category) and subcategory.
  const tableRows = useMemo(() => {
    return rowsWithBalance.filter(t => {
      if (categoryFilter === "all") return true;
      const [kind, id] = categoryFilter.split(":");
      if (kind === "e") {
        if (t.type !== "saida" || t.cost_center_id !== id) return false;
        if (subcategoryFilter !== "all" && (t as any).sub_cost_center_id !== subcategoryFilter) return false;
        return true;
      }
      if (kind === "r") {
        if (t.type !== "entrada") return false;
        const items = recItemsByTx.get(t.id);
        if (items && items.length) {
          if (!items.some(it => it.revenue_category_id === id)) return false;
          if (subcategoryFilter !== "all" && !items.some(it => it.revenue_subcategory_id === subcategoryFilter)) return false;
          return true;
        }
        if ((t as any).revenue_category_id !== id) return false;
        if (subcategoryFilter !== "all" && (t as any).revenue_subcategory_id !== subcategoryFilter) return false;
        return true;
      }
      return true;
    });
  }, [rowsWithBalance, categoryFilter, subcategoryFilter, recItemsByTx]);

  const subcategoryOptions = useMemo(() => {
    if (categoryFilter === "all") return [] as { id: string; name: string }[];
    const [kind, id] = categoryFilter.split(":");
    let opts: { id: string; name: string }[] = [];
    if (kind === "e") opts = subCcs.filter((s: any) => s.cost_center_id === id).map((s: any) => ({ id: s.id, name: s.name }));
    if (kind === "r") opts = rss.filter((s: any) => s.revenue_category_id === id).map((s: any) => ({ id: s.id, name: s.name }));
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [categoryFilter, subCcs, rss]);

  const byCC = ccs.map(cc => {
    const total = filteredTxs
      .filter(t => t.cost_center_id === cc.id && t.type === "saida")
      .reduce((s, t) => s + Number(t.amount), 0);
    return { id: cc.id as string | null, name: cc.name, total, color: cc.color };
  }).filter(x => x.total > 0).sort((a, b) => b.total - a.total);

  const uncategorized = filteredTxs.filter(t => !t.cost_center_id && t.type === "saida")
    .reduce((s, t) => s + Number(t.amount), 0);
  if (uncategorized > 0) byCC.push({ id: null, name: "Sem categoria", total: uncategorized, color: "#94a3b8" });

  // Receitas agrupadas por SUBCATEGORIA. Para transações conciliadas,
  // usa o desmembramento salvo em boleto_reconciliation_items (split virtual,
  // sem duplicar transações). Para as demais, usa revenue_subcategory_id da própria tx.
  const subPalette = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1"];
  const revBySubId = useMemo(() => {
    const map = new Map<string | null, number>();
    let uncategorized = 0;
    for (const t of filteredTxs) {
      if (t.type !== "entrada") continue;
      const items = recItemsByTx.get(t.id);
      if (items && items.length) {
        for (const it of items) {
          const k = it.revenue_subcategory_id;
          if (k) map.set(k, (map.get(k) ?? 0) + Number(it.amount));
          else uncategorized += Number(it.amount);
        }
      } else {
        const k = (t as any).revenue_subcategory_id as string | null;
        if (k) map.set(k, (map.get(k) ?? 0) + Number(t.amount));
        else uncategorized += Number(t.amount);
      }
    }
    return { map, uncategorized };
  }, [filteredTxs, recItemsByTx]);

  const byRev = rss.map((rs: any, i: number) => {
    const total = revBySubId.map.get(rs.id) ?? 0;
    return {
      id: rs.id as string | null,
      name: rs.name as string,
      total,
      color: (rs.color as string | undefined) ?? subPalette[i % subPalette.length],
    };
  }).filter(x => x.total > 0).sort((a, b) => b.total - a.total);

  if (revBySubId.uncategorized > 0) byRev.push({ id: null, name: "Sem subcategoria", total: revBySubId.uncategorized, color: "#94a3b8" });

  const drillData = useMemo(() => {
    if (!drill) return null;
    const isExpense = drill.kind === "expense";

    if (isExpense) {
      const matching = filteredTxs.filter(t => t.type === "saida" && (t.cost_center_id ?? null) === drill.id);
      const total = matching.reduce((s, t) => s + Number(t.amount), 0);
      const subs = subCcs
        .filter((s: any) => s.cost_center_id === drill.id)
        .map((s: any) => {
          const sum = matching
            .filter(t => ((t as any).sub_cost_center_id ?? null) === s.id)
            .reduce((acc, t) => acc + Number(t.amount), 0);
          return { id: s.id as string, name: s.name as string, total: sum };
        })
        .filter(s => s.total > 0)
        .sort((a, b) => b.total - a.total);
      const unsub = matching
        .filter(t => !(t as any).sub_cost_center_id)
        .reduce((acc, t) => acc + Number(t.amount), 0);
      if (unsub > 0) subs.push({ id: "__none__", name: "Sem subcategoria", total: unsub });
      return { total, subs };
    }

    // Receita — usa boleto_reconciliation_items quando disponível.
    const subTotals = new Map<string, number>();
    let unsub = 0;
    let total = 0;
    for (const t of filteredTxs) {
      if (t.type !== "entrada") continue;
      const items = recItemsByTx.get(t.id);
      if (items && items.length) {
        for (const it of items) {
          if ((it.revenue_category_id ?? null) !== drill.id) continue;
          total += Number(it.amount);
          if (it.revenue_subcategory_id) {
            subTotals.set(it.revenue_subcategory_id, (subTotals.get(it.revenue_subcategory_id) ?? 0) + Number(it.amount));
          } else {
            unsub += Number(it.amount);
          }
        }
      } else {
        if (((t as any).revenue_category_id ?? null) !== drill.id) continue;
        total += Number(t.amount);
        const k = (t as any).revenue_subcategory_id as string | null;
        if (k) subTotals.set(k, (subTotals.get(k) ?? 0) + Number(t.amount));
        else unsub += Number(t.amount);
      }
    }
    const subs = rss
      .filter((s: any) => s.revenue_category_id === drill.id)
      .map((s: any) => ({ id: s.id as string, name: s.name as string, total: subTotals.get(s.id) ?? 0 }))
      .filter(s => s.total > 0)
      .sort((a, b) => b.total - a.total);
    if (unsub > 0) subs.push({ id: "__none__", name: "Sem subcategoria", total: unsub });
    return { total, subs };
  }, [drill, filteredTxs, subCcs, rss, recItemsByTx]);

  const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

  function setCurrentMonth() {
    setStartDate(firstDayOfMonth());
    setEndDate(lastDayOfMonth());
  }

  function exportExcel() {
    const rows = rowsWithBalance.map(t => {
      const cc = ccs.find(c => c.id === t.cost_center_id);
      const subCc = subCcs.find(s => s.id === (t as any).sub_cost_center_id);
      const rc = rcs.find((r: any) => r.id === (t as any).revenue_category_id);
      const rs = rss.find((r: any) => r.id === (t as any).revenue_subcategory_id);
      const isEntrada = t.type === "entrada";
      return {
        Data: formatDateBR(t.date),
        Descrição: t.description,
        Tipo: isEntrada ? "Entrada" : "Saída",
        Categoria: isEntrada ? (rc?.name ?? "") : (cc?.name ?? ""),
        Subcategoria: isEntrada ? (rs?.name ?? "") : (subCc?.name ?? ""),
        Valor: Number(t.amount),
        "Saldo em Conta": Number(t.running.toFixed(2)),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Extrato");
    XLSX.writeFile(wb, `extrato_${startDate}_${endDate}.xlsx`);
    toast.success("Planilha baixada.");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Exibindo: <span className="font-medium text-foreground">{schoolLabel}</span></p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link to="/upload"><Upload className="h-4 w-4" /> Importar Extrato</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Saldo Inicial" value={formatBRL(startingBalance)} icon={Wallet} tone={startingBalance >= 0 ? "success" : "destructive"} />
        <KpiCard label="Entradas" value={formatBRL(totalIn)} icon={ArrowUpCircle} tone="success" />
        <KpiCard label="Saídas" value={formatBRL(totalOut)} icon={ArrowDownCircle} tone="destructive" />
        <KpiCard label="Saldo Final" value={formatBRL(finalBalance)} icon={Wallet} tone={finalBalance >= 0 ? "success" : "destructive"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Despesas</CardTitle></CardHeader>
          <CardContent className="h-[340px]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>
            ) : byCC.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem despesas no período.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCC} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                  <Bar
                    dataKey="total"
                    radius={[8, 8, 0, 0]}
                    cursor="pointer"
                    onClick={(d: any) => setDrill({ kind: "expense", id: d.id, name: d.name, color: d.color })}
                  >
                    {byCC.map((d, i) => <Cell key={i} fill={d.color} cursor="pointer" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Receitas</CardTitle></CardHeader>
          <CardContent className="h-[340px]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>
            ) : byRev.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem receitas no período.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byRev} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                  <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                    {byRev.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Extrato Completo</CardTitle>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block">De</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Até</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <Button variant="outline" size="sm" onClick={setCurrentMonth}>Mês atual</Button>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Categoria</label>
              <Select
                value={categoryFilter}
                onValueChange={(v) => { setCategoryFilter(v); setSubcategoryFilter("all"); }}
              >
                <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {ccs.length > 0 && (
                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Despesas</div>
                  )}
                  {[...ccs].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((c: any) => (
                    <SelectItem key={`e:${c.id}`} value={`e:${c.id}`}>{c.name}</SelectItem>
                  ))}
                  {rcs.length > 0 && (
                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Receitas</div>
                  )}
                  {[...rcs].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((c: any) => (
                    <SelectItem key={`r:${c.id}`} value={`r:${c.id}`}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Subcategoria</label>
              <Select
                value={subcategoryFilter}
                onValueChange={setSubcategoryFilter}
                disabled={categoryFilter === "all" || subcategoryOptions.length === 0}
              >
                <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {subcategoryOptions.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={tableRows.length === 0}>
              <Download className="h-4 w-4" /> Exportar Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tableRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma transação encontrada com os filtros selecionados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4">Data</th>
                    <th className="py-2 pr-4">Descrição</th>
                    <th className="py-2 pr-4">Categoria</th>
                    <th className="py-2 pr-4 text-right">Valor</th>
                    <th className="py-2 pr-4 text-right">Saldo em Conta</th>
                    <th className="py-2 pr-4">Observação</th>
                    {isAdmin && <th className="py-2 pr-2 text-right">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(t => {
                    const cc = ccs.find(c => c.id === t.cost_center_id);
                    const subCc = subCcs.find(s => s.id === (t as any).sub_cost_center_id);
                    const rc = rcs.find((r: any) => r.id === (t as any).revenue_category_id);
                    const rs = rss.find((r: any) => r.id === (t as any).revenue_subcategory_id);
                    const isEntrada = t.type === "entrada";
                    const tag = isEntrada ? rc : cc;
                    const subTag = isEntrada ? rs : subCc;
                    const tagColor = (tag as any)?.color ?? "#94a3b8";
                    const needsCategory = isEntrada
                      ? !(t as any).revenue_category_id
                      : !t.cost_center_id;
                    return (
                      <tr
                        key={t.id}
                        className={`group border-b border-border/50 last:border-0 ${needsCategory ? "bg-destructive/10 hover:bg-destructive/15" : ""}`}
                      >
                        <td className="py-2 pr-4">{formatDateBR(t.date)}</td>
                        <td className="py-2 pr-4">{t.description}</td>
                        <td className="py-2 pr-4">
                          {needsCategory ? (
                            <button
                              type="button"
                              onClick={() => isAdmin && setEditing(t)}
                              disabled={!isAdmin}
                              className="inline-flex w-fit items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground disabled:cursor-default"
                              title={isAdmin ? "Definir categoria" : "Sem categoria"}
                            >
                              <AlertCircle className="h-3 w-3" /> Definir
                            </button>
                          ) : tag ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-secondary px-2 py-0.5 text-xs">
                                <span className="h-2 w-2 rounded-full" style={{ background: tagColor }} />
                                {(tag as any).name}
                              </span>
                              {subTag && (
                                <span className="ml-1 text-[11px] text-muted-foreground">
                                  ↳ {(subTag as any).name}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className={`py-2 pr-4 text-right font-medium ${isEntrada ? "text-success" : "text-destructive"}`}>
                          {isEntrada ? "+" : "-"}{formatBRL(Number(t.amount))}
                        </td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${t.running >= 0 ? "" : "text-destructive"}`}>
                          {formatBRL(t.running)}
                        </td>
                        <td className="py-2 pr-4 max-w-[220px]">
                          {(t as any).notes ? (
                            <TooltipProvider delayDuration={150}>
                              <UITooltip>
                                <TooltipTrigger asChild>
                                  <span className="block truncate text-xs text-muted-foreground cursor-help">
                                    {(t as any).notes}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs whitespace-pre-wrap">
                                  {(t as any).notes}
                                </TooltipContent>
                              </UITooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-2 pr-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(t)}
                              className="opacity-60 group-hover:opacity-100"
                              title="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditTransactionDialog
          tx={editing}
          ccs={ccs}
          subCcs={subCcs}
          rcs={rcs}
          rss={rss}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            setEditing(null);
          }}
        />
      )}

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {drill && <span className="h-3 w-3 rounded-full" style={{ background: drill.color }} />}
              Detalhamento: {drill?.name}
              {drillData && <span className="ml-2 text-muted-foreground font-normal">— {formatBRL(drillData.total)}</span>}
            </DialogTitle>
          </DialogHeader>
          {drillData && (
            drillData.subs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma subcategoria com lançamentos no período.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={drillData.subs}
                        dataKey="total"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                      >
                        {drillData.subs.map((_, i) => (
                          <Cell key={i} fill={palette[i % palette.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatBRL(v)} contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-y-auto max-h-[240px]">
                  <table className="w-full text-sm">
                    <tbody>
                      {drillData.subs.map((s, i) => {
                        const pct = drillData.total > 0 ? (s.total / drillData.total) * 100 : 0;
                        return (
                          <tr key={s.id} className="border-b border-border/50 last:border-0">
                            <td className="py-2 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                                <span>{s.name}</span>
                              </div>
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">{formatBRL(s.total)}</td>
                            <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDrill(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditTransactionDialog({
  tx, ccs, subCcs, rcs, rss, onClose, onSaved,
}: {
  tx: any;
  ccs: any[]; subCcs: any[]; rcs: any[]; rss: any[];
  onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState<string>(tx.date);
  const [description, setDescription] = useState<string>(tx.description ?? "");
  // Signed amount: positive = entrada, negative = saída
  const initialSigned = (tx.type === "entrada" ? 1 : -1) * Number(tx.amount);
  const [amountStr, setAmountStr] = useState<string>(initialSigned.toString().replace(".", ","));
  const [ccId, setCcId] = useState<string>(tx.cost_center_id ?? "");
  const [subCcId, setSubCcId] = useState<string>(tx.sub_cost_center_id ?? "");
  const [rcId, setRcId] = useState<string>(tx.revenue_category_id ?? "");
  const [rsId, setRsId] = useState<string>(tx.revenue_subcategory_id ?? "");
  const [notes, setNotes] = useState<string>(tx.notes ?? "");
  const [saving, setSaving] = useState(false);

  const parsedAmount = Number(amountStr.replace(/\./g, "").replace(",", "."));
  const isEntrada = parsedAmount >= 0;

  const filteredSubCcs = useMemo(() => subCcs.filter(s => s.cost_center_id === ccId), [subCcs, ccId]);
  const filteredRss = useMemo(() => rss.filter(s => s.revenue_category_id === rcId), [rss, rcId]);

  useEffect(() => {
    if (ccId && !filteredSubCcs.some(s => s.id === subCcId)) setSubCcId("");
  }, [ccId, filteredSubCcs, subCcId]);
  useEffect(() => {
    if (rcId && !filteredRss.some(s => s.id === rsId)) setRsId("");
  }, [rcId, filteredRss, rsId]);

  async function save() {
    if (!date || !description.trim() || isNaN(parsedAmount) || parsedAmount === 0) {
      return toast.error("Preencha data, descrição e um valor diferente de zero.");
    }
    setSaving(true);
    const patch: any = {
      date,
      description: description.trim(),
      amount: Math.abs(parsedAmount),
      type: isEntrada ? "entrada" : "saida",
      cost_center_id: isEntrada ? null : (ccId || null),
      sub_cost_center_id: isEntrada ? null : (subCcId || null),
      revenue_category_id: isEntrada ? (rcId || null) : null,
      revenue_subcategory_id: isEntrada ? (rsId || null) : null,
      notes: notes.trim() || null,
    };
    const { error } = await supabase.from("transactions").update(patch).eq("id", tx.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Transação atualizada.");
    onSaved();
  }

  async function remove() {
    if (!confirm("Tem certeza que deseja excluir esta transação?")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", tx.id);
    if (error) return toast.error(error.message);
    toast.success("Transação excluída.");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Transação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Data</label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Valor (use - para saída)</label>
              <Input value={amountStr} onChange={e => setAmountStr(e.target.value)} placeholder="-1234,56" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isNaN(parsedAmount) ? "Valor inválido" : `${isEntrada ? "Entrada" : "Saída"}: ${formatBRL(Math.abs(parsedAmount))}`}
              </p>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block">Descrição</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          {isEntrada ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block">Categoria (Receita)</label>
                <Select value={rcId} onValueChange={setRcId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                  <SelectContent>
                    {[...rcs].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((rc: any) => (
                      <SelectItem key={rc.id} value={rc.id}>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: rc.color ?? "#10b981" }} />
                          {rc.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block">Subcategoria</label>
                <Select value={rsId} onValueChange={setRsId} disabled={!rcId || filteredRss.length === 0}>
                  <SelectTrigger><SelectValue placeholder={!rcId ? "Selecione categoria…" : filteredRss.length === 0 ? "Sem subcategorias" : "Selecionar…"} /></SelectTrigger>
                  <SelectContent>
                    {[...filteredRss].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((rs: any) => (
                      <SelectItem key={rs.id} value={rs.id}>{rs.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block">Centro de Custo (Despesa)</label>
                <Select value={ccId} onValueChange={setCcId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                  <SelectContent>
                    {[...ccs].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((cc: any) => (
                      <SelectItem key={cc.id} value={cc.id}>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: cc.color }} />
                          {cc.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block">Subcentro</label>
                <Select value={subCcId} onValueChange={setSubCcId} disabled={!ccId || filteredSubCcs.length === 0}>
                  <SelectTrigger><SelectValue placeholder={!ccId ? "Selecione centro…" : filteredSubCcs.length === 0 ? "Sem subcentros" : "Selecionar…"} /></SelectTrigger>
                  <SelectContent>
                    {[...filteredSubCcs].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block">Observação (opcional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Cópia de chaves com chaveiro para o Bloco B"
              rows={3}
              maxLength={1000}
            />
          </div>
        </div>
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="destructive" onClick={remove}>
            <Trash2 className="h-4 w-4" /> Excluir Transação
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>Salvar Alterações</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InitialBalanceDialog({
  schoolId, referenceDate, current, onSaved,
}: {
  schoolId: string; referenceDate: string; current: any; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(current?.amount?.toString() ?? "0");
  const [refDate, setRefDate] = useState<string>(current?.reference_date ?? referenceDate);
  const disabled = schoolId === "all";

  async function save() {
    if (disabled) return toast.error("Selecione um colégio específico no topo.");
    const v = Number(String(amount).replace(",", "."));
    if (isNaN(v)) return toast.error("Valor inválido.");
    const { error } = await supabase.from("initial_balances" as any).upsert({
      school_id: schoolId,
      reference_date: refDate,
      amount: v,
    } as any, { onConflict: "school_id,reference_date" });
    if (error) return toast.error(error.message);
    toast.success("Saldo inicial salvo.");
    onSaved();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} title={disabled ? "Selecione um colégio" : ""}>
          <Pencil className="h-4 w-4" /> Definir Saldo Inicial
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Definir Saldo Inicial</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block">Data de referência</label>
            <Input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">O Dashboard usa o saldo inicial mais recente até a data inicial do filtro.</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block">Valor (R$)</label>
            <Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({ label, value, icon: Icon, tone }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>;
  tone: "success" | "destructive";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tone === "success" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
