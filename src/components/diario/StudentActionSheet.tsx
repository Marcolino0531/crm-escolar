import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadKeychainPdf, sanitizeFileName } from "@/lib/diario-keychain";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Coffee,
  Sun,
  Cookie,
  Moon,
  LogIn,
  AlertTriangle,
  Settings2,
  UserCircle2,
  QrCode,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { PlanEditor } from "@/components/diario/PlanEditor";
import {
  MEALS,
  isCoveredToday,
  checkSchedule,
  type DiarioStudent,
  type MealKey,
} from "@/lib/diario";

const ICONS: Record<MealKey, React.ComponentType<{ className?: string }>> = {
  breakfast: Coffee,
  lunch: Sun,
  snack: Cookie,
  dinner: Moon,
};

type Props = {
  student: DiarioStudent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

type Pending = { key: MealKey | "checkinout"; label: string; charge: boolean };

export function StudentActionSheet({ student, open, onOpenChange, canEdit }: Props) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const userId = session?.user?.id;
  const [pending, setPending] = useState<Pending | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState(false);

  const handleKeychain = async () => {
    if (!student) return;
    setDownloadingKey(true);
    try {
      await downloadKeychainPdf(
        [{ id: student.id, name: student.name, className: student.className }],
        `chaveiro_${sanitizeFileName(student.name)}.pdf`,
      );
    } catch (e) {
      toast.error("Erro ao gerar o chaveiro", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setDownloadingKey(false);
    }
  };

  const register = useMutation({
    mutationFn: async (p: Pending) => {
      if (!student) throw new Error("Aluno não selecionado");
      if (!userId) throw new Error("Sessão expirada");
      const isMeal = p.key !== "checkinout";
      const { error } = await supabase.from("diario_events" as never).insert({
        student_id: student.id,
        recorded_by: userId,
        event_type: isMeal ? "meal" : "checkinout",
        meal: isMeal ? (p.key as MealKey) : null,
        label: p.label,
        extra_charge: p.charge,
        reason: p.charge
          ? isMeal
            ? "Sem plano contratado para esta refeição hoje"
            : "Fora do horário contratado"
          : null,
      } as never);
      if (error) throw error;
      return p;
    },
    onSuccess: (p) => {
      const isMeal = p.key !== "checkinout";
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const detalhe = isMeal ? "Realizado" : hora;
      toast.success(`${p.label} registrado`, {
        description: `${student?.name} • ${detalhe}${p.charge ? " • Cobrança extra gerada" : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["diario_extra_events"] });
      setPending(null);
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao registrar", { description: msg });
      setPending(null);
    },
  });

  if (!student) return null;

  const handleMeal = (meal: MealKey, label: string) => {
    if (!canEdit) {
      toast.error("Você não tem permissão para registrar consumos.");
      return;
    }
    const covered = isCoveredToday(student.plan, meal);
    if (!covered) {
      setPending({ key: meal, label, charge: true });
      return;
    }
    register.mutate({ key: meal, label, charge: false });
  };

  const sched = checkSchedule(student.schedule);
  const scheduleExtra = !sched.withinSchedule;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl border-t-0 p-0"
        >
          <SheetHeader className="px-5 pb-2 pt-5">
            <div className="flex items-center gap-3">
              {student.photo ? (
                <img
                  src={student.photo}
                  alt={student.name}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/20"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary ring-2 ring-primary/20">
                  <UserCircle2 className="h-7 w-7 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 text-left">
                <SheetTitle className="text-lg leading-tight">{student.name}</SheetTitle>
                <p className="text-sm text-muted-foreground">{student.className || "Sem turma"}</p>
              </div>
              {canEdit && (
                <button
                  onClick={() => setEditingPlan(true)}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:border-primary/40"
                  aria-label="Editar plano"
                >
                  <Settings2 className="h-4 w-4" />
                  Plano
                </button>
              )}
            </div>
          </SheetHeader>

          <div className="grid gap-2.5 p-5 pb-8 pt-4">
            {MEALS.map((meal) => {
              const Icon = ICONS[meal.key];
              const covered = isCoveredToday(student.plan, meal.key);
              return (
                <button
                  key={meal.key}
                  onClick={() => handleMeal(meal.key, meal.label)}
                  disabled={register.isPending}
                  className={[
                    "flex h-16 w-full items-center gap-4 rounded-2xl px-5 text-left text-base font-semibold transition-all active:scale-[0.98] disabled:opacity-60",
                    covered
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-amber-500 text-white shadow-sm",
                  ].join(" ")}
                >
                  <Icon className="h-6 w-6 flex-shrink-0" />
                  <div className="flex flex-1 flex-col leading-tight">
                    <span>Registrar {meal.label}</span>
                    <span className="text-[11px] font-medium uppercase tracking-wide opacity-90">
                      {covered ? "Plano contratado" : "Sem plano · cobrança extra"}
                    </span>
                  </div>
                </button>
              );
            })}

            <button
              onClick={() => {
                if (!canEdit) {
                  toast.error("Você não tem permissão para registrar consumos.");
                  return;
                }
                if (scheduleExtra) {
                  setPending({ key: "checkinout", label: "Entrada / Saída", charge: true });
                } else {
                  register.mutate({ key: "checkinout", label: "Entrada / Saída", charge: false });
                }
              }}
              disabled={register.isPending}
              className={[
                "mt-1 flex h-16 w-full items-center gap-4 rounded-2xl px-5 text-left text-base font-semibold transition-all active:scale-[0.98] disabled:opacity-60",
                scheduleExtra
                  ? "bg-amber-500 text-white shadow-sm"
                  : "border border-border bg-card text-foreground hover:border-primary/40",
              ].join(" ")}
            >
              <LogIn
                className={["h-6 w-6 flex-shrink-0", scheduleExtra ? "" : "text-primary"].join(" ")}
              />
              <div className="flex flex-1 flex-col leading-tight">
                <span>Registrar Entrada / Saída</span>
                <span className="text-[11px] font-medium uppercase tracking-wide opacity-90">
                  {sched.hasSchedule
                    ? scheduleExtra
                      ? `Fora do horário (${sched.today?.entry}–${sched.today?.exit}) · hora extra`
                      : `Dentro do horário (${sched.today?.entry}–${sched.today?.exit})`
                    : "Sem horário hoje · hora extra"}
                </span>
              </div>
            </button>

            <button
              onClick={handleKeychain}
              disabled={downloadingKey}
              className="mt-1 flex h-14 w-full items-center gap-4 rounded-2xl border border-border bg-card px-5 text-left text-sm font-semibold text-foreground transition-all hover:border-primary/40 active:scale-[0.98] disabled:opacity-60"
            >
              {downloadingKey ? (
                <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-primary" />
              ) : (
                <QrCode className="h-5 w-5 flex-shrink-0 text-primary" />
              )}
              <div className="flex flex-1 flex-col leading-tight">
                <span>Baixar Chaveiro (PDF)</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  6×4 cm · dobra ao meio · QR + nome
                </span>
              </div>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            </div>
            <AlertDialogTitle className="text-center">Cobrança extra</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              <strong className="text-foreground">{student.name}</strong> não tem{" "}
              <strong className="text-foreground">{pending?.label}</strong> contratado para este
              momento. Registrar agora gerará uma cobrança extra para a família. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              onClick={() => pending && register.mutate(pending)}
              className="h-12 w-full rounded-xl bg-amber-500 text-white hover:bg-amber-500/95"
            >
              Confirmar e registrar
            </AlertDialogAction>
            <AlertDialogCancel className="h-12 w-full rounded-xl">Cancelar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canEdit && <PlanEditor student={student} open={editingPlan} onOpenChange={setEditingPlan} />}
    </>
  );
}
