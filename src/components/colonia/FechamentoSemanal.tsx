import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  fmtDayMonth,
  fmtTime,
  mondayOf,
  type ColoniaRecord,
  type ColoniaRecordType,
  type ColoniaStudentWeek,
} from "@/lib/colonia";

const ICONS: Record<ColoniaRecordType, React.ComponentType<{ className?: string }>> = {
  breakfast: Coffee,
  lunch: Sun,
  snack: Cookie,
  dinner: Moon,
  entry: LogIn,
  exit: LogOut,
};

type EmbeddedStudent = { name: string; class_name: string };

type RawRow = {
  id: string;
  student_id: string;
  record_type: ColoniaRecordType;
  occurred_at: string;
  diario_students: EmbeddedStudent | EmbeddedStudent[] | null;
};

function pickStudent(s: RawRow["diario_students"]): EmbeddedStudent | null {
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

type Props = {
  schoolFilterIds: string[] | null;
  canEdit: boolean;
};

export function FechamentoSemanal({ schoolFilterIds, canEdit }: Props) {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

  const rangeStart = weekStart;
  const rangeEndExclusive = addDays(weekStart, 5); // sábado 00:00 → cobre seg–sex
  const friday = addDays(weekStart, 4);
  const isCurrentWeek = weekStart.getTime() >= mondayOf(new Date()).getTime();

  const schoolKey = schoolFilterIds ? schoolFilterIds.join(",") : "all";
  const { data: students = [], isLoading } = useQuery({
    queryKey: ["colonia_closing", schoolKey, weekStart.toISOString()],
    queryFn: async () => {
      let q = supabase
        .from("holiday_camp_records" as never)
        .select("id, student_id, record_type, occurred_at, diario_students(name, class_name)")
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
          {students.map((s) => (
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
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {s.total} {s.total === 1 ? "registro" : "registros"}
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
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
