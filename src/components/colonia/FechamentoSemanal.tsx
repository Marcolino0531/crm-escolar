import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Coffee,
  Sun,
  Cookie,
  Moon,
  LogIn,
  LogOut,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  Trash2,
  UserCircle2,
  Info,
  Wallet,
  Receipt,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Handshake,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/lib/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  COLONIA_RECORD_LABEL,
  COLONIA_WEEKDAYS,
  addDays,
  descricaoPendenciaPortaria,
  firstOfMonth,
  fmtDayMonth,
  fmtTime,
  labelPendenciaPortaria,
  mondayOf,
  ordenarRegistrosDoDia,
  pendenciaPortaria,
  toYMD,
  type ColoniaRecord,
  type ColoniaRecordType,
  type ColoniaStudentWeek,
  type PendenciaPortaria,
} from "@/lib/colonia";
import {
  computeDayBilling,
  computeWeekBilling,
  computeWeekPermanencia,
  sponteAtivoNoMes,
  type WeekBilling,
} from "@/lib/colonia-billing";
import {
  fetchColoniaBeneficios,
  faturarColoniaSponte,
  desvincularFaturamentoColonia,
  conferirFaturamentoColonia,
  verificarDuplicidadeColonia,
  marcarAcordoManualColonia,
} from "@/lib/sponte.functions";

const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

const ICONS: Record<ColoniaRecordType, React.ComponentType<{ className?: string }>> = {
  breakfast: Coffee,
  lunch: Sun,
  snack: Cookie,
  dinner: Moon,
  entry: LogIn,
  exit: LogOut,
};

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtYMD(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

type EmbeddedStudent = {
  name: string;
  class_name: string;
  sponte_aluno_id: string | null;
};

type RawRow = {
  id: string;
  student_id: string;
  school_id: string;
  record_type: ColoniaRecordType;
  occurred_at: string;
  diario_students: EmbeddedStudent | EmbeddedStudent[] | null;
};

function pickStudent(s: RawRow["diario_students"]): EmbeddedStudent | null {
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

const RECORD_SELECT =
  "id, student_id, school_id, record_type, occurred_at, diario_students(name, class_name, sponte_aluno_id)";

type Props = {
  schoolFilterIds: string[] | null;
  canEdit: boolean;
  canFaturar?: boolean;
};

export function FechamentoSemanal({ schoolFilterIds, canEdit, canFaturar = false }: Props) {
  const qc = useQueryClient();
  const { schools } = useSchool();
  const beneficiosFn = useServerFn(fetchColoniaBeneficios);
  const faturarTodosFn = useServerFn(faturarColoniaSponte);
  const checarDuplicidadeFn = useServerFn(verificarDuplicidadeColonia);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [loteOpen, setLoteOpen] = useState(false);
  const [vencimentoFaturamento, setVencimentoFaturamento] = useState("");
  const [loteDuplicados, setLoteDuplicados] = useState<string[] | null>(null);
  const [loteConcluidoWeek, setLoteConcluidoWeek] = useState<string | null>(null);
  const schoolIdToName = useMemo(() => new Map(schools.map((s) => [s.id, s.name])), [schools]);

  const rangeStart = weekStart;
  const rangeEndExclusive = addDays(weekStart, 5); // sábado 00:00 → cobre seg–sex
  const friday = addDays(weekStart, 4);
  const isCurrentWeek = weekStart.getTime() >= mondayOf(new Date()).getTime();

  // Mês de referência da colônia = mês da quinta-feira (meio da semana Mon–Fri).
  // Define a trava de calendário (Sponte só em Julho/Dezembro) e o banco de
  // crédito mensal de hora extra.
  const refDay = addDays(weekStart, 3);
  const refMes = refDay.getMonth() + 1;
  const refAno = refDay.getFullYear();
  const sponteActive = sponteAtivoNoMes(refMes);
  const monthStart = firstOfMonth(refDay);

  const schoolKey = schoolFilterIds ? schoolFilterIds.join(",") : "all";

  const { data: students = [], isLoading } = useQuery({
    queryKey: ["colonia_closing", schoolKey, weekStart.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("holiday_camp_records" as never)
        .select(RECORD_SELECT)
        .gte("occurred_at", rangeStart.toISOString())
        .lt("occurred_at", rangeEndExclusive.toISOString())
        .order("occurred_at", { ascending: true });
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds as never);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawRow[];

      const map = new Map<string, ColoniaStudentWeek>();
      for (const r of rows) {
        let entry = map.get(r.student_id);
        if (!entry) {
          const st = pickStudent(r.diario_students);
          entry = {
            studentId: r.student_id,
            schoolId: r.school_id,
            sponteAlunoId: st?.sponte_aluno_id ?? null,
            name: st?.name ?? "Aluno removido",
            className: st?.class_name ?? "",
            byDay: { 1: [], 2: [], 3: [], 4: [], 5: [] },
            total: 0,
          };
          map.set(r.student_id, entry);
        }
        const wd = new Date(r.occurred_at).getDay();
        const rec: ColoniaRecord = {
          id: r.id,
          record_type: r.record_type,
          occurred_at: r.occurred_at,
        };
        if (wd >= 1 && wd <= 5) entry.byDay[wd].push(rec);
        entry.total += 1;
      }
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });

  // Permanência (diárias + horas) consumida nas semanas ANTERIORES do mesmo mês —
  // usada para o crédito de hora extra transitar entre semanas. Só faz sentido
  // quando o Sponte está ativo (Julho/Dezembro).
  const { data: prevPermByStudent = {}, isLoading: prevPermLoading } = useQuery({
    queryKey: ["colonia_prev_perm", schoolKey, monthStart.toISOString(), weekStart.toISOString()],
    enabled: sponteActive && weekStart.getTime() > monthStart.getTime(),
    queryFn: async () => {
      let q = supabase
        .from("holiday_camp_records" as never)
        .select("id, student_id, record_type, occurred_at")
        .gte("occurred_at", monthStart.toISOString())
        .lt("occurred_at", rangeStart.toISOString())
        .order("occurred_at", { ascending: true });
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds as never);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawRow[];

      // student_id → (mondayISO → byDay)
      const perStudent = new Map<string, Map<string, Record<number, ColoniaRecord[]>>>();
      for (const r of rows) {
        const wd = new Date(r.occurred_at).getDay();
        if (wd < 1 || wd > 5) continue;
        const monday = mondayOf(new Date(r.occurred_at)).toISOString();
        let weeks = perStudent.get(r.student_id);
        if (!weeks) {
          weeks = new Map();
          perStudent.set(r.student_id, weeks);
        }
        let byDay = weeks.get(monday);
        if (!byDay) {
          byDay = { 1: [], 2: [], 3: [], 4: [], 5: [] };
          weeks.set(monday, byDay);
        }
        byDay[wd].push({
          id: r.id,
          record_type: r.record_type,
          occurred_at: r.occurred_at,
        });
      }

      const result: Record<string, number> = {};
      for (const [studentId, weeks] of perStudent) {
        let total = 0;
        for (const byDay of weeks.values()) {
          const days = COLONIA_WEEKDAYS.map((d) =>
            computeDayBilling(byDay[d.weekday], d.weekday, new Set()),
          );
          total += computeWeekPermanencia(days);
        }
        result[studentId] = Math.round(total * 100) / 100;
      }
      return result;
    },
  });

  // Benefícios do Sponte (crédito de hora extra + refeições isentas) por aluno.
  // Consulta por unidade, só em Julho/Dezembro. Chave por sponte_aluno_id.
  const sponteIds = students
    .map((s) => s.sponteAlunoId)
    .filter((v): v is string => !!v)
    .sort();

  const { data: beneficios = {}, isLoading: beneficiosLoading } = useQuery({
    queryKey: ["colonia_beneficios", schoolKey, refAno, refMes, sponteIds.join(",")],
    enabled: sponteActive && sponteIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Agrupa os sponte_aluno_id por unidade Sponte.
      const porUnidade = new Map<string, string[]>();
      for (const s of students) {
        if (!s.sponteAlunoId) continue;
        const unidade = schoolIdToName.get(s.schoolId);
        if (!unidade || !UNIDADES_SPONTE.includes(unidade)) continue;
        const arr = porUnidade.get(unidade) ?? [];
        arr.push(s.sponteAlunoId);
        porUnidade.set(unidade, arr);
      }

      const merged: Record<string, { creditoHoraExtra: number; refeicoesIsentas: string[] }> = {};
      await Promise.all(
        [...porUnidade.entries()].map(async ([unidade, alunoIds]) => {
          const res = await beneficiosFn({
            data: { unidade, mes: refMes, ano: refAno, alunoIds },
          });
          Object.assign(merged, res.beneficios);
        }),
      );
      return merged;
    },
  });

  const calcReady = !sponteActive || (!beneficiosLoading && !prevPermLoading);

  // Integridade da portaria: dia com qualquer movimentação precisa ter Entrada
  // E Saída. Só acusa dias já finalizados (de ontem para trás).
  const hojeYMD = toYMD(new Date());
  const pendenciasByStudent = useMemo(() => {
    const m = new Map<string, Map<number, PendenciaPortaria>>();
    for (const s of students) {
      const dias = new Map<number, PendenciaPortaria>();
      for (const d of COLONIA_WEEKDAYS) {
        const p = pendenciaPortaria(
          s.byDay[d.weekday],
          toYMD(addDays(weekStart, d.weekday - 1)),
          hojeYMD,
        );
        if (p) dias.set(d.weekday, p);
      }
      if (dias.size > 0) m.set(s.studentId, dias);
    }
    return m;
  }, [students, weekStart, hojeYMD]);

  // Extrato por aluno (também usado pelo watcher que invalida faturamentos cujo
  // valor mudou depois de faturado).
  const billingByStudent = useMemo(() => {
    const m = new Map<string, WeekBilling>();
    for (const s of students) {
      const benefit = sponteActive && s.sponteAlunoId ? beneficios[s.sponteAlunoId] : undefined;
      const exemptions = new Set<ColoniaRecordType>(
        (benefit?.refeicoesIsentas ?? []) as ColoniaRecordType[],
      );
      const days = COLONIA_WEEKDAYS.map((d) =>
        computeDayBilling(s.byDay[d.weekday], d.weekday, exemptions),
      );
      m.set(
        s.studentId,
        computeWeekBilling({
          days,
          permanenciaSemanasAnteriores: prevPermByStudent[s.studentId] ?? 0,
          creditoHoraExtra: sponteActive ? (benefit?.creditoHoraExtra ?? 0) : 0,
        }),
      );
    }
    return m;
  }, [students, beneficios, prevPermByStudent, sponteActive]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("holiday_camp_records" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success("Registro removido");
      qc.invalidateQueries({ queryKey: ["colonia_closing"] });
      qc.invalidateQueries({ queryKey: ["colonia_prev_perm"] });
      qc.invalidateQueries({ queryKey: ["colonia_records"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao remover", { description: msg });
    },
  });

  // Alunos já faturados NESTA semana (para exibir o botão como "Faturado").
  const weekStartYMD = toYMD(weekStart);
  const weekEndYMD = toYMD(friday);
  const { data: invoices = [] } = useQuery({
    queryKey: ["colonia_invoices", schoolKey, weekStartYMD],
    enabled: canFaturar,
    queryFn: async () => {
      let q = supabase
        .from("holiday_camp_invoices" as never)
        .select(
          "student_id, school_id, amount, due_date, sponte_aluno_id, sponte_conta_receber_id, manual_settlement",
        )
        .eq("week_start", weekStartYMD);
      if (schoolFilterIds) q = q.in("school_id", schoolFilterIds as never);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as {
          student_id: string;
          school_id: string;
          amount: number | string;
          due_date: string | null;
          sponte_aluno_id: string | null;
          sponte_conta_receber_id: string | null;
          manual_settlement: boolean | null;
        };
        return {
          studentId: row.student_id,
          schoolId: row.school_id,
          amount: Number(row.amount),
          dueDate: row.due_date,
          sponteAlunoId: row.sponte_aluno_id,
          contaReceberId: row.sponte_conta_receber_id,
          manual: Boolean(row.manual_settlement),
        };
      });
    },
  });
  const invoicedSet = useMemo(() => new Set(invoices.map((i) => i.studentId)), [invoices]);
  const manualSet = useMemo(
    () => new Set(invoices.filter((i) => i.manual).map((i) => i.studentId)),
    [invoices],
  );

  // Watcher (edição local): se o total da semana mudou depois de faturado, o
  // faturamento não vale mais — desvincula automaticamente e reabilita o botão.
  const desvincularFn = useServerFn(desvincularFaturamentoColonia);
  const syncingRef = useRef(false);
  useEffect(() => {
    if (!canFaturar || invoices.length === 0 || !calcReady || syncingRef.current) return;
    const stale = invoices.filter((inv) => {
      if (inv.manual) return false;
      const total = billingByStudent.get(inv.studentId)?.total ?? 0;
      return Math.abs(total - inv.amount) > 0.005;
    });
    if (stale.length === 0) return;
    syncingRef.current = true;
    void (async () => {
      for (const inv of stale) {
        const unidade = schoolIdToName.get(inv.schoolId);
        if (!unidade) continue;
        try {
          await desvincularFn({
            data: { unidade, studentId: inv.studentId, weekStart: weekStartYMD },
          });
        } catch {
          /* mantém como está; tenta de novo no próximo carregamento */
        }
      }
      toast.info("Faturamento invalidado: os registros da semana foram alterados.");
      await qc.invalidateQueries({ queryKey: ["colonia_invoices"] });
      syncingRef.current = false;
    })();
  }, [
    invoices,
    billingByStudent,
    calcReady,
    canFaturar,
    schoolIdToName,
    weekStartYMD,
    desvincularFn,
    qc,
  ]);

  // Data de vencimento do faturamento: é a chave da conferência no Sponte.
  // Assume o vencimento já usado no faturamento da semana; na ausência dele,
  // a sexta-feira da semana.
  const vencimentoSalvo = invoices.find((inv) => inv.dueDate)?.dueDate ?? null;
  useEffect(() => {
    setVencimentoFaturamento(vencimentoSalvo ?? weekEndYMD);
  }, [vencimentoSalvo, weekEndYMD]);

  // Conferência no Sponte por vencimento + categoria: o aluno conta como
  // faturado quando existe título de Colônia com essa data, seja qual for a
  // situação do boleto (a remessa bancária muda o status e não pode reabrir o
  // faturamento). Títulos existentes sem vínculo local são adotados; vínculos
  // daquele vencimento sem título no Sponte são revertidos.
  const conferirFn = useServerFn(conferirFaturamentoColonia);
  const conferenciaItens = useMemo(() => {
    if (!canFaturar || !calcReady) return [];
    return students
      .map((s) => ({
        unidade: schoolIdToName.get(s.schoolId) ?? "",
        studentId: s.studentId,
        schoolId: s.schoolId,
        sponteAlunoId: s.sponteAlunoId ?? "",
        valor: billingByStudent.get(s.studentId)?.total ?? 0,
        temVinculoLocal: invoicedSet.has(s.studentId),
      }))
      .filter(
        (it) =>
          !!it.sponteAlunoId &&
          UNIDADES_SPONTE.includes(it.unidade) &&
          !manualSet.has(it.studentId),
      );
  }, [students, billingByStudent, invoicedSet, manualSet, schoolIdToName, canFaturar, calcReady]);

  const { data: conferencia } = useQuery({
    queryKey: [
      "colonia_conferencia_sponte",
      weekStartYMD,
      vencimentoFaturamento,
      conferenciaItens
        .map((i) => i.sponteAlunoId)
        .sort()
        .join(","),
    ],
    enabled: conferenciaItens.length > 0 && !!vencimentoFaturamento,
    staleTime: 2 * 60_000,
    queryFn: async () =>
      conferirFn({
        data: {
          vencimento: vencimentoFaturamento,
          weekStart: weekStartYMD,
          weekEnd: weekEndYMD,
          itens: conferenciaItens,
        },
      }),
  });

  const sponteFaturadosSet = useMemo(
    () => new Set(conferencia?.faturados ?? []),
    [conferencia?.faturados],
  );

  useEffect(() => {
    if (!conferencia) return;
    const { adotados, revertidos } = conferencia;
    if (adotados.length === 0 && revertidos.length === 0) return;
    if (adotados.length > 0) {
      toast.info(
        "Faturamento reconhecido: título de Colônia já existe no Sponte neste vencimento.",
      );
    } else {
      toast.info("Faturamento revertido: título excluído no Sponte para este vencimento.");
    }
    void qc.invalidateQueries({ queryKey: ["colonia_invoices"] });
    void qc.invalidateQueries({ queryKey: ["colonia_pendencias_semana"] });
  }, [conferencia, qc]);

  const weekLabel = useMemo(
    () => `${fmtDayMonth(weekStart)} – ${fmtDayMonth(friday)}`,
    [weekStart, friday],
  );

  // Faturamento em lote: alunos com valor pendente que ainda NÃO foram resolvidos
  // (invoicedSet já cobre faturados no Sponte E acordos manuais → ambos ignorados)
  // e que têm vínculo Sponte + unidade integrada.
  const faturaveis = useMemo(() => {
    if (!canFaturar || !calcReady) return [];
    return students
      .map((s) => ({
        s,
        unidade: schoolIdToName.get(s.schoolId) ?? null,
        total: billingByStudent.get(s.studentId)?.total ?? 0,
      }))
      .filter(
        ({ s, unidade, total }) =>
          !invoicedSet.has(s.studentId) &&
          !sponteFaturadosSet.has(s.studentId) &&
          !!s.sponteAlunoId &&
          !!unidade &&
          UNIDADES_SPONTE.includes(unidade) &&
          total > 0,
      );
  }, [
    students,
    billingByStudent,
    invoicedSet,
    sponteFaturadosSet,
    schoolIdToName,
    canFaturar,
    calcReady,
  ]);

  const faturarTodos = useMutation({
    mutationFn: async () => {
      let sucesso = 0;
      let jaFaturado = 0;
      const falhas: string[] = [];
      // Sequencial de propósito: evita rajada de chamadas simultâneas ao Sponte.
      for (const { s, unidade, total } of faturaveis) {
        try {
          const res = await faturarTodosFn({
            data: {
              unidade: unidade as string,
              studentId: s.studentId,
              schoolId: s.schoolId,
              sponteAlunoId: s.sponteAlunoId as string,
              valor: total,
              weekStart: weekStartYMD,
              weekEnd: weekEndYMD,
              vencimento: vencimentoFaturamento,
            },
          });
          if (!res.ok) falhas.push(s.name);
          else if (res.jaFaturado) jaFaturado += 1;
          else sucesso += 1;
        } catch {
          falhas.push(s.name);
        }
      }
      return { sucesso, jaFaturado, falhas };
    },
    onSuccess: ({ sucesso, jaFaturado, falhas }) => {
      void qc.invalidateQueries({ queryKey: ["colonia_invoices"] });
      // Dá baixa imediata nos avisos de fechamento pendente do sininho.
      void qc.invalidateQueries({ queryKey: ["colonia_pendencias_semana"] });
      if (falhas.length === 0) setLoteConcluidoWeek(weekStartYMD);
      setLoteOpen(false);
      setLoteDuplicados(null);
      const partes = [`${sucesso} faturado(s) com sucesso`];
      if (jaFaturado > 0) partes.push(`${jaFaturado} já estava(m) faturado(s)`);
      const resumo = `Faturamento em lote concluído: ${partes.join(", ")}.`;
      if (falhas.length > 0) {
        toast.warning(resumo, {
          description: `Falha em ${falhas.length}: ${falhas.join(", ")}`,
        });
      } else {
        toast.success(resumo);
      }
    },
    onError: (e: unknown) => {
      toast.error("Erro no faturamento em lote", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    },
  });

  // Antes de faturar, checa no Sponte se algum aluno do lote já tem título de
  // Colônia com essa mesma data de vencimento. Se houver, para no passo de
  // confirmação; se não, dispara o lote direto.
  const checarDuplicidade = useMutation({
    mutationFn: async () => {
      const res = await checarDuplicidadeFn({
        data: {
          vencimento: vencimentoFaturamento,
          itens: faturaveis.map(({ s, unidade }) => ({
            unidade: unidade as string,
            sponteAlunoId: s.sponteAlunoId as string,
            studentName: s.name,
          })),
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Falha ao verificar duplicidade.");
      return res.duplicados;
    },
    onSuccess: (dups) => {
      if (dups.length > 0) setLoteDuplicados(dups);
      else faturarTodos.mutate();
    },
    onError: (e: unknown) => {
      toast.error("Erro ao verificar duplicidade", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    },
  });

  const loteBusy = checarDuplicidade.isPending || faturarTodos.isPending;

  // Trava global: com todos os alunos faturáveis resolvidos, o lote da semana
  // está fechado. O flag local cobre a janela entre o retorno do Sponte e o
  // refetch dos faturamentos; qualquer aluno que volte a ficar pendente
  // (desvinculado, título excluído no Sponte, valor alterado) reabre o botão.
  useEffect(() => {
    if (faturaveis.length > 0) setLoteConcluidoWeek(null);
  }, [faturaveis.length]);

  const faturamentoConcluido =
    canFaturar &&
    (loteConcluidoWeek === weekStartYMD ||
      (calcReady &&
        faturaveis.length === 0 &&
        (invoices.length > 0 || sponteFaturadosSet.size > 0)));

  const abrirLote = () => {
    setLoteDuplicados(null);
    setLoteOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-2.5">
        <button
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          aria-label="Semana anterior"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{weekLabel}</span>
          {isCurrentWeek && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              Semana atual
            </span>
          )}
        </div>
        <button
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          disabled={isCurrentWeek}
          aria-label="Próxima semana"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {canFaturar && students.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
          <div className="space-y-1.5">
            <Label htmlFor="venc-faturamento">Data de Vencimento do Faturamento</Label>
            <Input
              id="venc-faturamento"
              type="date"
              required
              value={vencimentoFaturamento}
              onChange={(e) => setVencimentoFaturamento(e.target.value)}
              disabled={loteBusy}
              aria-invalid={!vencimentoFaturamento}
            />
            <p className="text-[11px] text-muted-foreground">
              Vencimento usado ao faturar no Sponte e para conferir se o título já existe. O aluno
              conta como faturado quando há boleto de Colônia de Férias com esta data — independente
              do status (aberto, registrado, pago, remessa gerada).
            </p>
          </div>

          {faturamentoConcluido ? (
            <Button
              disabled
              variant="outline"
              className="w-full border-emerald-500/40 text-emerald-600 disabled:opacity-100 dark:text-emerald-400"
              title="Todos os alunos desta semana já foram faturados ou resolvidos"
            >
              <CheckCircle2 className="h-4 w-4" /> Faturamento Concluído
            </Button>
          ) : (
            <Button
              onClick={abrirLote}
              disabled={!calcReady || faturaveis.length === 0 || !vencimentoFaturamento}
              className="w-full"
              title={
                !vencimentoFaturamento
                  ? "Informe a Data de Vencimento do Faturamento"
                  : faturaveis.length === 0
                    ? "Nenhum aluno pendente para faturar nesta semana"
                    : undefined
              }
            >
              <Receipt className="h-4 w-4" /> Faturar Todos no Sponte
              {faturaveis.length > 0 ? ` (${faturaveis.length})` : ""}
            </Button>
          )}
        </div>
      )}

      <Dialog open={loteOpen} onOpenChange={(v) => (loteBusy ? null : setLoteOpen(v))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Faturar Todos no Sponte</DialogTitle>
          </DialogHeader>

          {loteDuplicados && loteDuplicados.length > 0 ? (
            <>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">
                      Já identificamos boletos de Colônia de Férias com vencimento nesta data.
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Aluno(s): {loteDuplicados.join(", ")}.
                    </p>
                    <p className="mt-2">
                      Tem certeza que deseja faturar novamente e gerar cobranças duplicadas?
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setLoteOpen(false)}
                  disabled={faturarTodos.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => faturarTodos.mutate()}
                  disabled={faturarTodos.isPending}
                >
                  {faturarTodos.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Faturando…
                    </>
                  ) : (
                    "Faturar mesmo assim"
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {faturaveis.length} aluno(s) pendente(s) serão faturados no Sponte. Alunos já
                  faturados ou marcados como acordo manual são ignorados.
                </p>
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 p-3 text-sm">
                  <span className="text-muted-foreground">Data de Vencimento do Faturamento</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {fmtYMD(vencimentoFaturamento)}
                  </span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setLoteOpen(false)} disabled={loteBusy}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => checarDuplicidade.mutate()}
                  disabled={loteBusy || !vencimentoFaturamento}
                >
                  {faturarTodos.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Faturando…
                    </>
                  ) : checarDuplicidade.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
                    </>
                  ) : (
                    <>
                      <Receipt className="h-4 w-4" /> Faturar Todos
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {!sponteActive && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Fora de Julho/Dezembro: os consumos são cobrados 100%, sem crédito ou isenção do Sponte.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : students.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <CalendarRange className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum registro nesta semana para a unidade selecionada.
          </p>
        </div>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {students.map((s) => {
            const billing =
              billingByStudent.get(s.studentId) ??
              computeWeekBilling({
                days: COLONIA_WEEKDAYS.map((d) =>
                  computeDayBilling(s.byDay[d.weekday], d.weekday, new Set()),
                ),
                permanenciaSemanasAnteriores: 0,
                creditoHoraExtra: 0,
              });
            const calculando = sponteActive && beneficiosLoading;
            const pendDias = pendenciasByStudent.get(s.studentId);

            return (
              <AccordionItem
                key={s.studentId}
                value={s.studentId}
                className="overflow-hidden rounded-2xl border border-border bg-card px-3"
              >
                <AccordionTrigger className="py-3 hover:no-underline">
                  <span className="flex flex-1 items-center gap-2 pr-2">
                    <UserCircle2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {s.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.className || "Sem turma"}
                      </span>
                    </span>
                    {pendDias && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-3 w-3" />
                        {pendDias.size}{" "}
                        {pendDias.size === 1 ? "dia com pendência" : "dias com pendência"}
                      </span>
                    )}
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {calculando ? "…" : brl(billing.total)}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  {COLONIA_WEEKDAYS.map((d) => {
                    const recs = ordenarRegistrosDoDia(s.byDay[d.weekday]);
                    if (recs.length === 0) return null;
                    const pend = pendDias?.get(d.weekday);
                    return (
                      <div
                        key={d.weekday}
                        className={`rounded-xl p-2.5 ${
                          pend ? "bg-red-500/5 ring-1 ring-red-500/40" : "bg-secondary/40"
                        }`}
                      >
                        <div className="mb-1.5 flex items-center justify-between px-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {d.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {recs.length} {recs.length === 1 ? "registro" : "registros"}
                          </span>
                        </div>
                        {pend && (
                          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {labelPendenciaPortaria(pend)} — {descricaoPendenciaPortaria(pend)}
                          </div>
                        )}
                        <ul className="space-y-1.5">
                          {recs.map((rec) => {
                            const Icon = ICONS[rec.record_type];
                            return (
                              <li
                                key={rec.id}
                                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                              >
                                <Icon className="h-4 w-4 flex-shrink-0 text-primary" />
                                <span className="flex-1 text-sm font-medium text-foreground">
                                  {COLONIA_RECORD_LABEL[rec.record_type]}
                                </span>
                                {rec.record_type === "entry" || rec.record_type === "exit" ? (
                                  <span className="text-sm tabular-nums text-muted-foreground">
                                    {fmtTime(rec.occurred_at)}
                                  </span>
                                ) : (
                                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                    Realizado
                                  </span>
                                )}
                                {canEdit && (
                                  <button
                                    onClick={() => remove.mutate(rec.id)}
                                    disabled={remove.isPending}
                                    aria-label="Remover registro"
                                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}

                  <ExtratoFinanceiro billing={billing} loading={calculando} />

                  {canFaturar && (
                    <FaturarBotao
                      studentId={s.studentId}
                      schoolId={s.schoolId}
                      studentName={s.name}
                      sponteAlunoId={s.sponteAlunoId}
                      unidade={schoolIdToName.get(s.schoolId) ?? null}
                      valor={billing.total}
                      weekStartYMD={weekStartYMD}
                      weekEndYMD={weekEndYMD}
                      weekLabel={weekLabel}
                      defaultVencimento={vencimentoFaturamento || weekEndYMD}
                      jaFaturado={
                        invoicedSet.has(s.studentId) || sponteFaturadosSet.has(s.studentId)
                      }
                      manualSettled={manualSet.has(s.studentId)}
                      disabled={calculando}
                      onFaturado={() => {
                        void qc.invalidateQueries({ queryKey: ["colonia_invoices"] });
                        void qc.invalidateQueries({ queryKey: ["colonia_pendencias_semana"] });
                      }}
                    />
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

function ExtratoFinanceiro({ billing, loading }: { billing: WeekBilling; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Wallet className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Extrato Financeiro
        </span>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {billing.rubricas.map((r, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-foreground">{r.label}</span>
                <span className="tabular-nums text-muted-foreground">{brl(r.valor)}</span>
              </li>
            ))}
          </ul>

          {billing.isencoes.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-dashed border-border pt-2 text-sm">
              {billing.isencoes.map((iso, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-emerald-600 dark:text-emerald-400">{iso}</span>
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                    {brl(0)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {billing.credito && (
            <div className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2.5 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-300">
                <Info className="h-3.5 w-3.5" />
                Transparência de Crédito (Hora Extra)
              </div>
              <ul className="space-y-0.5 text-sky-800 dark:text-sky-200">
                <li className="flex justify-between">
                  <span>Crédito Original</span>
                  <span className="tabular-nums">{brl(billing.credito.original)}</span>
                </li>
                <li className="flex justify-between">
                  <span>Utilizado em Semanas Anteriores</span>
                  <span className="tabular-nums">
                    − {brl(billing.credito.usadoSemanasAnteriores)}
                  </span>
                </li>
                <li className="flex justify-between font-semibold">
                  <span>Restante Aplicado a Esta Semana</span>
                  <span className="tabular-nums">
                    − {brl(billing.credito.restanteAplicadoEstaSemana)}
                  </span>
                </li>
              </ul>
            </div>
          )}

          {billing.avisos.map((a, i) => (
            <p
              key={i}
              className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
            >
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
              {a}
            </p>
          ))}

          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <span className="text-sm font-bold text-foreground">Valor Total a Faturar</span>
            <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {brl(billing.total)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

type FaturarBotaoProps = {
  studentId: string;
  schoolId: string;
  studentName: string;
  sponteAlunoId: string | null;
  unidade: string | null;
  valor: number;
  weekStartYMD: string;
  weekEndYMD: string;
  weekLabel: string;
  defaultVencimento: string;
  jaFaturado: boolean;
  manualSettled: boolean;
  disabled: boolean;
  onFaturado: () => void;
};

function FaturarBotao({
  studentId,
  schoolId,
  studentName,
  sponteAlunoId,
  unidade,
  valor,
  weekStartYMD,
  weekEndYMD,
  weekLabel,
  defaultVencimento,
  jaFaturado,
  manualSettled,
  disabled,
  onFaturado,
}: FaturarBotaoProps) {
  const faturarFn = useServerFn(faturarColoniaSponte);
  const desvincularFn = useServerFn(desvincularFaturamentoColonia);
  const acordoFn = useServerFn(marcarAcordoManualColonia);
  const [open, setOpen] = useState(false);
  const [forcarModo, setForcarModo] = useState(false);
  const [vencimento, setVencimento] = useState(defaultVencimento);
  const [faturado, setFaturado] = useState(false);
  const [acordoLocal, setAcordoLocal] = useState(false);
  const [acordoOpen, setAcordoOpen] = useState(false);

  const unidadeValida = !!unidade && UNIDADES_SPONTE.includes(unidade);
  const podeFaturar = !!sponteAlunoId && unidadeValida && valor > 0;

  const faturar = useMutation({
    mutationFn: async (forcar: boolean) => {
      const res = await faturarFn({
        data: {
          unidade: unidade as string,
          studentId,
          schoolId,
          sponteAlunoId: sponteAlunoId as string,
          valor,
          weekStart: weekStartYMD,
          weekEnd: weekEndYMD,
          vencimento,
          forcar,
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Falha ao faturar no Sponte.");
      return res;
    },
    onSuccess: (res) => {
      setFaturado(true);
      setAcordoLocal(false);
      setOpen(false);
      setForcarModo(false);
      toast.success(
        res.jaFaturado
          ? "Este aluno já estava faturado nesta semana."
          : "Faturado com sucesso no Sponte",
      );
      onFaturado();
    },
    onError: (e: unknown) => {
      toast.error("Erro ao faturar", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    },
  });

  const desvincular = useMutation({
    mutationFn: async () => {
      const res = await desvincularFn({
        data: { unidade: unidade ?? "", studentId, weekStart: weekStartYMD },
      });
      if (!res.ok) throw new Error(res.error ?? "Falha ao desvincular o faturamento.");
      return res;
    },
    onSuccess: () => {
      setFaturado(false);
      setAcordoLocal(false);
      toast.success("Registro liberado. Você pode faturar novamente.");
      onFaturado();
    },
    onError: (e: unknown) => {
      toast.error("Erro ao desvincular", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    },
  });

  const acordo = useMutation({
    mutationFn: async () => {
      const res = await acordoFn({
        data: {
          unidade: unidade ?? "",
          studentId,
          schoolId,
          sponteAlunoId,
          valor,
          weekStart: weekStartYMD,
          weekEnd: weekEndYMD,
        },
      });
      if (!res.ok) throw new Error(res.error ?? "Falha ao marcar como já lançado.");
      return res;
    },
    onSuccess: () => {
      setAcordoLocal(true);
      setAcordoOpen(false);
      toast.success("Marcado como já lançado / acordo manual.");
      onFaturado();
    },
    onError: (e: unknown) => {
      toast.error("Erro ao marcar como já lançado", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    },
  });

  const abrirDialogo = (forcar: boolean) => {
    setForcarModo(forcar);
    setVencimento(defaultVencimento);
    setOpen(true);
  };

  const resolvidoManual = (manualSettled || acordoLocal) && !faturado;

  const dialogoFaturamento = (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (faturar.isPending) return;
        setOpen(v);
        if (!v) setForcarModo(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {forcarModo ? "Forçar Faturamento Manual" : "Faturar no Sponte"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {forcarModo && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Este aluno já consta como resolvido nesta semana. Um novo título será gerado no
                Sponte e substituirá o vínculo atual — use apenas se a cobrança anterior foi
                excluída ou cancelada lá.
              </span>
            </div>
          )}
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
            <div className="font-semibold text-foreground">{studentName}</div>
            <div className="text-muted-foreground">Semana de {weekLabel}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Valor total</span>
              <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {brl(valor)}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`venc-${studentId}`}>Data de Vencimento</Label>
            <Input
              id={`venc-${studentId}`}
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={faturar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => faturar.mutate(forcarModo)}
            disabled={faturar.isPending || !vencimento}
            variant={forcarModo ? "destructive" : "default"}
          >
            {faturar.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Faturando…
              </>
            ) : forcarModo ? (
              "Forçar Faturamento"
            ) : (
              "Confirmar Faturamento"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (jaFaturado || faturado || manualSettled || acordoLocal) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled
            className={
              resolvidoManual
                ? "flex-1 border-sky-500/40 text-sky-600 dark:text-sky-400"
                : "flex-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
            }
          >
            {resolvidoManual ? (
              <>
                <Handshake className="h-4 w-4" /> Já lançado / Acordo manual
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Faturado
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => desvincular.mutate()}
            disabled={desvincular.isPending}
            title={
              resolvidoManual
                ? "Desfazer acordo manual (voltar para pendente)"
                : "Desfazer faturamento (liberar para refaturar)"
            }
            aria-label="Desfazer"
          >
            {desvincular.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Rota de escape da trava global: refatura só este aluno (ex.: título
            excluído por engano direto no Sponte). */}
        <button
          type="button"
          onClick={() => abrirDialogo(true)}
          disabled={!podeFaturar || disabled || faturar.isPending}
          title={
            !sponteAlunoId
              ? "Aluno sem vínculo com o Sponte"
              : !unidadeValida
                ? "Selecione uma unidade com integração Sponte"
                : "Gera um novo título no Sponte para este aluno, ignorando a trava"
          }
          className="w-full text-center text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Forçar Faturamento Manual
        </button>

        {dialogoFaturamento}
      </div>
    );
  }

  return (
    <>
      <Button
        onClick={() => abrirDialogo(false)}
        disabled={!podeFaturar || disabled}
        className="mt-2 w-full"
        title={
          !sponteAlunoId
            ? "Aluno sem vínculo com o Sponte"
            : !unidadeValida
              ? "Selecione uma unidade com integração Sponte"
              : undefined
        }
      >
        <Receipt className="h-4 w-4" /> Faturar no Sponte
      </Button>

      <button
        type="button"
        onClick={() => setAcordoOpen(true)}
        disabled={disabled || acordo.isPending}
        className="mt-1.5 w-full text-center text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        Marcar como Já Lançado / Acordo Manual
      </button>

      <Dialog open={acordoOpen} onOpenChange={(v) => (acordo.isPending ? null : setAcordoOpen(v))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como já lançado / acordo manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="font-semibold text-foreground">{studentName}</div>
              <div className="text-muted-foreground">Semana de {weekLabel}</div>
            </div>
            <p className="text-muted-foreground">
              Isso resolve o fechamento desta semana{" "}
              <strong className="text-foreground">sem faturar no Sponte</strong> e remove o aluno da
              lista de pendências. Use quando o valor foi negociado ou lançado manualmente com o
              responsável.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAcordoOpen(false)}
              disabled={acordo.isPending}
            >
              Cancelar
            </Button>
            <Button onClick={() => acordo.mutate()} disabled={acordo.isPending}>
              {acordo.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Salvando…
                </>
              ) : (
                "Confirmar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialogoFaturamento}
    </>
  );
}
