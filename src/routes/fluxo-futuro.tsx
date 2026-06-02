import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Repeat, RefreshCw, Building2, Construction } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchSponteInadimplencia } from "@/lib/sponte.functions";
import { useSchool, useRole } from "@/lib/app-context";
import { formatDateBR } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/fluxo-futuro")({
  component: FluxoFuturoPage,
});

type Forecast = {
  id: string;
  school_id: string;
  month: string;
  due_date: string | null;
  description: string;
  cost_center_id: string | null;
  sub_cost_center_id: string | null;
  projected_amount: number;
  status: string;
  series_id: string | null;
  notes: string | null;
};

type Series = {
  id: string;
  school_id: string;
  description: string;
  cost_center_id: string | null;
  sub_cost_center_id: string | null;
  projected_amount: number;
  due_day: number;
  start_month: string;
  end_month: string | null;
  skipped_months: string[];
};

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
function addMonths(iso: string, delta: number) {
  const [y, m] = iso.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}
function dueDateFor(monthIso: string, day: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const d = Math.min(day, lastDay);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// Regras do Fluxo Futuro p/ Receitas Previstas:
// - Mês atual: início = HOJE, fim = último dia do mês (vencidas ficam na Inadimplência).
// - Outro mês (futuro): início = dia 1, fim = último dia do mês.
function receitasDateRange(monthIso: string): { inicio: string; fim: string } {
  const [y, m] = monthIso.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const fim = ymd(y, m, lastDay);
  const today = new Date();
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m;
  const inicio = isCurrent ? ymd(y, m, today.getDate()) : ymd(y, m, 1);
  return { inicio, fim };
}
function fmtVenc(data: string): string {
  if (!data) return "—";
  if (data.includes("/")) return data;
  const [y, m, d] = data.split("-");
  return `${d}/${m}/${y}`;
}

// Unidades com integração Sponte ativa. CEC/CEC Baby compartilham um token
// (segmentado por turma); Núcleo Belvedere usa credenciais próprias (sem turmas).
const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere"];

function FluxoFuturoPage() {
  const { selected: schoolId, schools } = useSchool();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const today = new Date();
  const [month, setMonth] = useState(() => monthKey(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [editing, setEditing] = useState<Forecast | null>(null);
  const [creating, setCreating] = useState(false);
  const [scopeDialog, setScopeDialog] = useState<{ kind: "edit" | "delete"; forecast: Forecast } | null>(null);

  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost_centers_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_centers").select("id, name, color").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: subCostCenters = [] } = useQuery({
    queryKey: ["sub_cost_centers_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_cost_centers").select("id, name, cost_center_id").order("name");
      if (error) throw error;
      return data;
    },
  });

  const ccMap = useMemo(() => Object.fromEntries(costCenters.map((c) => [c.id, c])), [costCenters]);
  const subCcMap = useMemo(() => Object.fromEntries(subCostCenters.map((c) => [c.id, c])), [subCostCenters]);

  // Materialize fixed series for this month (admins only).
  useEffect(() => {
    if (schoolId === "all" || !isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data: series } = await supabase
        .from("recurring_series")
        .select("*")
        .eq("school_id", schoolId)
        .lte("start_month", month);
      if (cancelled || !series) return;
      const active = (series as Series[]).filter(
        (s) =>
          (s.end_month == null || s.end_month >= month) &&
          !(s.skipped_months ?? []).includes(month),
      );
      if (active.length === 0) return;
      const { data: existing } = await supabase
        .from("recurring_forecasts")
        .select("series_id")
        .eq("school_id", schoolId)
        .eq("month", month)
        .not("series_id", "is", null);
      const existingIds = new Set((existing ?? []).map((r: any) => r.series_id));
      const toInsert = active
        .filter((s) => !existingIds.has(s.id))
        .map((s) => ({
          school_id: schoolId,
          month,
          due_date: dueDateFor(month, s.due_day),
          description: s.description,
          cost_center_id: s.cost_center_id,
          sub_cost_center_id: s.sub_cost_center_id,
          projected_amount: s.projected_amount,
          status: "pending",
          series_id: s.id,
          normalized_key: `series:${s.id}:${month}`,
        }));
      if (toInsert.length > 0) {
        const { error } = await supabase.from("recurring_forecasts").insert(toInsert);
        if (!error) qc.invalidateQueries({ queryKey: ["recurring_forecasts"] });
      }
    })();
    return () => { cancelled = true; };
  }, [schoolId, month, isAdmin, qc]);

  const { data: forecasts = [], refetch } = useQuery({
    queryKey: ["recurring_forecasts", schoolId, month],
    enabled: schoolId !== "all",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_forecasts")
        .select("*")
        .eq("school_id", schoolId)
        .eq("month", month);
      if (error) throw error;
      const rows = (data ?? []) as Forecast[];
      return rows.sort((a, b) => {
        const da = a.due_date ?? "9999-12-31";
        const db = b.due_date ?? "9999-12-31";
        if (da !== db) return da.localeCompare(db);
        return (a.description ?? "").localeCompare(b.description ?? "", "pt-BR", { sensitivity: "base" });
      });
    },
  });

  const totalProjected = forecasts.reduce((s, f) => s + Number(f.projected_amount), 0);

  // ── Receitas Previstas (Sponte) — Inversão de Busca + segmentação por unidade ──
  const schoolName = schools.find((s) => s.id === schoolId)?.name ?? "";
  const sponteAtiva = UNIDADES_SPONTE.includes(schoolName);
  const { inicio: recInicio, fim: recFim } = useMemo(() => receitasDateRange(month), [month]);
  const fetchReceitas = useServerFn(fetchSponteInadimplencia);
  const {
    data: receitasData,
    isFetching: receitasLoading,
    error: receitasErr,
    refetch: refetchReceitas,
  } = useQuery({
    queryKey: ["sponte-receitas", schoolId, recInicio, recFim, schoolName],
    enabled: schoolId !== "all" && sponteAtiva,
    staleTime: 60_000,
    queryFn: () =>
      fetchReceitas({ data: { dataInicio: recInicio, dataFim: recFim, unidade: schoolName } }),
  });
  const receitas = useMemo(
    () =>
      [...(receitasData?.pendencias ?? [])].sort((a, b) => {
        const da = a.vencimento ?? "";
        const db = b.vencimento ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.nomeAluno.localeCompare(b.nomeAluno, "pt-BR", { sensitivity: "base" });
      }),
    [receitasData],
  );
  const receitasErroMsg =
    receitasData?.error ?? (receitasErr instanceof Error ? receitasErr.message : null);
  const totalReceitasPrevistas = receitas.reduce((s, r) => s + r.valorComDesconto, 0);
  const saldoProjetado = totalReceitasPrevistas - totalProjected;

  async function togglePaid(f: Forecast, paid: boolean) {
    const { error } = await supabase
      .from("recurring_forecasts")
      .update({ status: paid ? "paid" : "pending" })
      .eq("id", f.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["recurring_forecasts"] });
  }

  function handleEditClick(f: Forecast) {
    if (f.series_id) setScopeDialog({ kind: "edit", forecast: f });
    else setEditing(f);
  }
  function handleDeleteClick(f: Forecast) {
    if (f.series_id) setScopeDialog({ kind: "delete", forecast: f });
    else void doDelete(f, "single");
  }

  async function doDelete(f: Forecast, scope: "single" | "future") {
    try {
      if (scope === "single") {
        if (f.series_id) {
          // mark this month as skipped on the series so it won't regenerate
          const { data: s } = await supabase
            .from("recurring_series").select("skipped_months").eq("id", f.series_id).single();
          const skipped = Array.from(new Set([...(s?.skipped_months ?? []), f.month]));
          await supabase.from("recurring_series").update({ skipped_months: skipped }).eq("id", f.series_id);
        }
        const { error } = await supabase.from("recurring_forecasts").delete().eq("id", f.id);
        if (error) throw error;
      } else {
        // future: end the series before this month and delete all forecasts >= this month
        if (f.series_id) {
          const prevMonth = addMonths(f.month, -1);
          await supabase.from("recurring_series").update({ end_month: prevMonth }).eq("id", f.series_id);
          const { error } = await supabase
            .from("recurring_forecasts").delete()
            .eq("series_id", f.series_id).gte("month", f.month);
          if (error) throw error;
        }
      }
      toast.success("Despesa removida.");
      qc.invalidateQueries({ queryKey: ["recurring_forecasts"] });
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    }
    setScopeDialog(null);
  }

  if (schoolId === "all") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Fluxo Futuro</h1>
        <Card><CardContent className="p-8 text-center text-muted-foreground">Selecione um colégio específico no topo da página para visualizar o fluxo futuro.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fluxo Futuro</h1>
          <p className="text-sm text-muted-foreground">Checklist manual de contas a pagar de {schoolName}.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[160px] text-center text-sm font-medium capitalize">{monthLabel(month)}</div>
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total de Receitas Previstas</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{sponteAtiva ? fmtBRL(totalReceitasPrevistas) : "—"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total de Despesas Previstas</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-orange-600">{fmtBRL(totalProjected)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Saldo Projetado</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${!sponteAtiva ? "" : saldoProjetado >= 0 ? "text-green-600" : "text-red-600"}`}>{sponteAtiva ? fmtBRL(saldoProjetado) : "—"}</div></CardContent></Card>
      </div>

      {/* ── Receitas Previstas (Sponte) — acima das Despesas ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Receitas Previstas Sponte</CardTitle>
            {sponteAtiva && (
              <Badge variant="secondary" className="gap-1">
                <Building2 className="h-3 w-3" /> {schoolName}
              </Badge>
            )}
          </div>
          {sponteAtiva && (
            <Button size="sm" variant="outline" onClick={() => refetchReceitas()} disabled={receitasLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${receitasLoading ? "animate-spin" : ""}`} />Atualizar
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!sponteAtiva ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Construction className="h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium">Integração Sponte indisponível para {schoolName || "esta unidade"}.</p>
              <p className="text-xs text-muted-foreground">Selecione <strong>CEC</strong>, <strong>CEC Baby</strong> ou <strong>Núcleo Belvedere</strong> no topo para ver as receitas previstas.</p>
            </div>
          ) : receitasErroMsg ? (
            <div className="py-8 text-center text-sm text-red-600">Erro ao consultar o Sponte: {receitasErroMsg}</div>
          ) : receitasLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Consultando receitas no Sponte…</div>
          ) : receitas.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma receita prevista (parcela pendente) de {fmtVenc(recInicio)} a {fmtVenc(recFim)}.
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                Janela {fmtVenc(recInicio)} – {fmtVenc(recFim)} · {receitas.length} boleto(s){receitasData?.meta ? ` · ${receitasData.meta.tempoSegundos}s` : ""}. Desconto de pontualidade aplicado apenas sobre a Mensalidade.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Aluno</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Categoria(s)</TableHead>
                    <TableHead className="text-right">Valor Bruto</TableHead>
                    <TableHead className="text-right">Valor Previsto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receitas.map((r) => (
                    <TableRow key={r.groupKey}>
                      <TableCell className="text-xs">{fmtVenc(r.vencimento)}</TableCell>
                      <TableCell className="font-medium">{r.nomeAluno}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.nomeResponsavel}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.categorias.map((c) => (
                            <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmtBRL(r.valorTotalBoleto)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-green-600">
                        {fmtBRL(r.valorComDesconto)}
                        {r.descontoBolsa > 0 && (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">(-{r.descontoBolsa}%)</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex justify-end border-t pt-3 text-sm font-semibold">
                Total de Receitas Previstas:&nbsp;<span className="text-green-600">{fmtBRL(totalReceitasPrevistas)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Despesas Previstas</CardTitle>
          {isAdmin && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1" />Adicionar Despesa Futura
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {forecasts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma despesa prevista para este mês. Clique em "Adicionar Despesa Futura" para começar.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Subcategoria</TableHead>
                  <TableHead className="text-right">Valor Previsto</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="w-20"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecasts.map((f) => {
                  const cc = f.cost_center_id ? ccMap[f.cost_center_id] : null;
                  const sub = f.sub_cost_center_id ? subCcMap[f.sub_cost_center_id] : null;
                  const paid = f.status === "paid";
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs">{f.due_date ? formatDateBR(f.due_date) : "—"}</TableCell>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {f.description}
                          {f.series_id && <Repeat className="h-3 w-3 text-muted-foreground" aria-label="Despesa fixa" />}
                        </span>
                      </TableCell>
                      <TableCell>
                        {cc ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: cc.color }} />
                            {cc.name}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{sub?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(Number(f.projected_amount))}</TableCell>
                      <TableCell className="max-w-[220px]">
                        {f.notes ? (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate text-xs text-muted-foreground cursor-help">
                                  {f.notes}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs whitespace-pre-wrap">
                                {f.notes}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {isAdmin ? <Switch checked={paid} onCheckedChange={(v) => togglePaid(f, v)} /> : null}
                          {paid
                            ? <Badge className="bg-green-600 hover:bg-green-600">Pago</Badge>
                            : <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100">Pendente</Badge>}
                        </div>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditClick(f)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteClick(f)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <ForecastDialog
          schoolId={schoolId}
          month={month}
          forecast={editing}
          editScope="single"
          costCenters={costCenters}
          subCostCenters={subCostCenters}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { await refetch(); setCreating(false); setEditing(null); }}
        />
      )}

      {/* Scope dialog for fixed-series edit/delete */}
      <Dialog open={!!scopeDialog} onOpenChange={(o) => !o && setScopeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {scopeDialog?.kind === "edit" ? "Editar despesa fixa" : "Excluir despesa fixa"}
            </DialogTitle>
            <DialogDescription>
              "{scopeDialog?.forecast.description}" é uma despesa fixa recorrente.
              Deseja {scopeDialog?.kind === "edit" ? "alterar" : "excluir"} apenas este mês ou todos os meses futuros?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setScopeDialog(null)}>Cancelar</Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!scopeDialog) return;
                if (scopeDialog.kind === "edit") {
                  setEditing(scopeDialog.forecast);
                  setScopeDialog(null);
                } else {
                  void doDelete(scopeDialog.forecast, "single");
                }
              }}
            >Apenas este mês</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!scopeDialog) return;
                if (scopeDialog.kind === "edit") {
                  // Edit all future: open dialog in "future" mode
                  setEditing({ ...scopeDialog.forecast, __scope: "future" } as Forecast & { __scope?: string });
                  setScopeDialog(null);
                } else {
                  void doDelete(scopeDialog.forecast, "future");
                }
              }}
            >Todos os meses futuros</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ForecastDialog({
  schoolId, month, forecast, editScope, costCenters, subCostCenters, onClose, onSaved,
}: {
  schoolId: string;
  month: string;
  forecast: (Forecast & { __scope?: string }) | null;
  editScope: "single";
  costCenters: Array<{ id: string; name: string; color: string }>;
  subCostCenters: Array<{ id: string; name: string; cost_center_id: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!forecast;
  const scope: "single" | "future" = (forecast as any)?.__scope === "future" ? "future" : "single";
  const defaultDue = forecast?.due_date ?? month;
  const [dueDate, setDueDate] = useState(defaultDue);
  const [description, setDescription] = useState(forecast?.description ?? "");
  const [amount, setAmount] = useState<string>(forecast ? String(forecast.projected_amount) : "");
  const [costCenterId, setCostCenterId] = useState<string>(forecast?.cost_center_id ?? "");
  const [subCostCenterId, setSubCostCenterId] = useState<string>(forecast?.sub_cost_center_id ?? "");
  const [notes, setNotes] = useState<string>(forecast?.notes ?? "");
  // "Tipo de Despesa": fixa, nao_fixa ou parcelada
  const [tipo, setTipo] = useState<"fixa" | "nao_fixa" | "parcelada">(forecast?.series_id ? "fixa" : "nao_fixa");
  const [parcelas, setParcelas] = useState<string>("2");
  const [saving, setSaving] = useState(false);

  const subOptions = useMemo(
    () => subCostCenters.filter((s) => s.cost_center_id === costCenterId),
    [subCostCenters, costCenterId],
  );

  async function handleSave() {
    if (!description.trim()) { toast.error("Informe a descrição."); return; }
    const amt = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Informe um valor válido."); return; }
    if (!dueDate) { toast.error("Informe a data de vencimento."); return; }

    setSaving(true);
    try {
      const [y, m, d] = dueDate.split("-").map(Number);
      const monthOfDue = `${y}-${String(m).padStart(2, "0")}-01`;
      const dueDay = d;

      if (isEdit && forecast) {
        if (scope === "future" && forecast.series_id) {
          // Update the series template + all forecasts from this month onward
          await supabase.from("recurring_series").update({
            description: description.trim(),
            projected_amount: amt,
            cost_center_id: costCenterId || null,
            sub_cost_center_id: subCostCenterId || null,
            due_day: dueDay,
            notes: notes.trim() || null,
            updated_at: new Date().toISOString(),
          }).eq("id", forecast.series_id);
          // Fetch affected forecasts and update each due_date according to its own month
          const { data: rows } = await supabase
            .from("recurring_forecasts").select("id, month")
            .eq("series_id", forecast.series_id).gte("month", forecast.month);
          await Promise.all((rows ?? []).map((r: any) =>
            supabase.from("recurring_forecasts").update({
              description: description.trim(),
              projected_amount: amt,
              cost_center_id: costCenterId || null,
              sub_cost_center_id: subCostCenterId || null,
              due_date: dueDateFor(r.month, dueDay),
              notes: notes.trim() || null,
            }).eq("id", r.id),
          ));
          toast.success("Série atualizada para este mês e seguintes.");
        } else {
          // Single edit: if changing from fixa→não fixa, detach from series for this row only
          const patch: any = {
            description: description.trim(),
            projected_amount: amt,
            cost_center_id: costCenterId || null,
            sub_cost_center_id: subCostCenterId || null,
            due_date: dueDate,
            month: monthOfDue,
            notes: notes.trim() || null,
          };
          if (forecast.series_id && tipo === "nao_fixa") patch.series_id = null;
          const { error } = await supabase.from("recurring_forecasts").update(patch).eq("id", forecast.id);
          if (error) throw error;
          toast.success("Despesa atualizada.");
        }
      } else {
        // Create new
        if (tipo === "fixa" || tipo === "parcelada") {
          const nParc = tipo === "parcelada" ? Math.floor(Number(parcelas)) : 0;
          if (tipo === "parcelada" && (!Number.isFinite(nParc) || nParc < 1)) {
            toast.error("Informe a quantidade de parcelas (mínimo 1).");
            setSaving(false);
            return;
          }
          const endMonth = tipo === "parcelada" ? addMonths(monthOfDue, nParc - 1) : null;
          // Create series template
          const { data: series, error: sErr } = await supabase.from("recurring_series").insert({
            school_id: schoolId,
            description: description.trim(),
            projected_amount: amt,
            cost_center_id: costCenterId || null,
            sub_cost_center_id: subCostCenterId || null,
            due_day: dueDay,
            start_month: monthOfDue,
            end_month: endMonth,
            notes: notes.trim() || null,
          }).select("id").single();
          if (sErr) throw sErr;

          if (tipo === "parcelada") {
            // Generate all N forecast rows upfront with "(Parcela i/N)" suffix
            const rows = Array.from({ length: nParc }, (_, i) => {
              const mIso = addMonths(monthOfDue, i);
              return {
                school_id: schoolId,
                month: mIso,
                due_date: dueDateFor(mIso, dueDay),
                description: `${description.trim()} (Parcela ${i + 1}/${nParc})`,
                projected_amount: amt,
                cost_center_id: costCenterId || null,
                sub_cost_center_id: subCostCenterId || null,
                status: "pending",
                series_id: series!.id,
                normalized_key: `series:${series!.id}:${mIso}`,
                notes: notes.trim() || null,
              };
            });
            const { error } = await supabase.from("recurring_forecasts").insert(rows);
            if (error) throw error;
            toast.success(`Despesa parcelada criada — ${nParc} parcelas geradas.`);
          } else {
            const { error } = await supabase.from("recurring_forecasts").insert({
              school_id: schoolId,
              month: monthOfDue,
              due_date: dueDate,
              description: description.trim(),
              projected_amount: amt,
              cost_center_id: costCenterId || null,
              sub_cost_center_id: subCostCenterId || null,
              status: "pending",
              series_id: series!.id,
              normalized_key: `series:${series!.id}:${monthOfDue}`,
              notes: notes.trim() || null,
            });
            if (error) throw error;
            toast.success("Despesa fixa criada — será replicada nos próximos meses.");
          }
        } else {
          const { error } = await supabase.from("recurring_forecasts").insert({
            school_id: schoolId,
            month: monthOfDue,
            due_date: dueDate,
            description: description.trim(),
            projected_amount: amt,
            cost_center_id: costCenterId || null,
            sub_cost_center_id: subCostCenterId || null,
            status: "pending",
            normalized_key: `manual:${crypto.randomUUID()}`,
            notes: notes.trim() || null,
          });
          if (error) throw error;
          toast.success("Despesa adicionada.");
        }
      }
      onSaved();
    } catch (e) {
      toast.error("Erro ao salvar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? (scope === "future" ? "Editar este mês e seguintes" : "Editar despesa")
              : "Adicionar despesa futura"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tipo de Despesa</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as "fixa" | "nao_fixa" | "parcelada")}
              disabled={isEdit}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nao_fixa">Não Fixa (apenas neste mês)</SelectItem>
                <SelectItem value="fixa">Fixa (repete todos os meses)</SelectItem>
                <SelectItem value="parcelada">Fixa por Período / Parcelada</SelectItem>
              </SelectContent>
            </Select>
            {isEdit && forecast?.series_id && (
              <p className="text-xs text-muted-foreground mt-1">
                Esta despesa faz parte de uma série fixa. Para mudar o tipo, exclua e cadastre novamente.
              </p>
            )}
          </div>
          {!isEdit && tipo === "parcelada" && (
            <div>
              <Label>Quantidade de Meses / Parcelas</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
                placeholder="Ex: 6, 12, 24"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Serão gerados {Math.max(1, Math.floor(Number(parcelas) || 0))} lançamentos mensais a partir da data de vencimento.
              </p>
            </div>
          )}
          <div>
            <Label>Data de Vencimento</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {(tipo === "fixa" || tipo === "parcelada") && (
              <p className="text-xs text-muted-foreground mt-1">
                O dia do vencimento ({Number(dueDate.split("-")[2] || 0)}) será replicado nos próximos meses{tipo === "parcelada" ? ` (${Math.max(1, Math.floor(Number(parcelas) || 0))} parcelas no total)` : ""}.
              </p>
            )}
          </div>
          <div>
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Aluguel, Conta de Luz, Ação Trabalhista..." />
            {!isEdit && tipo === "parcelada" && description.trim() && (
              <p className="text-xs text-muted-foreground mt-1">
                Será exibido como: "{description.trim()} (Parcela 1/{Math.max(1, Math.floor(Number(parcelas) || 0))})"
              </p>
            )}
          </div>
          <div>
            <Label>Valor Previsto (R$)</Label>
            <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={costCenterId} onValueChange={(v) => { setCostCenterId(v); setSubCostCenterId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione uma categoria" /></SelectTrigger>
              <SelectContent>
                {[...costCenters].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {costCenterId && subOptions.length > 0 && (
            <div>
              <Label>Subcategoria</Label>
              <Select value={subCostCenterId} onValueChange={setSubCostCenterId}>
                <SelectTrigger><SelectValue placeholder="Selecione uma subcategoria (opcional)" /></SelectTrigger>
                <SelectContent>
                  {[...subOptions].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Observação (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Cópia de chaves com chaveiro para o Bloco B"
              rows={3}
              maxLength={1000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
