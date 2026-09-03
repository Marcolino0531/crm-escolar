import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  MEALS,
  WEEKDAYS,
  DEFAULT_DAY,
  emptyPlan,
  groupMealPlans,
  mealPlanToRows,
  scheduleToRows,
  type DiarioStudent,
  type MealPlanRow,
  type MealKey,
  type MealPlan,
  type Weekday,
  type SchedulePlan,
} from "@/lib/diario";

type Props = {
  student: DiarioStudent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PlanEditor({ student, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MealPlan>(student.plan);
  const [scheduleDraft, setScheduleDraft] = useState<SchedulePlan>(student.schedule);

  useEffect(() => {
    if (open) {
      setDraft(student.plan);
      setScheduleDraft(student.schedule);
    }
  }, [open, student.plan, student.schedule]);

  const toggle = (meal: MealKey, day: Weekday) => {
    setDraft((p) => ({
      ...p,
      [meal]: p[meal].includes(day) ? p[meal].filter((d) => d !== day) : [...p[meal], day],
    }));
  };

  const toggleDayEnabled = (day: Weekday, enabled: boolean) => {
    setScheduleDraft((s) => ({ ...s, [day]: enabled ? (s[day] ?? DEFAULT_DAY) : null }));
  };

  const setTime = (day: Weekday, field: "entry" | "exit", value: string) => {
    setScheduleDraft((s) => {
      const current = s[day] ?? DEFAULT_DAY;
      return { ...s, [day]: { ...current, [field]: value } };
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      // Refeições: substitui o conjunto do aluno.
      const { error: dErr } = await supabase
        .from("diario_meal_plans" as never)
        .delete()
        .eq("student_id", student.id);
      if (dErr) throw dErr;
      const mealRows = mealPlanToRows(student.id, draft);
      if (mealRows.length) {
        const { error } = await supabase
          .from("diario_meal_plans" as never)
          .insert(mealRows as never);
        if (error) throw error;
      }

      // Horários: substitui o conjunto do aluno.
      const { error: dsErr } = await supabase
        .from("diario_schedules" as never)
        .delete()
        .eq("student_id", student.id);
      if (dsErr) throw dsErr;
      const schedRows = scheduleToRows(student.id, scheduleDraft);
      if (schedRows.length) {
        const { error } = await supabase
          .from("diario_schedules" as never)
          .insert(schedRows as never);
        if (error) throw error;
      }

      // Confirma no banco antes de anunciar sucesso.
      const { data: saved, error: rErr } = await supabase
        .from("diario_meal_plans" as never)
        .select("student_id, meal, weekday")
        .eq("student_id", student.id);
      if (rErr) throw rErr;
      const persisted = mealPlanToRows(
        student.id,
        groupMealPlans((saved ?? []) as unknown as MealPlanRow[]).get(student.id) ?? emptyPlan(),
      );
      if (persisted.length !== mealRows.length) {
        throw new Error("O plano não foi gravado por completo. Tente novamente.");
      }
    },
    onSuccess: () => {
      toast.success("Plano atualizado", { description: student.name });
      qc.invalidateQueries({ queryKey: ["diario_students"] });
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Verifique se você tem permissão de edição.";
      toast.error("Erro ao salvar", { description: msg });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Plano de {student.name}</DialogTitle>
          <DialogDescription>
            Configure as refeições contratadas e o horário de entrada/saída por dia da semana.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="meals" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="meals">Refeições</TabsTrigger>
            <TabsTrigger value="schedule">Horários</TabsTrigger>
          </TabsList>

          <TabsContent value="meals" className="space-y-3">
            {MEALS.map((meal) => (
              <div key={meal.key} className="rounded-xl border border-border bg-card p-3">
                <p className="mb-2 text-sm font-semibold text-foreground">{meal.label}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const active = draft[meal.key].includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggle(meal.key, d.value)}
                        className={[
                          "flex h-10 items-center justify-center rounded-lg text-xs font-semibold transition",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-secondary text-muted-foreground hover:bg-secondary/70",
                        ].join(" ")}
                        aria-pressed={active}
                        aria-label={`${meal.label} ${d.long}`}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="schedule" className="space-y-2">
            <p className="px-1 text-xs text-muted-foreground">
              Chegadas antes da entrada ou saídas depois do horário gerarão cobrança de hora extra.
            </p>
            {WEEKDAYS.map((d) => {
              const day = scheduleDraft[d.value];
              const enabled = !!day;
              return (
                <div key={d.value} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{d.long}</p>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => toggleDayEnabled(d.value, v)}
                      aria-label={`Ativar ${d.long}`}
                    />
                  </div>
                  {enabled && day && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Entrada
                        </span>
                        <input
                          type="time"
                          value={day.entry}
                          onChange={(e) => setTime(d.value, "entry", e.target.value)}
                          className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Saída
                        </span>
                        <input
                          type="time"
                          value={day.exit}
                          onChange={(e) => setTime(d.value, "exit", e.target.value)}
                          className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="h-11 w-full rounded-xl sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            className="h-11 w-full rounded-xl sm:w-auto"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? "Salvando…" : "Salvar plano"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
