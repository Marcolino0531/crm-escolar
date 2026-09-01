import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, DollarSign, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useSchool, usePermissions } from "@/lib/app-context";
import { escolaAtivaId, unidadeAtiva } from "@/lib/unidade-global";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  rentabilidadeRealPct,
  somarPatrimonioPorCompetencia,
  formatMovimentacaoBRL,
} from "@/lib/fundos";

export const Route = createFileRoute("/fundos")({
  component: FundosGate,
});

function FundosGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro_fundos"))
    return (
      <AccessDenied message="Você não tem permissão para visualizar os Fundos de Investimento." />
    );
  return <FundosPage />;
}

// ---- Types ----
type Fund = {
  id: string;
  school_id: string;
  name: string;
  destination: string;
  created_at: string;
};

type FundEntry = {
  id: string;
  fund_id: string;
  competencia: string;
  valor_liquido: number;
  aportes: number;
  resgates: number;
  created_at: string;
};

// ---- Helpers ----
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

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

// ---- Page ----
function FundosPage() {
  const { selected: schoolId, schools, schoolFilterIds } = useSchool();
  const { canEdit } = usePermissions();
  const editable = canEdit("financeiro_fundos");
  const qc = useQueryClient();
  const today = new Date();
  const [month, setMonth] = useState(() => monthKey(today));

  // --- Dialogs ---
  const [showCreate, setShowCreate] = useState(false);
  const [editFund, setEditFund] = useState<Fund | null>(null);
  const [entryFund, setEntryFund] = useState<Fund | null>(null);

  // --- Queries ---
  const { data: funds = [], isLoading: loadingFunds } = useQuery({
    queryKey: ["provision_funds", schoolId, schoolFilterIds],
    queryFn: async () => {
      let q = supabase
        .from("provision_funds" as any)
        .select("*")
        .order("name");
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Fund[];
    },
  });

  const fundIds = funds.map((f) => f.id);
  const { data: entries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ["provision_fund_entries", fundIds.join(",")],
    enabled: fundIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provision_fund_entries" as any)
        .select("*")
        .in("fund_id", fundIds)
        .order("competencia", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as FundEntry[];
    },
  });

  // ---- Computed data ----
  const prevMonth = addMonths(month, -1);

  // Per-fund: current month value + previous month + variation
  const fundStats = useMemo(() => {
    return funds.map((f) => {
      const current = entries.find((e) => e.fund_id === f.id && e.competencia === month);
      const prev = entries.find((e) => e.fund_id === f.id && e.competencia === prevMonth);
      const valorAtual = current ? Number(current.valor_liquido) : null;
      const valorAnterior = prev ? Number(prev.valor_liquido) : null;
      // Rentabilidade real: desconta aportes/resgates do período (gravados no
      // lançamento do mês corrente) para não confundir movimentação de caixa
      // com ganho/perda do fundo.
      const aportes = current ? Number(current.aportes) : 0;
      const resgates = current ? Number(current.resgates) : 0;
      const variacao = rentabilidadeRealPct({
        valorAtual,
        valorAnterior,
        aportes,
        resgates,
      });
      return { fund: f, valorAtual, valorAnterior, aportes, resgates, variacao };
    });
  }, [funds, entries, month, prevMonth]);

  // Chart data: total patrimônio per month (sum across funds per competencia)
  const chartData = useMemo(() => {
    const byMonth = somarPatrimonioPorCompetencia(entries);
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([comp, total]) => ({ month: monthLabel(comp), total }));
  }, [entries]);

  // Per-fund chart lines
  const perFundChartData = useMemo(() => {
    const monthsSet = new Set<string>();
    for (const e of entries) monthsSet.add(e.competencia);
    const months = [...monthsSet].sort();
    return months.map((m) => {
      const point: Record<string, number | string> = { month: monthLabel(m) };
      for (const f of funds) {
        const e = entries.find((x) => x.fund_id === f.id && x.competencia === m);
        point[f.name] = e ? Number(e.valor_liquido) : 0;
      }
      return point;
    });
  }, [entries, funds]);

  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "";

  // ---- Mutations ----
  const createFund = useMutation({
    mutationFn: async (payload: { name: string; destination: string; school_id: string }) => {
      const { error } = await supabase.from("provision_funds" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provision_funds"] });
      toast.success("Fundo criado com sucesso.");
      setShowCreate(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar fundo."),
  });

  const updateFund = useMutation({
    mutationFn: async (payload: { id: string; name: string; destination: string }) => {
      const { id, ...rest } = payload;
      const { error } = await supabase
        .from("provision_funds" as any)
        .update(rest)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provision_funds"] });
      toast.success("Fundo atualizado.");
      setEditFund(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar fundo."),
  });

  const deleteFund = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("provision_funds" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provision_funds"] });
      qc.invalidateQueries({ queryKey: ["provision_fund_entries"] });
      toast.success("Fundo excluído.");
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir fundo."),
  });

  const upsertEntry = useMutation({
    mutationFn: async (payload: {
      fund_id: string;
      competencia: string;
      valor_liquido: number;
      aportes: number;
      resgates: number;
    }) => {
      const { error } = await supabase
        .from("provision_fund_entries" as any)
        .upsert(payload, { onConflict: "fund_id,competencia" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provision_fund_entries"] });
      toast.success("Lançamento salvo.");
      setEntryFund(null);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar lançamento."),
  });

  // ---- Render ----
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fundos de Investimento</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe a evolução patrimonial dos fundos investidos por colégio.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Novo Fundo
          </Button>
        )}
      </div>

      {/* Month selector */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[170px] text-center text-sm font-medium capitalize">
          {monthLabel(month)}
        </span>
        <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acompanhamento Mensal</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingFunds || loadingEntries ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : funds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum fundo cadastrado. Clique em "Novo Fundo" para começar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fundo</TableHead>
                  <TableHead>Destino</TableHead>
                  {schoolId === "all" && <TableHead>Colégio</TableHead>}
                  <TableHead className="text-right">Mês Atual</TableHead>
                  <TableHead className="text-right">Mês Anterior</TableHead>
                  <TableHead className="text-right">Aporte do período</TableHead>
                  <TableHead className="text-right">Resgate do período</TableHead>
                  <TableHead
                    className="text-right"
                    title="Rentabilidade real do período (desconta aportes e resgates)"
                  >
                    Variação
                  </TableHead>
                  {editable && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fundStats.map(
                  ({ fund, valorAtual, valorAnterior, aportes, resgates, variacao }) => (
                    <TableRow key={fund.id}>
                      <TableCell className="font-medium">{fund.name}</TableCell>
                      <TableCell>{fund.destination}</TableCell>
                      {schoolId === "all" && (
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {schoolName(fund.school_id)}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        {valorAtual != null ? fmtBRL(valorAtual) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {valorAnterior != null ? fmtBRL(valorAnterior) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMovimentacaoBRL(aportes)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMovimentacaoBRL(resgates)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {variacao != null ? (
                          <span className={variacao >= 0 ? "text-emerald-600" : "text-red-600"}>
                            {variacao >= 0 ? "+" : ""}
                            {variacao.toFixed(2)}%
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {editable && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Lançamento mensal"
                              onClick={() => setEntryFund(fund)}
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Editar fundo"
                              onClick={() => setEditFund(fund)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Excluir fundo"
                              onClick={() => {
                                if (confirm(`Excluir o fundo "${fund.name}"?`))
                                  deleteFund.mutate(fund.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolução do Patrimônio</CardTitle>
          </CardHeader>
          <CardContent className="h-[340px]">
            {funds.length <= 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                  />
                  <ReTooltip
                    formatter={(v: number) => fmtBRL(v)}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={perFundChartData}
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
                  <ReTooltip
                    formatter={(v: number) => fmtBRL(v)}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  {funds.map((f, i) => (
                    <Line
                      key={f.id}
                      type="monotone"
                      dataKey={f.name}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Fund Dialog */}
      <CreateFundDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSave={(p) => createFund.mutate(p)}
        saving={createFund.isPending}
        schoolId={schoolId}
        schools={schools}
      />

      {/* Edit Fund Dialog */}
      {editFund && (
        <EditFundDialog
          fund={editFund}
          open
          onClose={() => setEditFund(null)}
          onSave={(p) => updateFund.mutate(p)}
          saving={updateFund.isPending}
        />
      )}

      {/* Entry Dialog */}
      {entryFund && (
        <EntryDialog
          fund={entryFund}
          entries={entries.filter((e) => e.fund_id === entryFund.id)}
          open
          onClose={() => setEntryFund(null)}
          onSave={(p) => upsertEntry.mutate(p)}
          saving={upsertEntry.isPending}
          currentMonth={month}
        />
      )}
    </div>
  );
}

// ---- Dialogs ----

function CreateFundDialog({
  open,
  onClose,
  onSave,
  saving,
  schoolId,
  schools,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: { name: string; destination: string; school_id: string }) => void;
  saving: boolean;
  schoolId: string;
  schools: { id: string; name: string }[];
}) {
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  // Colégio do fundo: sempre o do seletor global do topo.
  const escolaId = escolaAtivaId(schoolId, schools) ?? "";
  const escolaNome = unidadeAtiva(schoolId, schools) ?? "";

  const reset = () => {
    setName("");
    setDestination("");
  };

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
          <DialogTitle>Novo Fundo</DialogTitle>
        </DialogHeader>
        {!escolaId ? (
          <SelecioneUnidade acao="A criação de um novo fundo" />
        ) : (
          <div className="space-y-4">
            <div>
              <Label>Nome do Fundo</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Reserva Estratégica"
              />
            </div>
            <div>
              <Label>Destino do Investimento</Label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ex.: 13º Salário, Férias"
              />
            </div>
            <div>
              <Label>Colégio</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {escolaNome}
              </div>
            </div>
          </div>
        )}
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
            disabled={saving || !name.trim() || !destination.trim() || !escolaId}
            onClick={() => {
              onSave({
                name: name.trim(),
                destination: destination.trim(),
                school_id: escolaId,
              });
              reset();
            }}
          >
            {saving ? "Salvando…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditFundDialog({
  fund,
  open,
  onClose,
  onSave,
  saving,
}: {
  fund: Fund;
  open: boolean;
  onClose: () => void;
  onSave: (p: { id: string; name: string; destination: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(fund.name);
  const [destination, setDestination] = useState(fund.destination);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Fundo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome do Fundo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Destino do Investimento</Label>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={saving || !name.trim() || !destination.trim()}
            onClick={() =>
              onSave({ id: fund.id, name: name.trim(), destination: destination.trim() })
            }
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryDialog({
  fund,
  entries,
  open,
  onClose,
  onSave,
  saving,
  currentMonth,
}: {
  fund: Fund;
  entries: FundEntry[];
  open: boolean;
  onClose: () => void;
  onSave: (p: {
    fund_id: string;
    competencia: string;
    valor_liquido: number;
    aportes: number;
    resgates: number;
  }) => void;
  saving: boolean;
  currentMonth: string;
}) {
  const [comp, setComp] = useState(() => currentMonth.slice(0, 7)); // YYYY-MM
  const existing = entries.find((e) => e.competencia === comp + "-01");
  const [valor, setValor] = useState(existing ? String(existing.valor_liquido) : "");
  const [aportes, setAportes] = useState(existing ? String(existing.aportes) : "");
  const [resgates, setResgates] = useState(existing ? String(existing.resgates) : "");

  // Update fields when competencia changes and entry exists
  const handleCompChange = (v: string) => {
    setComp(v);
    const e = entries.find((x) => x.competencia === v + "-01");
    setValor(e ? String(e.valor_liquido) : "");
    setAportes(e ? String(e.aportes) : "");
    setResgates(e ? String(e.resgates) : "");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Lançamento Mensal — {fund.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Competência (mês)</Label>
            <Input type="month" value={comp} onChange={(e) => handleCompChange(e.target.value)} />
          </div>
          <div>
            <Label>Valor Líquido Atualizado (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Aportes do período (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={aportes}
                onChange={(e) => setAportes(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div>
              <Label>Resgates do período (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={resgates}
                onChange={(e) => setResgates(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Aportes e resgates são descontados no cálculo da rentabilidade do mês. Deixe em branco
            (ou 0) se não houve movimentação.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              saving ||
              !comp ||
              !valor ||
              isNaN(Number(valor)) ||
              (aportes !== "" && isNaN(Number(aportes))) ||
              (resgates !== "" && isNaN(Number(resgates)))
            }
            onClick={() =>
              onSave({
                fund_id: fund.id,
                competencia: comp + "-01",
                valor_liquido: Number(valor),
                aportes: aportes === "" ? 0 : Number(aportes),
                resgates: resgates === "" ? 0 : Number(resgates),
              })
            }
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
