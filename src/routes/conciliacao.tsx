import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchSponteConciliacao, fetchSpontePix, type ConciliacaoSponteResult, type PixPagamentoSponte } from "@/lib/sponte.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, CheckCircle2, Clock, Loader2, FileText, Trash2, RefreshCcw, SplitSquareHorizontal, Plus, X, Palette, Zap, Banknote } from "lucide-react";
import { toast } from "sonner";
import { useSchool, usePermissions } from "@/lib/app-context";
import { autoReconcileSubcategorized } from "@/lib/auto-reconcile";
import { AccessDenied } from "@/components/AccessDenied";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

export const Route = createFileRoute("/conciliacao")({
  head: () => ({
    meta: [
      { title: "Faturamento — School Hub" },
      { name: "description", content: "Concilie qualquer receita do extrato anexando a planilha de detalhamento." },
    ],
  }),
  component: ConciliacaoPage,
});

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatBR(date: string) {
  const [y, m, d] = date.split("-");
  return d && m && y ? `${d}/${m}/${y}` : date;
}
function firstOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function addDays(isoDate: string, delta: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + delta);
  return dt.toISOString().slice(0, 10);
}
// Dia da semana (0 = domingo, 6 = sábado) a partir de "YYYY-MM-DD".
function weekday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}
// "D-1 dia útil": recua a partir da data e ignora sábados/domingos. Assim,
// segunda-feira retrocede para a sexta anterior (−3 dias corridos); terça a
// sexta retrocedem 1 dia; e qualquer recuo nunca cai em fim de semana.
function previousBusinessDay(isoDate: string): string {
  let cur = addDays(isoDate, -1);
  while (weekday(cur) === 0 || weekday(cur) === 6) cur = addDays(cur, -1);
  return cur;
}
// Compara dois valores monetários em CENTAVOS INTEIROS (Math.round), com uma
// tolerância de poucos centavos, evitando falha por dízimas de ponto flutuante.
function fechaCentavos(a: number, b: number, tolCentavos = 2): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= tolCentavos;
}

// Unidades com integração Sponte ativa (mesmo roteamento da Inadimplência).
const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere"];

// Detecta a linha agregada de cobrança bancária compensada no extrato — a que
// precisa ser conciliada via Sponte. Cada banco rotula de um jeito:
//   • Caixa: "COB COMPE" / "COBRANÇA COMPENSADA"
//   • Itaú : "BOLETOS RECEBIDOS" (crédito diário dos boletos compensados)
// O CEC usa extrato do Itaú (conta 489426), por isso precisa do rótulo do Itaú.
function isCobCompe(desc: unknown): boolean {
  const d = norm(desc);
  const caixa = d.includes("compe") && (d.includes("cob") || d.includes("cobranca"));
  const itau = d.includes("boletos recebidos");
  return caixa || itau;
}

// Linha de PIX recebido no extrato (ex.: "PIX RECEBIDO TAYNA...", "PIX RECEB",
// "RECEBIMENTO PIX"). Detecta a forma PIX para a conciliação automática.
function isPix(desc: unknown): boolean {
  return norm(desc).includes("pix");
}

// Partículas de nome ignoradas no fuzzy match (não são distintivas).
const PARTICULAS_NOME = new Set(["da", "de", "do", "das", "dos", "e"]);

// Verifica se um nome do Sponte (aluno, responsável, pai/mãe) "bate" com a
// descrição do extrato bancário. Casa por substring do nome completo OU por
// presença de pelo menos dois tokens distintivos (nomes únicos exigem o token
// presente com ≥4 letras). Conservador para não casar por um primeiro nome
// comum isolado.
function nomeBate(nome: string, descNorm: string): boolean {
  const nn = norm(nome);
  if (!nn) return false;
  if (nn.length >= 5 && descNorm.includes(nn)) return true;
  const tokens = nn.split(/\s+/).filter((t) => t.length >= 3 && !PARTICULAS_NOME.has(t));
  if (tokens.length === 0) return false;
  const presentes = tokens.filter((t) => descNorm.includes(t));
  if (tokens.length === 1) return presentes.length === 1 && tokens[0].length >= 4;
  return presentes.length >= 2;
}

const PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7", "#eab308", "#0ea5e9", "#f43f5e", "#22c55e"];
function hashColor(label: string): string {
  const s = (label ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function norm(s: unknown) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseBRNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).replace(/[R$\s]/g, "").replace(/\u00a0/g, "");
  if (!s) return null;
  // BR format "1.234,56" → "1234.56"
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

type ParsedSheet = {
  items: { subcategory_label: string; amount: number }[];
  total: number;
  valueColumn: string;
  labelColumn: string;
  rowsRead: number;
};

// Preferences for which column holds the "Valor" and the "Serviço/Categoria".
const VALUE_KEYS = ["valor pago", "valor recebido", "vlr pago", "valor liquido", "valor líquido", "valor"];
const LABEL_KEYS = [
  "categoria", "subcategoria", "servico", "serviço", "descricao", "descrição",
  "historico", "histórico", "produto", "item", "plano", "tipo", "discriminacao", "discriminação",
  "sacado", "cliente", "aluno", "favorecido",
];

async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Planilha vazia.");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  // Find the header row: first row that contains any VALUE_KEY.
  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const row = (aoa[i] as unknown[]).map(norm);
    if (row.some((c) => VALUE_KEYS.some((k) => c === k || c.includes(k)))) {
      headerIdx = i;
      header = row;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Não foi possível localizar a coluna 'Valor' na planilha.");

  // Pick value column by priority.
  let valueCol = -1;
  for (const k of VALUE_KEYS) {
    const idx = header.findIndex((h) => h === k || h.includes(k));
    if (idx >= 0) { valueCol = idx; break; }
  }
  if (valueCol < 0) throw new Error("Coluna de valor não encontrada.");

  // Pick label column by priority.
  let labelCol = -1;
  for (const k of LABEL_KEYS) {
    const idx = header.findIndex((h, i) => i !== valueCol && (h === k || h.includes(k)));
    if (idx >= 0) { labelCol = idx; break; }
  }
  // Fallback: first non-value, non-empty column.
  if (labelCol < 0) labelCol = header.findIndex((h, i) => i !== valueCol && h.length > 0);
  if (labelCol < 0) throw new Error("Coluna de descrição/serviço não encontrada.");

  const groups = new Map<string, number>();
  let rowsRead = 0;
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    const rawLabel = String(row[labelCol] ?? "").trim();
    const amt = parseBRNumber(row[valueCol]);
    if (!rawLabel || amt == null) continue;
    // Skip total/summary rows
    if (/^total/i.test(rawLabel) || /registros?:/i.test(rawLabel)) continue;
    rowsRead++;
    groups.set(rawLabel, (groups.get(rawLabel) ?? 0) + amt);
  }

  const items = [...groups.entries()]
    .map(([subcategory_label, amount]) => ({ subcategory_label, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
  const total = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;

  return {
    items,
    total,
    valueColumn: header[valueCol],
    labelColumn: header[labelCol],
    rowsRead,
  };
}

function ConciliacaoPage() {
  const { canView, canEdit, loading: roleLoading } = usePermissions();
  const isAdmin = canEdit("financeiro");
  const qc = useQueryClient();
  const { schools, selected } = useSchool();
  const fetchConciliacao = useServerFn(fetchSponteConciliacao);
  const fetchPix = useServerFn(fetchSpontePix);
  const [schoolId, setSchoolId] = useState(() => (selected !== "all" ? selected : ""));
  const [autoTxId, setAutoTxId] = useState<string | null>(null);
  const [pixRunning, setPixRunning] = useState(false);
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(lastOfMonth());
  const [uploadingTxId, setUploadingTxId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState<string | null>(null);
  const [manualTxId, setManualTxId] = useState<string | null>(null);
  const [manualRows, setManualRows] = useState<{ subcategory_id: string; amount: string }[]>([]);
  const [manualSaving, setManualSaving] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorDraft, setColorDraft] = useState<Record<string, string>>({});
  const [colorsSaving, setColorsSaving] = useState(false);

  const schoolName = schools.find((s) => s.id === schoolId)?.name ?? "";
  const sponteAtiva = UNIDADES_SPONTE.includes(schoolName);

  const { data: revRefs } = useQuery({
    queryKey: ["rev-refs-conciliacao"],
    queryFn: async () => {
      const [cats, subs] = await Promise.all([
        supabase.from("revenue_categories").select("id, name, color").order("name"),
        supabase.from("revenue_subcategories").select("id, name, revenue_category_id, color").order("name"),
      ]);
      if (cats.error) throw cats.error;
      if (subs.error) throw subs.error;
      return { cats: cats.data, subs: subs.data as Array<{ id: string; name: string; revenue_category_id: string; color: string }> };
    },
  });

  // Mapa de cores unificado: resolve um rótulo de item à subcategoria canônica
  // (primeiro pelo revenue_subcategory_id; senão por nome exato/contido) e
  // devolve o NOME e a COR canônicos dessa subcategoria. Assim a mesma
  // subcategoria recebe sempre a mesma cor (a cadastrada em revenue_subcategories,
  // editável na tela), independente do colégio selecionado. Sem correspondência,
  // cai numa cor determinística por rótulo (igual em qualquer unidade).
  function resolveSubcat(label: string, subId: string | null): { name: string; color: string } {
    if (revRefs) {
      let sub = subId ? revRefs.subs.find((s) => s.id === subId) : undefined;
      if (!sub) {
        const n = norm(label);
        sub =
          revRefs.subs.find((s) => norm(s.name) === n) ??
          revRefs.subs.find((s) => n.includes(norm(s.name)) || norm(s.name).includes(n));
      }
      if (sub) return { name: sub.name, color: sub.color };
    }
    return { name: label, color: hashColor(label) };
  }

  const { data: txs = [], isLoading: txLoading } = useQuery({
    queryKey: ["conc-txs", schoolId, startDate, endDate],
    enabled: !!schoolId && !!startDate && !!endDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id, date, amount, description, type, revenue_category_id, revenue_subcategory_id, parent_transaction_id")
        .eq("school_id", schoolId)
        .eq("type", "entrada")
        .is("parent_transaction_id", null)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const revenueTxs = useMemo(() => {
    return txs.filter((t) => {
      const desc = String(t.description ?? "").trim().toUpperCase();
      const amt = Number(t.amount ?? 1);
      if (desc === "SALDO DIA" || desc.includes("SALDO DIA")) return false;
      if (amt === 1) return false;
      // Defensivo: linhas resultantes de split interno nunca aparecem aqui.
      if ((t as any).parent_transaction_id) return false;
      return true;
    });
  }, [txs]);

  const txIds = useMemo(() => revenueTxs.map((t) => t.id), [revenueTxs]);

  const { data: reconciliations = [] } = useQuery({
    queryKey: ["conc-recs", txIds.join(",")],
    enabled: txIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boleto_reconciliations")
        .select("id, transaction_id, source_filename, total_amount, created_at, boleto_reconciliation_items(id, subcategory_label, amount, revenue_category_id, revenue_subcategory_id)")
        .in("transaction_id", txIds);
      if (error) throw error;
      return data as Array<{
        id: string;
        transaction_id: string;
        source_filename: string | null;
        total_amount: number;
        created_at: string;
        boleto_reconciliation_items: Array<{
          id: string;
          subcategory_label: string;
          amount: number;
          revenue_category_id: string | null;
          revenue_subcategory_id: string | null;
        }>;
      }>;
    },
  });

  const recByTx = useMemo(() => {
    const map = new Map<string, (typeof reconciliations)[number]>();
    for (const r of reconciliations) map.set(r.transaction_id, r);
    return map;
  }, [reconciliations]);

  // Auto-conciliação por subcategoria: linhas de receita que já possuem uma
  // subcategoria única definida (na importação) e ainda não têm conciliação são
  // marcadas automaticamente como "Conciliadas", sem exigir desmembramento
  // manual. Cobre extratos antigos e qualquer transação subcategorizada fora do
  // fluxo de importação. O ref evita reprocessar a mesma linha enquanto a query
  // de conciliações é revalidada.
  const autoConcRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!schoolId || !revRefs) return;
    const candidatos = revenueTxs.filter(
      (t) => !!t.revenue_subcategory_id && !recByTx.has(t.id) && !autoConcRef.current.has(t.id),
    );
    if (candidatos.length === 0) return;
    candidatos.forEach((t) => autoConcRef.current.add(t.id));
    (async () => {
      try {
        await autoReconcileSubcategorized(
          candidatos.map((t) => ({
            id: t.id,
            amount: Number(t.amount),
            revenue_category_id: t.revenue_category_id ?? null,
            revenue_subcategory_id: t.revenue_subcategory_id ?? null,
          })),
          revRefs.subs,
          schoolId,
        );
        qc.invalidateQueries({ queryKey: ["conc-recs"] });
        qc.invalidateQueries({ queryKey: ["conc-txs"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      } catch (e) {
        console.error("[CONC] Falha na conciliação automática por subcategoria:", e);
        candidatos.forEach((t) => autoConcRef.current.delete(t.id));
      }
    })();
  }, [schoolId, revRefs, revenueTxs, recByTx, qc]);

  const chartData = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color: string }>();
    for (const r of reconciliations) {
      for (const it of r.boleto_reconciliation_items) {
        const { name, color } = resolveSubcat(it.subcategory_label, it.revenue_subcategory_id);
        const cur = map.get(name);
        if (cur) cur.value += Number(it.amount);
        else map.set(name, { name, value: Number(it.amount), color });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconciliations, revRefs]);

  const totalReconciled = chartData.reduce((s, d) => s + d.value, 0);

  function matchSubcategory(label: string) {
    if (!revRefs) return { revenue_category_id: null, revenue_subcategory_id: null };
    const n = norm(label);
    const sub = revRefs.subs.find((s) => norm(s.name) === n) ??
      revRefs.subs.find((s) => n.includes(norm(s.name)) || norm(s.name).includes(n));
    if (sub) {
      return { revenue_category_id: sub.revenue_category_id, revenue_subcategory_id: sub.id };
    }
    return { revenue_category_id: null, revenue_subcategory_id: null };
  }

  /**
   * Persiste a conciliação SEM duplicar transações no extrato.
   * O detalhamento das subcategorias fica gravado apenas em
   * `boleto_reconciliation_items`, vinculado à transação pai.
   * A transação original permanece intacta (status "Conciliado" derivado da
   * existência de um registro em `boleto_reconciliations`).
   */
  async function persistReconciliation(
    txId: string,
    sourceFilename: string | null,
    _parentDate: string,
    _parentDescription: string,
    items: { subcategory_label: string; amount: number; revenue_category_id: string | null; revenue_subcategory_id: string | null }[],
  ) {
    const total = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;

    // 1. Remove conciliação anterior (cascata apaga itens vinculados).
    const existing = recByTx.get(txId);
    if (existing) {
      await supabase.from("boleto_reconciliations").delete().eq("id", existing.id);
    }
    // 2. Limpeza defensiva: apaga qualquer transação-filha fantasma de versões antigas.
    await supabase.from("transactions").delete().eq("parent_transaction_id" as any, txId);

    // 3. Cria o cabeçalho da conciliação (marca a transação pai como "Conciliada").
    const { data: rec, error: recErr } = await supabase
      .from("boleto_reconciliations")
      .insert({ transaction_id: txId, school_id: schoolId, source_filename: sourceFilename, total_amount: total })
      .select("id")
      .single();
    if (recErr) throw new Error(`Erro ao salvar conciliação: ${recErr.message}`);

    // 4. Grava os itens do desmembramento (somente em boleto_reconciliation_items).
    const itemRows = items.map((it) => ({
      reconciliation_id: rec.id,
      subcategory_label: it.subcategory_label,
      amount: it.amount,
      revenue_category_id: it.revenue_category_id,
      revenue_subcategory_id: it.revenue_subcategory_id,
      transaction_id: null,
    }));
    const { error: itErr } = await supabase.from("boleto_reconciliation_items").insert(itemRows as any);
    if (itErr) throw new Error(`Erro ao salvar itens: ${itErr.message}`);

    // 5. Atualiza a transação pai: associa a categoria principal quando todos os itens são da mesma.
    const distinctCats = new Set(items.map((i) => i.revenue_category_id).filter(Boolean));
    if (distinctCats.size === 1) {
      await supabase
        .from("transactions")
        .update({ revenue_category_id: [...distinctCats][0] as string })
        .eq("id", txId);
    }
  }

  async function handleUpload(txId: string, expectedTotal: number, file: File) {
    if (!revRefs) return;
    const parentTx = revenueTxs.find((t) => t.id === txId);
    if (!parentTx) return;
    setUploadingTxId(txId);
    console.log("[CONC] === Início upload planilha ===", { txId, expectedTotal, file: file.name });
    try {
      const parsed = await parseSpreadsheet(file);
      console.log("[CONC] Planilha parseada:", parsed);
      if (parsed.items.length === 0) throw new Error("Nenhuma linha de valor identificada na planilha.");

      const diff = Math.abs(parsed.total - Number(expectedTotal));
      if (!fechaCentavos(parsed.total, Number(expectedTotal))) {
        throw new Error(`Valores não batem: planilha soma ${formatBRL(parsed.total)}, mas o extrato registra ${formatBRL(Number(expectedTotal))} (diferença ${formatBRL(diff)}).`);
      }

      const items = parsed.items.map((it) => {
        const m = matchSubcategory(it.subcategory_label);
        return { ...it, ...m };
      });

      await persistReconciliation(txId, file.name, parentTx.date, parentTx.description ?? "Receita", items);
      toast.success(`Conciliação salva: ${items.length} subcategoria(s) detalhadas.`);
      qc.invalidateQueries({ queryKey: ["conc-recs"] });
      qc.invalidateQueries({ queryKey: ["conc-txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[CONC] Falha:", e);
      toast.error(msg, { duration: 10000 });
    } finally {
      setUploadingTxId(null);
    }
  }

  async function saveManual() {
    if (!manualTxId || !revRefs) return;
    const parentTx = revenueTxs.find((t) => t.id === manualTxId);
    if (!parentTx) return;
    const expected = Number(parentTx.amount);
    const rows = manualRows
      .map((r) => ({ subcategory_id: r.subcategory_id, amount: parseBRNumber(r.amount) ?? 0 }))
      .filter((r) => r.subcategory_id && r.amount > 0);
    if (rows.length === 0) { toast.error("Adicione ao menos uma linha válida."); return; }
    const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (!fechaCentavos(total, expected)) {
      toast.error(`Soma ${formatBRL(total)} não confere com o total ${formatBRL(expected)}.`);
      return;
    }
    setManualSaving(true);
    try {
      const items = rows.map((r) => {
        const sub = revRefs.subs.find((s) => s.id === r.subcategory_id)!;
        return {
          subcategory_label: sub.name,
          amount: r.amount,
          revenue_category_id: sub.revenue_category_id,
          revenue_subcategory_id: sub.id,
        };
      });
      await persistReconciliation(manualTxId, "Desmembramento manual", parentTx.date, parentTx.description ?? "Receita", items);
      toast.success(`Conciliação manual salva: ${items.length} subcategoria(s).`);
      qc.invalidateQueries({ queryKey: ["conc-recs"] });
      qc.invalidateQueries({ queryKey: ["conc-txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setManualTxId(null);
      setManualRows([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setManualSaving(false);
    }
  }

  function openManual(txId: string) {
    setManualTxId(txId);
    setManualRows([{ subcategory_id: "", amount: "" }]);
  }

  // Conciliação automática via Sponte para linhas "COB COMPE": busca as parcelas
  // baixadas do dia (e, se não fechar, de D-1) cujo somatório bate com a linha,
  // e grava o rateio por categoria — respeitando token/filtro de série da unidade.
  async function handleAutoConciliar(txId: string, expectedTotal: number, date: string) {
    if (!revRefs) return;
    const parentTx = revenueTxs.find((t) => t.id === txId);
    if (!parentTx) return;
    const unidade = schoolName;
    if (!UNIDADES_SPONTE.includes(unidade)) {
      toast.error(`A unidade "${unidade || "selecionada"}" não possui integração Sponte ativa.`);
      return;
    }
    setAutoTxId(txId);
    console.log("[CONC] === Conciliação automática Sponte ===", { txId, expectedTotal, date, unidade });
    try {
      // Janelas tentadas em ordem: o próprio dia da linha, depois o D-1 dia útil
      // (segunda → sexta anterior; demais → dia anterior; nunca cai em fim de semana).
      const dPrevUtil = previousBusinessDay(date);
      const janelas = [
        { inicio: date, fim: date, rotulo: "do dia" },
        { inicio: dPrevUtil, fim: dPrevUtil, rotulo: "do dia útil anterior" },
      ];
      // O Belvedere credita boletos em DUAS contas creditadas (9295 e 1137).
      // Tentamos o valor exato na 9295 primeiro; se nenhuma janela fechar, na
      // 1137. Demais unidades usam a conta padrão configurada no servidor
      // (contaCreditada = undefined).
      const contas: (string | undefined)[] =
        unidade === "Núcleo Belvedere" ? ["9295", "1137"] : [undefined];
      let escolhido: ConciliacaoSponteResult | null = null;
      let usado = "";
      const totaisVistos: string[] = [];
      let ultimoDiag: ConciliacaoSponteResult["diagnostico"] | undefined;
      for (const conta of contas) {
        for (const j of janelas) {
          const r = await fetchConciliacao({
            data: { dataInicio: j.inicio, dataFim: j.fim, unidade, contaCreditada: conta },
          });
          if (r.error) throw new Error(r.error);
          if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
          ultimoDiag = r.diagnostico;
          const rotulo = conta ? `${j.rotulo} (conta ${conta})` : j.rotulo;
          console.log(`[CONC] janela ${rotulo} (${j.inicio}..${j.fim}):`, r);
          // Mostra o que REALMENTE foi encontrado, não só "R$ 0,00".
          totaisVistos.push(`${rotulo}: ${r.qtdParcelas} reg / ${formatBRL(r.total)}`);
          if (r.itens.length > 0 && fechaCentavos(r.total, expectedTotal)) {
            escolhido = r;
            usado = rotulo;
            break;
          }
        }
        if (escolhido) break;
      }
      if (!escolhido) {
        // Diagnóstico: expõe os rótulos reais do Sponte para depurar produção.
        const d = ultimoDiag;
        const detalhe = d
          ? ` Diagnóstico: ${d.totalNos} parcela(s) no lote; ${d.comFormaBancaria} bancária(s), ${d.comSituacaoBaixada} baixada(s), ${d.comDataNaJanela} na data, ${d.comContaCorreta} na conta. Situações: ${d.situacoesVistas.join(", ") || "—"}. Contas: ${d.contasVistas.join(", ") || "—"}.`
          : "";
        throw new Error(
          `Nenhuma janela fechou com ${formatBRL(expectedTotal)} (${totaisVistos.join(" · ")}).${detalhe} Use o desmembramento manual ou anexe a planilha.`,
        );
      }
      const items = escolhido.itens.map((it) => {
        const m = matchSubcategory(it.categoria);
        return { subcategory_label: it.categoria, amount: it.valor, ...m };
      });
      await persistReconciliation(
        txId,
        `Conciliação automática Sponte (${usado})`,
        parentTx.date,
        parentTx.description ?? "Receita",
        items,
      );
      toast.success(
        `Conciliado via Sponte: ${items.length} categoria(s), total ${formatBRL(escolhido.total)} (${escolhido.qtdParcelas} parcela(s)).`,
      );
      qc.invalidateQueries({ queryKey: ["conc-recs"] });
      qc.invalidateQueries({ queryKey: ["conc-txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[CONC] Falha na conciliação automática:", e);
      toast.error(msg, { duration: 10000 });
    } finally {
      setAutoTxId(null);
    }
  }

  // Conciliação automática de PIX (Fuzzy Matching). Para cada linha de PIX
  // pendente do extrato, busca no Sponte as baixas PIX numa janela que vai do
  // dia 01 do mês da linha até a data da linha (o colégio retroage a data de
  // pagamento no Sponte p/ manter o desconto de pontualidade, então a baixa pode
  // estar registrada dias antes da compensação no banco) e faz a triangulação:
  //   • Condição 1: valor exato do pagamento;
  //   • Condição 2: o nome na descrição do extrato contém (substring) o nome do
  //     Responsável Financeiro, Aluno, Pai ou Mãe.
  // Prevenção de colisão (CRÍTICO): se houver ≥2 pagamentos com o mesmo valor na
  // janela e o nome não desambiguar para exatamente um, a linha permanece
  // Pendente (desmembramento manual), evitando alocar saldo para o aluno errado.
  async function handleConciliarPix() {
    if (!revRefs) return;
    const unidade = schoolName;
    if (!UNIDADES_SPONTE.includes(unidade)) {
      toast.error(`A unidade "${unidade || "selecionada"}" não possui integração Sponte ativa.`);
      return;
    }
    const pendentes = revenueTxs.filter((t) => !recByTx.has(t.id) && isPix(t.description));
    if (pendentes.length === 0) {
      toast.info("Nenhuma linha de PIX pendente no período selecionado.");
      return;
    }
    setPixRunning(true);
    console.log("[CONC][PIX] === Conciliação automática de PIX ===", { unidade, linhas: pendentes.length });
    let conciliados = 0;
    let colisoes = 0;
    let semMatch = 0;
    // Cache de pagamentos PIX por janela (dia 01 do mês → data da linha).
    const cachePorJanela = new Map<string, PixPagamentoSponte[]>();
    try {
      for (const t of pendentes) {
        // Janela: do dia 01 do mês da linha até a data da linha (inclusive).
        const inicioMes = `${t.date.slice(0, 7)}-01`;
        const cacheKey = `${inicioMes}_${t.date}`;
        let pagamentos = cachePorJanela.get(cacheKey);
        if (!pagamentos) {
          const r = await fetchPix({ data: { dataInicio: inicioMes, dataFim: t.date, unidade } });
          if (r.error) throw new Error(r.error);
          if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
          pagamentos = r.pagamentos;
          cachePorJanela.set(cacheKey, pagamentos);
        }

        const lineAmount = Number(t.amount);
        const descNorm = norm(t.description);
        const porValor = pagamentos.filter((p) => fechaCentavos(p.valor, lineAmount));
        const porNome = porValor.filter((p) => p.nomes.some((n) => nomeBate(n, descNorm)));

        if (porNome.length === 1) {
          const p = porNome[0];
          const items = p.itens.map((it) => {
            const m = matchSubcategory(it.categoria);
            return { subcategory_label: it.categoria, amount: it.valor, ...m };
          });
          await persistReconciliation(
            t.id,
            `Conciliação PIX Sponte (${p.nomeAluno})`,
            t.date,
            t.description ?? "PIX",
            items,
          );
          conciliados++;
        } else if (porValor.length >= 2) {
          // Mesmo valor, nome ambíguo (0 ou >1) → mantém pendente.
          colisoes++;
        } else {
          semMatch++;
        }
      }
      qc.invalidateQueries({ queryKey: ["conc-recs"] });
      qc.invalidateQueries({ queryKey: ["conc-txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const partes = [`${conciliados} conciliada(s)`];
      if (colisoes > 0) partes.push(`${colisoes} mantida(s) pendente(s) por colisão de valor/nome`);
      if (semMatch > 0) partes.push(`${semMatch} sem correspondência`);
      if (conciliados > 0) toast.success(`PIX: ${partes.join(" · ")}.`);
      else toast.info(`Nenhum PIX conciliado automaticamente (${partes.join(" · ")}).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[CONC][PIX] Falha:", e);
      toast.error(msg, { duration: 10000 });
    } finally {
      setPixRunning(false);
    }
  }

  async function removeRec(recId: string, txId: string) {
    if (!confirm("Remover esta conciliação? O detalhamento por subcategoria será apagado, mas a linha do extrato será preservada.")) return;
    // Limpeza defensiva contra transações-filhas legadas.
    await supabase.from("transactions").delete().eq("parent_transaction_id" as any, txId);
    const { error } = await supabase.from("boleto_reconciliations").delete().eq("id", recId);
    if (error) toast.error(error.message);
    else {
      toast.success("Conciliação removida.");
      qc.invalidateQueries({ queryKey: ["conc-recs"] });
      qc.invalidateQueries({ queryKey: ["conc-txs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }

  if (roleLoading) return null;
  if (!canView("financeiro_conciliacao"))
    return <AccessDenied message="Você não tem permissão para acessar a Conciliação de Faturamento." />;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold">Conciliação de Faturamento</h1>
        <p className="text-sm text-muted-foreground">
          Para linhas <strong>COB COMPE</strong>, use <strong>Conciliar Automático via Sponte</strong>: o sistema busca as parcelas baixadas do dia (ou D-1) e monta o rateio por categoria, respeitando o token e o filtro de série da unidade. Também é possível anexar a planilha (Excel/CSV) ou desmembrar manualmente. Em todos os casos a soma deve fechar com o valor da linha.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div>
            <Label>Colégio</Label>
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data inicial</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label>Data final</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={() => { setStartDate(firstOfMonth()); setEndDate(lastOfMonth()); }}>
              <RefreshCcw className="h-4 w-4" /> Mês atual
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span>Composição dos Recebimentos</span>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!revRefs) return;
                    const draft: Record<string, string> = {};
                    for (const s of revRefs.subs) draft[s.id] = s.color || "#3b82f6";
                    setColorDraft(draft);
                    setColorsOpen(true);
                  }}
                >
                  <Palette className="h-3 w-3" /> Configurar Cores
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhum desmembramento ainda. Anexe planilhas às linhas para ver a composição.
              </p>
            ) : (
              <>
                <div className="text-center mb-4">
                  <div className="text-xs text-muted-foreground">Total desmembrado</div>
                  <div className="text-xl font-bold">{formatBRL(totalReconciled)}</div>
                </div>
                <div className="grid gap-6 md:grid-cols-2 items-center">
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={120} paddingAngle={2}>
                          {chartData.map((d) => <Cell key={d.name} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatBRL(v)} />
                        <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1 max-h-80 overflow-y-auto pr-2">
                    {chartData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between text-xs border-b py-1.5">
                        <span className="flex items-center gap-2 truncate">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: d.color }} />
                          {d.name}
                        </span>
                        <span className="font-mono">{formatBRL(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span>Receitas do Período</span>
              <div className="flex items-center gap-2">
                {isAdmin && sponteAtiva && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handleConciliarPix}
                    disabled={pixRunning || !!autoTxId || !!uploadingTxId}
                    title="Cruza as linhas de PIX do extrato com as baixas PIX do Sponte por valor + nome (fuzzy matching)"
                  >
                    {pixRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Banknote className="h-3 w-3" />}
                    Conciliar PIX via Sponte
                  </Button>
                )}
                <Badge variant="secondary">{revenueTxs.length} linha(s)</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!schoolId ? (
              <p className="text-sm text-muted-foreground">Selecione um colégio para listar as receitas.</p>
            ) : txLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando…</p>
            ) : revenueTxs.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-6 text-center">
                Nenhuma receita encontrada no período selecionado.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-56 text-right">{isAdmin ? "Ação" : "Detalhes"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenueTxs.map((t) => {
                    const rec = recByTx.get(t.id);
                    const isUploading = uploadingTxId === t.id;
                    const isAuto = autoTxId === t.id;
                    const isReconciled = !!rec;
                    const cobCompe = isCobCompe(t.description);
                    const pix = isPix(t.description);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">{formatBR(t.date)}</TableCell>
                        <TableCell className="text-sm max-w-[280px]" title={t.description}>
                          <span className="truncate inline-block max-w-[200px] align-middle">{t.description}</span>
                          {cobCompe && (
                            <Badge variant="outline" className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300 border-sky-500/40">
                              COB COMPE
                            </Badge>
                          )}
                          {pix && !cobCompe && (
                            <Badge variant="outline" className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 border-emerald-500/40">
                              PIX
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatBRL(Number(t.amount))}</TableCell>
                        <TableCell>
                          {isReconciled ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3" /> Conciliado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-500/40">
                              <Clock className="h-3 w-3" /> Pendente
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isReconciled && (
                              <Button size="sm" variant="ghost" onClick={() => setViewerOpen(t.id)} title="Visualizar desmembramento">
                                <FileText className="h-3 w-3" />
                              </Button>
                            )}
                            {isAdmin && isReconciled && (
                              <Button size="sm" variant="ghost" onClick={() => removeRec(rec.id, t.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                            {isAdmin && (
                              <>
                                {cobCompe && sponteAtiva && (
                                  <Button
                                    size="sm"
                                    variant={isReconciled ? "outline" : "default"}
                                    className={isReconciled ? "" : "bg-sky-600 hover:bg-sky-700 text-white"}
                                    onClick={() => handleAutoConciliar(t.id, Number(t.amount), t.date)}
                                    disabled={isUploading || isAuto}
                                    title="Buscar parcelas baixadas no Sponte e conciliar automaticamente"
                                  >
                                    {isAuto ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                                    Conciliar Automático via Sponte
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" onClick={() => openManual(t.id)} disabled={isUploading || isAuto}>
                                  <SplitSquareHorizontal className="h-3 w-3" /> Desmembrar Manualmente
                                </Button>
                                <label>
                                  <input
                                    type="file"
                                    accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                                    className="hidden"
                                    disabled={isUploading || isAuto}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) handleUpload(t.id, Number(t.amount), f);
                                      e.target.value = "";
                                    }}
                                  />
                                  <Button size="sm" variant={isReconciled ? "outline" : "default"} asChild disabled={isUploading || isAuto}>
                                    <span className="cursor-pointer">
                                      {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                                      {isReconciled ? "Substituir Planilha" : "Anexar Planilha (Excel/CSV)"}
                                    </span>
                                  </Button>
                                </label>
                              </>
                            )}
                            {!isAdmin && !isReconciled && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!viewerOpen} onOpenChange={(o) => !o && setViewerOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Desmembramento da Planilha</DialogTitle></DialogHeader>
          {(() => {
            const rec = viewerOpen ? recByTx.get(viewerOpen) : null;
            if (!rec) return null;
            return (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Arquivo: <strong>{rec.source_filename}</strong> · Total: <strong>{formatBRL(Number(rec.total_amount))}</strong>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Subcategoria</TableHead><TableHead className="text-right">Valor</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rec.boleto_reconciliation_items]
                      .sort((a, b) => a.subcategory_label.localeCompare(b.subcategory_label))
                      .map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm">{it.subcategory_label}{!it.revenue_subcategory_id && <Badge variant="outline" className="ml-2 text-xs">não mapeada</Badge>}</TableCell>
                          <TableCell className="text-right font-mono">{formatBRL(Number(it.amount))}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!manualTxId} onOpenChange={(o) => { if (!o) { setManualTxId(null); setManualRows([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Desmembramento Manual</DialogTitle></DialogHeader>
          {(() => {
            const parent = manualTxId ? revenueTxs.find((t) => t.id === manualTxId) : null;
            if (!parent) return null;
            const expected = Number(parent.amount);
            const sum = manualRows.reduce((s, r) => s + (parseBRNumber(r.amount) ?? 0), 0);
            const diff = Math.round((expected - sum) * 100) / 100;
            const ok = fechaCentavos(sum, expected) && manualRows.some((r) => r.subcategory_id && (parseBRNumber(r.amount) ?? 0) > 0);
            return (
              <div className="space-y-3">
                <div className="rounded-md bg-muted p-3 text-sm">
                  <div><strong>{parent.description}</strong> · {formatBR(parent.date)}</div>
                  <div className="mt-1">Total a desmembrar: <strong className="font-mono">{formatBRL(expected)}</strong></div>
                </div>

                <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                  {manualRows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_140px_auto] gap-2 items-end">
                      <div>
                        {idx === 0 && <Label className="text-xs">Subcategoria de Receita</Label>}
                        <Select
                          value={row.subcategory_id}
                          onValueChange={(v) => setManualRows((rs) => rs.map((r, i) => i === idx ? { ...r, subcategory_id: v } : r))}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {(() => {
                              if (!revRefs) return null;
                              const sortedSubs = [...revRefs.subs].sort((a: any, b: any) => a.name.localeCompare(b.name));
                              return sortedSubs.map((s) => {
                                const cat = revRefs.cats.find((c) => c.id === s.revenue_category_id);
                                return <SelectItem key={s.id} value={s.id}>{cat?.name ?? "?"} → {s.name}</SelectItem>;
                              });
                            })()}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        {idx === 0 && <Label className="text-xs">Valor (R$)</Label>}
                        <Input
                          inputMode="decimal"
                          placeholder="0,00"
                          value={row.amount}
                          onChange={(e) => setManualRows((rs) => rs.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setManualRows((rs) => rs.filter((_, i) => i !== idx))}
                        disabled={manualRows.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button size="sm" variant="outline" onClick={() => setManualRows((rs) => [...rs, { subcategory_id: "", amount: "" }])}>
                  <Plus className="h-3 w-3" /> Adicionar linha
                </Button>

                <div className={`rounded-md border p-3 text-sm flex items-center justify-between ${ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                  <span>Soma informada: <strong className="font-mono">{formatBRL(sum)}</strong></span>
                  <span>
                    {fechaCentavos(sum, expected)
                      ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Bate com o total</Badge>
                      : <span className="text-amber-700 dark:text-amber-300">Faltam <strong className="font-mono">{formatBRL(diff)}</strong></span>}
                  </span>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setManualTxId(null); setManualRows([]); }}>Cancelar</Button>
                  <Button onClick={saveManual} disabled={!ok || manualSaving}>
                    {manualSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Salvar Conciliação Manual
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={colorsOpen} onOpenChange={setColorsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Configurar Cores do Faturamento</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Escolha uma cor fixa para cada subcategoria de receita. As cores serão aplicadas no gráfico e na legenda em todos os meses.
          </p>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {revRefs && [...revRefs.subs].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
              const cat = revRefs.cats.find((c) => c.id === s.revenue_category_id);
              const val = colorDraft[s.id] ?? s.color ?? "#3b82f6";
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 border-b py-2">
                  <div className="text-sm truncate">
                    <span className="text-muted-foreground">{cat?.name ?? "?"} →</span> {s.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border" style={{ background: val }} />
                    <input
                      type="color"
                      value={val}
                      onChange={(e) => setColorDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                      className="h-8 w-12 cursor-pointer rounded border bg-transparent"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColorsOpen(false)} disabled={colorsSaving}>Cancelar</Button>
            <Button
              disabled={colorsSaving || !revRefs}
              onClick={async () => {
                if (!revRefs) return;
                setColorsSaving(true);
                try {
                  const changes = revRefs.subs.filter((s) => colorDraft[s.id] && colorDraft[s.id] !== s.color);
                  for (const s of changes) {
                    const { error } = await supabase.from("revenue_subcategories").update({ color: colorDraft[s.id] }).eq("id", s.id);
                    if (error) throw error;
                  }
                  toast.success(`Cores atualizadas (${changes.length}).`);
                  qc.invalidateQueries({ queryKey: ["rev-refs-conciliacao"] });
                  setColorsOpen(false);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                } finally {
                  setColorsSaving(false);
                }
              }}
            >
              {colorsSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Salvar Cores
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
