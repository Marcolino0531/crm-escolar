import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Building2,
  Trash2,
  Plus,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { parseCSV, parseExcel, extractTransactions, type ParsedTx } from "@/lib/csv";
import { autoReconcileSubcategorized, autoBaixaForecastsPorExtrato } from "@/lib/auto-reconcile";
import { formatDateBR, todayISOLocal } from "@/lib/date-utils";
import { useSchool, usePermissions } from "@/lib/app-context";
import { escolaAtivaId } from "@/lib/unidade-global";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { AccessDenied } from "@/components/AccessDenied";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Importar Extrato — School Hub" },
      {
        name: "description",
        content: "Faça upload de um CSV do extrato bancário e categorize por centro de custo.",
      },
    ],
  }),
  component: UploadPage,
});

type Pending = ParsedTx & {
  id: string;
  costCenterId: string | null;
  subCostCenterId: string | null;
  revenueCategoryId: string | null;
  revenueSubcategoryId: string | null;
  guessed: boolean;
  duplicate: boolean;
  dismissedDup: boolean;
  manual: boolean;
  notes: string;
};

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dupKey(date: string, amount: number, description: string) {
  return `${date}|${amount.toFixed(2)}|${description.trim().toLowerCase()}`;
}

function UploadPage() {
  const { canView, canEdit, loading: roleLoading } = usePermissions();
  const podeEditar = canEdit("financeiro_upload");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { schools, selected } = useSchool();
  // Colégio do extrato: sempre o do seletor global do topo.
  const schoolId = escolaAtivaId(selected, schools) ?? "";
  if (roleLoading) return null;
  if (!canView("financeiro_upload"))
    return <AccessDenied message="Você não tem permissão para Importar Extrato." />;
  const [rows, setRows] = useState<Pending[]>([]);
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  // Troca de unidade no topo descarta a prévia lida para o colégio anterior.
  useEffect(() => {
    setRows([]);
    setFileName(null);
  }, [schoolId]);

  const { data: refs } = useQuery({
    queryKey: ["refs"],
    queryFn: async () => {
      const [cc, sub, rules, revCat, revSub] = await Promise.all([
        supabase.from("cost_centers").select("*").order("name"),
        supabase.from("sub_cost_centers").select("*").order("name"),
        selectAll<Tables<"categorization_rules">>(() =>
          supabase.from("categorization_rules").select("*").order("id", { ascending: true }),
        ),
        supabase.from("revenue_categories").select("*").order("name"),
        supabase.from("revenue_subcategories").select("*").order("name"),
      ]);
      if (cc.error) throw cc.error;
      if (sub.error) throw sub.error;
      if (revCat.error) throw revCat.error;
      if (revSub.error) throw revSub.error;
      return {
        costCenters: cc.data,
        subCostCenters: sub.data,
        rules,
        revenueCategories: revCat.data,
        revenueSubcategories: revSub.data,
      };
    },
  });

  const ccs = refs?.costCenters ?? [];
  const subs = refs?.subCostCenters ?? [];
  const rules = refs?.rules ?? [];
  const revCats = refs?.revenueCategories ?? [];
  const revSubs = refs?.revenueSubcategories ?? [];

  function guess(
    desc: string,
    type: "entrada" | "saida",
    amount?: number,
  ): {
    costCenterId: string | null;
    subCostCenterId: string | null;
    revenueCategoryId: string | null;
    revenueSubcategoryId: string | null;
    matched: boolean;
  } {
    const d = desc.toLowerCase();
    // Strict sign-based kind: positive => revenue, negative => expense.
    // Falls back to `type` if amount is unknown/zero.
    let wantedKind: "revenue" | "expense";
    if (typeof amount === "number" && amount !== 0) {
      wantedKind = amount > 0 ? "revenue" : "expense";
    } else {
      wantedKind = type === "entrada" ? "revenue" : "expense";
    }
    for (const r of rules as any[]) {
      const rKind = r.kind ?? "expense";
      if (rKind !== wantedKind) continue;
      if (!d.includes(String(r.keyword).toLowerCase())) continue;
      if (rKind === "revenue") {
        return {
          costCenterId: null,
          subCostCenterId: null,
          revenueCategoryId: r.revenue_category_id ?? null,
          revenueSubcategoryId: r.revenue_subcategory_id ?? null,
          matched: !!r.revenue_category_id,
        };
      }
      return {
        costCenterId: r.cost_center_id ?? null,
        subCostCenterId: r.sub_cost_center_id ?? null,
        revenueCategoryId: null,
        revenueSubcategoryId: null,
        matched: !!r.cost_center_id,
      };
    }
    return {
      costCenterId: null,
      subCostCenterId: null,
      revenueCategoryId: null,
      revenueSubcategoryId: null,
      matched: false,
    };
  }

  async function handleFile(file: File) {
    if (!schoolId) {
      toast.error("Selecione uma unidade específica no seletor do topo para importar o extrato.");
      return;
    }
    setFileName(file.name);
    const lower = file.name.toLowerCase();
    const isExcel =
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls") ||
      file.type === "application/vnd.ms-excel" ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    let rowsRaw: string[][];
    try {
      if (isExcel) {
        rowsRaw = parseExcel(await file.arrayBuffer());
      } else {
        rowsRaw = parseCSV(await file.text());
      }
    } catch (e) {
      toast.error(`Não foi possível ler o arquivo: ${(e as Error).message}`);
      return;
    }
    let parsed: ParsedTx[];
    try {
      parsed = extractTransactions(rowsRaw);
    } catch (e) {
      toast.error(`Falha ao interpretar as transações: ${(e as Error).message}`);
      return;
    }
    if (parsed.length === 0) {
      toast.error(
        "Nenhuma transação encontrada. Envie um extrato da Caixa (Data, Histórico, Valor) ou do Itaú (Data, Lançamento, Valor (R$)).",
      );
      return;
    }

    // Fetch existing transactions in same date range for this school to detect duplicates
    const dates = parsed.map((p) => p.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const existing = await selectAll<
      Pick<Tables<"transactions">, "date" | "amount" | "description">
    >(() =>
      supabase
        .from("transactions")
        .select("date, amount, description")
        .eq("school_id", schoolId)
        .gte("date", minDate)
        .lte("date", maxDate)
        .order("id", { ascending: true }),
    );
    const existingSet = new Set(
      existing.map((t) => dupKey(t.date, Number(t.amount), t.description)),
    );

    const pending: Pending[] = parsed.map((t, i) => {
      const g = guess(t.description, t.type, t.type === "entrada" ? t.amount : -t.amount);
      return {
        ...t,
        id: `${i}-${t.date}-${t.description}`,
        costCenterId: g.costCenterId,
        subCostCenterId: g.subCostCenterId,
        revenueCategoryId: g.revenueCategoryId,
        revenueSubcategoryId: g.revenueSubcategoryId,
        guessed: g.matched,
        duplicate: existingSet.has(dupKey(t.date, t.amount, t.description)),
        dismissedDup: false,
        manual: false,
        notes: "",
      };
    });
    setRows(pending);
    const matched = pending.filter((p) => p.guessed).length;
    const dups = pending.filter((p) => p.duplicate).length;
    toast.success(
      `${parsed.length} transações lidas. ${matched} categorizadas. ${dups > 0 ? `${dups} possível(eis) duplicata(s).` : ""}`,
    );
  }

  function patch(id: string, fields: Partial<Pending>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addManualRow() {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const today = todayISOLocal();
    setRows((prev) => [
      ...prev,
      {
        id,
        date: today,
        description: "",
        amount: 0,
        type: "saida",
        costCenterId: null,
        subCostCenterId: null,
        revenueCategoryId: null,
        revenueSubcategoryId: null,
        guessed: false,
        duplicate: false,
        dismissedDup: false,
        manual: true,
        notes: "",
      },
    ]);
  }

  async function save() {
    if (!schoolId) {
      toast.error("Selecione uma unidade específica no seletor do topo.");
      return;
    }
    const blockedDup = rows.filter((r) => r.duplicate && !r.dismissedDup);
    if (blockedDup.length > 0) {
      toast.error(
        `${blockedDup.length} possível(eis) duplicata(s). Confirme "Manter" ou exclua a linha.`,
      );
      return;
    }
    const invalid = rows.filter((r) => r.manual && (!r.description.trim() || r.amount <= 0));
    if (invalid.length > 0) {
      toast.error(`${invalid.length} linha(s) manual(is) sem descrição ou valor válido.`);
      return;
    }
    // Transações sem categoria são permitidas (fluxo assíncrono): entram no
    // banco com category/subcategory nulos e ficam destacadas como "Definir"
    // no Extrato para categorização posterior.
    setSaving(true);
    const payload = rows.map((r) => ({
      date: r.date,
      description: r.description,
      amount: r.amount,
      type: r.type,
      cost_center_id: r.type === "entrada" ? null : r.costCenterId,
      sub_cost_center_id: r.type === "entrada" ? null : r.subCostCenterId,
      revenue_category_id: r.type === "entrada" ? r.revenueCategoryId : null,
      revenue_subcategory_id: r.type === "entrada" ? r.revenueSubcategoryId : null,
      school_id: schoolId,
      notes: r.notes.trim() || null,
    }));
    const { data: inserted, error } = await supabase
      .from("transactions")
      .insert(payload)
      .select("id, type, amount, revenue_category_id, revenue_subcategory_id");
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }

    // Conciliação automática: transações de receita já subcategorizadas na
    // importação (valor total = uma única subcategoria) entram como "Conciliadas",
    // sem exigir desmembramento manual na tela de Conciliação de Faturamento.
    let autoConc = 0;
    try {
      const entradasSub = (inserted ?? []).filter(
        (t) => t.type === "entrada" && !!t.revenue_subcategory_id,
      );
      autoConc = await autoReconcileSubcategorized(entradasSub, revSubs, schoolId);
    } catch (e) {
      console.error("[UPLOAD] Falha na conciliação automática por subcategoria:", e);
    }

    // Conciliação bancária automática (Fluxo Futuro × Extrato): para cada SAÍDA,
    // dá baixa em uma previsão de despesa com a mesma data de vencimento e valor.
    let autoBaixa = 0;
    try {
      const saidas = rows
        .filter((r) => r.type === "saida")
        .map((r) => ({ date: r.date, amount: r.amount }));
      autoBaixa = await autoBaixaForecastsPorExtrato(saidas, schoolId);
    } catch (e) {
      console.error("[UPLOAD] Falha na baixa automática do Fluxo Futuro:", e);
    }
    setSaving(false);
    const semCategoria = rows.filter((r) => !isCategorized(r)).length;
    toast.success(
      `${payload.length} transações salvas!` +
        (autoConc > 0 ? ` ${autoConc} já conciliada(s) por subcategoria.` : "") +
        (autoBaixa > 0
          ? ` ${autoBaixa} despesa(s) do Fluxo Futuro baixada(s) automaticamente.`
          : "") +
        (semCategoria > 0 ? ` ${semCategoria} sem categoria — defina no Extrato.` : ""),
    );
    qc.invalidateQueries({ queryKey: ["recurring_forecasts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["conc-recs"] });
    qc.invalidateQueries({ queryKey: ["conc-txs"] });
    navigate({ to: "/extrato-bancario" });
  }

  function isCategorized(r: Pending) {
    return r.type === "entrada" ? !!r.revenueCategoryId : !!r.costCenterId;
  }

  const matched = rows.filter((r) => r.guessed && isCategorized(r)).length;
  const missing = rows.filter((r) => !isCategorized(r)).length;
  const pendingDups = rows.filter((r) => r.duplicate && !r.dismissedDup).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Importar Extrato</h1>
        <p className="text-sm text-muted-foreground">
          O extrato entra no colégio selecionado no topo da tela; envie o CSV e revise a
          categorização.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="max-w-md space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm">
              <Building2 className="h-4 w-4" /> Colégio
            </Label>
            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              {schools.find((s) => s.id === schoolId)?.name ?? "Selecione no topo da tela"}
            </div>
          </div>

          {!schoolId && <SelecioneUnidade acao="A importação do extrato bancário" />}

          {podeEditar && (
            <label
              className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/40 px-6 py-12 text-center transition-colors ${schoolId ? "cursor-pointer hover:bg-secondary" : "cursor-not-allowed opacity-60"}`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Upload className="h-6 w-6" />
              </div>
              <div>
                <div className="font-medium">
                  {fileName ?? "Clique para selecionar um arquivo CSV ou Excel"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {schoolId
                    ? "Formatos aceitos: .csv, .xlsx, .xls — Extratos da Caixa e do Itaú são detectados automaticamente pelas colunas"
                    : "Selecione uma unidade específica no topo primeiro"}
                </div>
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                disabled={!schoolId}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          )}
        </CardContent>
      </Card>

      {(rows.length > 0 || schoolId) && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Pré-visualização ({rows.length}){" "}
                {schoolId && `— ${schools.find((s) => s.id === schoolId)?.name}`}
              </CardTitle>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {matched} categorizadas
                </span>
                <span className="inline-flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" /> {missing} a definir (pode
                  salvar)
                </span>
                {pendingDups > 0 && (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> {pendingDups} possível(eis)
                    duplicata(s)
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CategoryManagerDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="h-4 w-4" /> Categorias
                  </Button>
                }
              />
              {rows.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRows([]);
                      setFileName(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={save} disabled={saving || pendingDups > 0}>
                    {saving ? "Salvando…" : `Salvar ${rows.length} Transações`}
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Data</th>
                    <th className="py-2 pr-3">Descrição</th>
                    <th className="py-2 pr-3 text-right">Valor</th>
                    <th className="py-2 pr-3">Categoria</th>
                    <th className="py-2 pr-3">Subcategoria</th>
                    <th className="py-2 pr-3">Observação</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isEntry = r.type === "entrada";
                    const ok = isCategorized(r);
                    const auto = r.guessed && ok && !isEntry;
                    const isDup = r.duplicate && !r.dismissedDup;
                    const rowBg = isDup
                      ? "bg-warning/10"
                      : ok
                        ? "bg-success/5"
                        : "bg-destructive/5";
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-border/50 transition-colors ${rowBg}`}
                      >
                        <td className="py-2 pr-3">
                          {isDup ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                                <AlertTriangle className="h-3 w-3" /> Duplicata?
                              </span>
                              <button
                                onClick={() => patch(r.id, { dismissedDup: true })}
                                className="text-[10px] underline text-muted-foreground hover:text-foreground"
                              >
                                Estou ciente, manter
                              </button>
                            </div>
                          ) : r.manual ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent/30 px-2 py-0.5 text-xs font-medium">
                              Manual
                            </span>
                          ) : auto ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                              <CheckCircle2 className="h-3 w-3" /> Auto
                            </span>
                          ) : ok ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              <CheckCircle2 className="h-3 w-3" /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                              <AlertCircle className="h-3 w-3" /> Definir
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {r.manual ? (
                            <Input
                              type="date"
                              value={r.date}
                              onChange={(e) => patch(r.id, { date: e.target.value })}
                              className="h-8 w-36"
                            />
                          ) : (
                            formatDateBR(r.date)
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {r.manual ? (
                            <Input
                              value={r.description}
                              onChange={(e) => patch(r.id, { description: e.target.value })}
                              placeholder="Descrição…"
                              className="h-8 min-w-[200px]"
                            />
                          ) : (
                            r.description
                          )}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-medium ${isEntry ? "text-success" : "text-foreground"}`}
                        >
                          {r.manual ? (
                            <div className="flex items-center gap-1 justify-end">
                              <Select
                                value={r.type}
                                onValueChange={(v: "entrada" | "saida") =>
                                  patch(r.id, {
                                    type: v,
                                    costCenterId: null,
                                    subCostCenterId: null,
                                    revenueCategoryId: null,
                                    revenueSubcategoryId: null,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[90px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="entrada">Entrada</SelectItem>
                                  <SelectItem value="saida">Saída</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={r.amount || ""}
                                onChange={(e) =>
                                  patch(r.id, { amount: parseFloat(e.target.value) || 0 })
                                }
                                className="h-8 w-24 text-right"
                              />
                            </div>
                          ) : (
                            `${isEntry ? "+" : "-"}${formatBRL(r.amount)}`
                          )}
                        </td>
                        <td className="py-2 pr-3 min-w-[200px]">
                          {isEntry ? (
                            <Select
                              value={r.revenueCategoryId ?? undefined}
                              onValueChange={(v) =>
                                patch(r.id, { revenueCategoryId: v, revenueSubcategoryId: null })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue
                                  placeholder={
                                    revCats.length === 0
                                      ? "Cadastre categorias…"
                                      : "Categoria de receita…"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {[...revCats]
                                  .sort((a: any, b: any) => a.name.localeCompare(b.name))
                                  .map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      <span className="inline-flex items-center gap-2">
                                        <span
                                          className="h-2 w-2 rounded-full"
                                          style={{ background: (c as any).color ?? "#10b981" }}
                                        />
                                        {c.name}
                                      </span>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select
                              value={r.costCenterId ?? undefined}
                              onValueChange={(v) =>
                                patch(r.id, { costCenterId: v, subCostCenterId: null })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Selecionar…" />
                              </SelectTrigger>
                              <SelectContent>
                                {[...ccs]
                                  .sort((a: any, b: any) => a.name.localeCompare(b.name))
                                  .map((cc) => (
                                    <SelectItem key={cc.id} value={cc.id}>
                                      <span className="inline-flex items-center gap-2">
                                        <span
                                          className="h-2 w-2 rounded-full"
                                          style={{ background: cc.color }}
                                        />
                                        {cc.name}
                                      </span>
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="py-2 pr-3 min-w-[180px]">
                          {isEntry
                            ? (() => {
                                const filtered = revSubs
                                  .filter((s) => s.revenue_category_id === r.revenueCategoryId)
                                  .sort((a: any, b: any) => a.name.localeCompare(b.name));
                                return (
                                  <Select
                                    value={r.revenueSubcategoryId ?? undefined}
                                    onValueChange={(v) =>
                                      patch(r.id, { revenueSubcategoryId: v || null })
                                    }
                                    disabled={!r.revenueCategoryId || filtered.length === 0}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue
                                        placeholder={
                                          !r.revenueCategoryId
                                            ? "—"
                                            : filtered.length === 0
                                              ? "Sem subcategorias"
                                              : "Opcional…"
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {filtered.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                          {s.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()
                            : (() => {
                                const filtered = subs
                                  .filter((s) => s.cost_center_id === r.costCenterId)
                                  .sort((a: any, b: any) => a.name.localeCompare(b.name));
                                return (
                                  <Select
                                    value={r.subCostCenterId ?? undefined}
                                    onValueChange={(v) =>
                                      patch(r.id, { subCostCenterId: v || null })
                                    }
                                    disabled={!r.costCenterId || filtered.length === 0}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue
                                        placeholder={
                                          !r.costCenterId
                                            ? "—"
                                            : filtered.length === 0
                                              ? "Sem subcentros"
                                              : "Opcional…"
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {filtered.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                          {s.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()}
                        </td>
                        <td className="py-2 pr-3 min-w-[180px]">
                          <Input
                            value={r.notes}
                            onChange={(e) => patch(r.id, { notes: e.target.value })}
                            placeholder="Opcional…"
                            className="h-8"
                          />
                        </td>
                        <td className="py-2 pr-1 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeRow(r.id)}
                            title="Excluir linha"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {podeEditar && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={addManualRow} disabled={!schoolId}>
                  <Plus className="h-4 w-4" /> Adicionar Transação Manualmente
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
