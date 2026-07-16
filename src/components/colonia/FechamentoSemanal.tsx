import { useMemo, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/lib/app-context";
import { Skeleton } from "@/components/ui/skeleton";
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
  firstOfMonth,
  fmtDayMonth,
  fmtTime,
  mondayOf,
  type ColoniaRecord,
  type ColoniaRecordType,
  type ColoniaStudentWeek,
} from "@/lib/colonia";
import {
  computeDayBilling,
  computeWeekBilling,
  computeWeekPermanencia,
  sponteAtivoNoMes,
  type WeekBilling,
} from "@/lib/colonia-billing";
import { fetchColoniaBeneficios } from "@/lib/sponte.functions";

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
};

export function FechamentoSemanal({ schoolFilterIds, canEdit }: Props) {
  const qc = useQueryClient();
  const { schools } = useSchool();
  const beneficiosFn = useServerFn(fetchColoniaBeneficios);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

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
  const { data: prevPermByStudent = {} } = useQuery({
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
      const schoolIdToName = new Map(schools.map((s) => [s.id, s.name]));
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

  const weekLabel = useMemo(
    () => `${fmtDayMonth(weekStart)} – ${fmtDayMonth(friday)}`,
    [weekStart, friday],
  );

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
            const benefit =
              sponteActive && s.sponteAlunoId ? beneficios[s.sponteAlunoId] : undefined;
            const exemptions = new Set<ColoniaRecordType>(
              (benefit?.refeicoesIsentas ?? []) as ColoniaRecordType[],
            );
            const days = COLONIA_WEEKDAYS.map((d) =>
              computeDayBilling(s.byDay[d.weekday], d.weekday, exemptions),
            );
            const billing = computeWeekBilling({
              days,
              permanenciaSemanasAnteriores: prevPermByStudent[s.studentId] ?? 0,
              creditoHoraExtra: sponteActive ? (benefit?.creditoHoraExtra ?? 0) : 0,
            });
            const calculando = sponteActive && beneficiosLoading;

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
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {calculando ? "…" : brl(billing.total)}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  {COLONIA_WEEKDAYS.map((d) => {
                    const recs = s.byDay[d.weekday];
                    if (recs.length === 0) return null;
                    return (
                      <div key={d.weekday} className="rounded-xl bg-secondary/40 p-2.5">
                        <div className="mb-1.5 flex items-center justify-between px-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {d.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {recs.length} {recs.length === 1 ? "registro" : "registros"}
                          </span>
                        </div>
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
                                <span className="text-sm tabular-nums text-muted-foreground">
                                  {fmtTime(rec.occurred_at)}
                                </span>
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
