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
  LogOut,
  AlertTriangle,
  Settings2,
  UserCircle2,
  QrCode,
  Loader2,
  Camera,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { PlanEditor } from "@/components/diario/PlanEditor";
import { StudentPhotoDialog } from "@/components/diario/StudentPhotoDialog";
import {
  MEALS,
  isCoveredToday,
  type DiarioStudent,
  type MealKey,
  type Weekday,
} from "@/lib/diario";
import {
  ROTULO_DIRECAO,
  TOLERANCIA_ENTRADA_MIN,
  TOLERANCIA_SAIDA_MIN,
  avaliarRegistro,
  formatarMinutos,
  type DirecaoRegistro,
} from "@/lib/diario-hora-extra";

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
  // Ano do plano exibido/editado; o registro diário só é permitido no vigente.
  anoLetivo: number;
  anoVigente: number | null;
};

type Pending =
  | { key: MealKey; label: string; charge: boolean }
  | {
      key: "checkinout";
      direcao: DirecaoRegistro;
      label: string;
      charge: boolean;
      minutos: number | null;
      motivo: string | null;
    };

export function StudentActionSheet({
  student,
  open,
  onOpenChange,
  canEdit,
  anoLetivo,
  anoVigente,
}: Props) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const userId = session?.user?.id;
  const [pending, setPending] = useState<Pending | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState(false);
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
      const row =
        p.key === "checkinout"
          ? {
              student_id: student.id,
              recorded_by: userId,
              event_type: "checkinout",
              meal: null,
              direction: p.direcao,
              label: p.label,
              extra_charge: p.charge,
              extra_minutes: p.minutos,
              reason: p.motivo,
            }
          : {
              student_id: student.id,
              recorded_by: userId,
              event_type: "meal",
              meal: p.key,
              label: p.label,
              extra_charge: p.charge,
              reason: p.charge ? "Sem plano contratado para esta refeição hoje" : null,
            };
      const { error } = await supabase.from("diario_events" as never).insert(row as never);
      if (error) throw error;
      return p;
    },
    onSuccess: (p) => {
      const isMeal = p.key !== "checkinout";
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const detalhe = isMeal ? "Realizado" : hora;
      const extra =
        p.key === "checkinout"
          ? p.minutos
            ? ` • Hora extra: ${formatarMinutos(p.minutos)}`
            : p.charge
              ? " • Sem horário contratado hoje"
              : " • Dentro da tolerância"
          : p.charge
            ? " • Cobrança extra gerada"
            : "";
      toast.success(`${p.label} ${isMeal ? "registrado" : "registrada"}`, {
        description: `${student?.name} • ${detalhe}${extra}`,
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

  // O registro do dia a dia cobra pelo plano do ano vigente; em outro ano a tela
  // é só consulta/edição do plano.
  const registroPermitido = anoVigente === null || anoLetivo === anoVigente;

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

  const hoje = student.schedule[new Date().getDay() as Weekday];

  const handlePonta = (direcao: DirecaoRegistro) => {
    if (!canEdit) {
      toast.error("Você não tem permissão para registrar consumos.");
      return;
    }
    const av = avaliarRegistro(student.schedule, direcao, new Date());
    const p: Pending = {
      key: "checkinout",
      direcao,
      label: ROTULO_DIRECAO[direcao],
      charge: av.cobra,
      minutos: av.minutos,
      motivo: av.motivo,
    };
    if (av.cobra) setPending(p);
    else register.mutate(p);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl border-t-0 p-0"
        >
          <SheetHeader className="px-5 pb-2 pt-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => canEdit && setEditingPhoto(true)}
                disabled={!canEdit}
                aria-label={canEdit ? "Editar foto do aluno" : undefined}
                className="group relative h-12 w-12 shrink-0 rounded-full disabled:cursor-default"
              >
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
                {canEdit && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100">
                    <Camera className="h-5 w-5 text-white" />
                  </span>
                )}
              </button>
              <div className="flex-1 text-left">
                <SheetTitle className="text-lg leading-tight">{student.name}</SheetTitle>
                <p className="text-sm text-muted-foreground">{student.className || "Sem turma"}</p>
              </div>
              {canEdit && (
                <button
                  onClick={() => setEditingPhoto(true)}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground transition hover:border-primary/40"
                  aria-label="Editar foto"
                >
                  <Camera className="h-4 w-4" />
                  Foto
                </button>
              )}
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
            {!registroPermitido && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                Plano de {anoLetivo} em consulta. O registro de refeições e entrada/saída usa sempre
                o ano vigente ({anoVigente}).
              </p>
            )}
            {MEALS.map((meal) => {
              const Icon = ICONS[meal.key];
              const covered = isCoveredToday(student.plan, meal.key);
              return (
                <button
                  key={meal.key}
                  onClick={() => handleMeal(meal.key, meal.label)}
                  disabled={register.isPending || !registroPermitido}
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

            <div className="mt-1 grid grid-cols-2 gap-2.5">
              <button
                onClick={() => handlePonta("entrada")}
                disabled={register.isPending || !registroPermitido}
                className="flex h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-base font-semibold text-foreground transition-all hover:border-primary/40 active:scale-[0.98] disabled:opacity-60"
              >
                <LogIn className="h-6 w-6 flex-shrink-0 text-primary" />
                <div className="flex flex-1 flex-col leading-tight">
                  <span>Registrar Entrada</span>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {hoje
                      ? `Contratada ${hoje.entry} · ${TOLERANCIA_ENTRADA_MIN} min de tolerância`
                      : "Sem horário hoje · hora extra"}
                  </span>
                </div>
              </button>
              <button
                onClick={() => handlePonta("saida")}
                disabled={register.isPending || !registroPermitido}
                className="flex h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-base font-semibold text-foreground transition-all hover:border-primary/40 active:scale-[0.98] disabled:opacity-60"
              >
                <LogOut className="h-6 w-6 flex-shrink-0 text-primary" />
                <div className="flex flex-1 flex-col leading-tight">
                  <span>Registrar Saída</span>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {hoje
                      ? `Contratada ${hoje.exit} · ${TOLERANCIA_SAIDA_MIN} min de tolerância`
                      : "Sem horário hoje · hora extra"}
                  </span>
                </div>
              </button>
            </div>
            <p className="px-1 text-[11px] text-muted-foreground">
              Registre só a ponta que aconteceu fora do combinado. O que não for registrado vale
              como no horário contratado.
            </p>

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
            <AlertDialogTitle className="text-center">
              {pending?.key === "checkinout" ? "Hora extra" : "Cobrança extra"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {pending?.key === "checkinout" ? (
                <>
                  <strong className="text-foreground">{pending.label}</strong> de{" "}
                  <strong className="text-foreground">{student.name}</strong>:{" "}
                  {pending.minutos === null
                    ? "não há horário contratado hoje, então a duração da hora extra terá que ser conferida manualmente."
                    : `${formatarMinutos(pending.minutos)} de hora extra além da tolerância.`}{" "}
                  Registrar agora gerará cobrança para a família. Deseja continuar?
                </>
              ) : (
                <>
                  <strong className="text-foreground">{student.name}</strong> não tem{" "}
                  <strong className="text-foreground">{pending?.label}</strong> contratado para este
                  momento. Registrar agora gerará uma cobrança extra para a família. Deseja
                  continuar?
                </>
              )}
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

      {canEdit && (
        <PlanEditor
          student={student}
          open={editingPlan}
          onOpenChange={setEditingPlan}
          anoLetivo={anoLetivo}
        />
      )}
      {canEdit && (
        <StudentPhotoDialog student={student} open={editingPhoto} onOpenChange={setEditingPhoto} />
      )}
    </>
  );
}
