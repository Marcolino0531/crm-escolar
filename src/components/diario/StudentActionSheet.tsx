import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Check,
  X,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { formatDateBR, todayISOLocal } from "@/lib/date-utils";
import {
  dataInicialDoModal,
  diaDaSemana,
  ehHoje,
  horaSugerida,
  instanteDaPonta,
  instanteDaRefeicao,
  intervaloDoDia,
  podeExcluirRegistro,
} from "@/lib/diario-registro-retroativo";
import { PlanEditor } from "@/components/diario/PlanEditor";
import { StudentPhotoDialog } from "@/components/diario/StudentPhotoDialog";
import { MEALS, isCoveredToday, type DiarioStudent, type MealKey } from "@/lib/diario";
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
  | { key: MealKey; label: string; charge: boolean; em: Date }
  | {
      key: "checkinout";
      direcao: DirecaoRegistro;
      label: string;
      charge: boolean;
      minutos: number | null;
      motivo: string | null;
      em: Date;
    };

type EventoDoDia = {
  id: string;
  event_type: "meal" | "checkinout";
  label: string;
  direction: DirecaoRegistro | null;
  extra_charge: boolean;
  extra_minutes: number | null;
  created_at: string;
  faturamento_id: string | null;
};

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

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

  // Data do registro (retroativa): padrão hoje, redefinida ao abrir o modal.
  const [selectedDate, setSelectedDate] = useState(dataInicialDoModal);
  useEffect(() => {
    if (open) setSelectedDate(dataInicialDoModal());
  }, [open, student?.id]);

  // Entrada/Saída sempre passam pelo campo de hora (sugerida = agora, editável).
  const [pontaForm, setPontaForm] = useState<DirecaoRegistro | null>(null);
  const [pontaHora, setPontaHora] = useState("");
  const [excluindo, setExcluindo] = useState<EventoDoDia | null>(null);

  const { inicio, fim } = intervaloDoDia(selectedDate);
  const { data: eventosDoDia = [], isLoading: carregandoDia } = useQuery({
    queryKey: ["diario_events_dia", student?.id ?? "none", selectedDate],
    enabled: open && !!student,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diario_events" as never)
        .select(
          "id, event_type, label, direction, extra_charge, extra_minutes, created_at, faturamento_id",
        )
        .eq("student_id", student!.id)
        .gte("created_at", inicio)
        .lte("created_at", fim)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as EventoDoDia[];
    },
  });

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
              created_at: p.em.toISOString(),
            }
          : {
              student_id: student.id,
              recorded_by: userId,
              event_type: "meal",
              meal: p.key,
              label: p.label,
              extra_charge: p.charge,
              reason: p.charge ? "Sem plano contratado para esta refeição neste dia" : null,
              created_at: p.em.toISOString(),
            };
      const { error } = await supabase.from("diario_events" as never).insert(row as never);
      if (error) throw error;
      return p;
    },
    onSuccess: (p) => {
      const isMeal = p.key !== "checkinout";
      const hora = p.em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const dia = ehHoje(selectedDate) ? "" : ` em ${formatDateBR(selectedDate)}`;
      const detalhe = (isMeal ? "Realizado" : hora) + dia;
      const extra =
        p.key === "checkinout"
          ? p.minutos
            ? ` • Hora extra: ${formatarMinutos(p.minutos)}`
            : p.charge
              ? " • Sem horário contratado neste dia"
              : " • Dentro da tolerância"
          : p.charge
            ? " • Cobrança extra gerada"
            : "";
      toast.success(`${p.label} ${isMeal ? "registrado" : "registrada"}`, {
        description: `${student?.name} • ${detalhe}${extra}`,
      });
      qc.invalidateQueries({ queryKey: ["diario_extra_events"] });
      qc.invalidateQueries({ queryKey: ["diario_events_dia"] });
      setPending(null);
      setPontaForm(null);
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao registrar", { description: msg });
      setPending(null);
    },
  });

  const excluir = useMutation({
    mutationFn: async (ev: EventoDoDia) => {
      if (!student) throw new Error("Aluno não selecionado");
      const regra = podeExcluirRegistro(ev);
      if (!regra.ok) throw new Error(regra.erro);
      const { data, error } = await supabase
        .from("diario_events" as never)
        .delete()
        .eq("id", ev.id)
        .eq("student_id", student.id)
        .is("faturamento_id", null)
        .select("id");
      if (error) throw error;
      if (!data || (data as unknown[]).length === 0) {
        throw new Error(
          "O registro não foi excluído: ele já entrou em um faturamento ou foi removido.",
        );
      }
      return ev;
    },
    onSuccess: (ev) => {
      toast.success("Registro excluído", {
        description: `${ev.label} • ${student?.name}`,
      });
      qc.invalidateQueries({ queryKey: ["diario_extra_events"] });
      qc.invalidateQueries({ queryKey: ["diario_events_dia"] });
      setExcluindo(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao excluir", { description: msg });
      setExcluindo(null);
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
    const em = instanteDaRefeicao(selectedDate);
    const covered = isCoveredToday(student.plan, meal, em);
    if (!covered) {
      setPending({ key: meal, label, charge: true, em });
      return;
    }
    register.mutate({ key: meal, label, charge: false, em });
  };

  const hojeSelecionado = ehHoje(selectedDate);
  const diaContratado = student.schedule[diaDaSemana(selectedDate)];

  const registrarPonta = (direcao: DirecaoRegistro, em: Date) => {
    const av = avaliarRegistro(student.schedule, direcao, em);
    const p: Pending = {
      key: "checkinout",
      direcao,
      label: ROTULO_DIRECAO[direcao],
      charge: av.cobra,
      minutos: av.minutos,
      motivo: av.motivo,
      em,
    };
    if (av.cobra) setPending(p);
    else register.mutate(p);
  };

  const handlePonta = (direcao: DirecaoRegistro) => {
    if (!canEdit) {
      toast.error("Você não tem permissão para registrar consumos.");
      return;
    }
    setPontaHora(horaSugerida());
    setPontaForm(direcao);
  };

  const confirmarPonta = () => {
    if (!pontaForm) return;
    const em = instanteDaPonta(selectedDate, pontaHora);
    if (!em) {
      toast.error("Horário inválido");
      return;
    }
    registrarPonta(pontaForm, em);
  };

  const handleSheetOpenChange = (v: boolean) => {
    if (!v) setPontaForm(null);
    onOpenChange(v);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
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
            <div className="rounded-2xl border border-border bg-card p-3">
              <label
                htmlFor="diario-data-registro"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Data do Registro
              </label>
              <input
                id="diario-data-registro"
                type="date"
                value={selectedDate}
                max={todayISOLocal()}
                disabled={!registroPermitido}
                onChange={(e) => {
                  setSelectedDate(e.target.value || todayISOLocal());
                  setPontaForm(null);
                }}
                className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-primary/60 disabled:opacity-60"
              />
            </div>
            {MEALS.map((meal) => {
              const Icon = ICONS[meal.key];
              const covered = isCoveredToday(
                student.plan,
                meal.key,
                instanteDaRefeicao(selectedDate),
              );
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
              {pontaForm ? (
                <div className="col-span-2 rounded-2xl border border-primary/40 bg-card p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    {pontaForm === "entrada" ? (
                      <LogIn className="h-5 w-5 flex-shrink-0 text-primary" />
                    ) : (
                      <LogOut className="h-5 w-5 flex-shrink-0 text-primary" />
                    )}
                    <span>
                      {ROTULO_DIRECAO[pontaForm]} em{" "}
                      {hojeSelecionado ? "hoje" : formatDateBR(selectedDate)} — confira o horário
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={pontaHora}
                      onChange={(e) => setPontaHora(e.target.value)}
                      className="h-12 flex-1 rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-primary/60"
                    />
                    <button
                      onClick={confirmarPonta}
                      disabled={register.isPending || !pontaHora}
                      className="flex h-12 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" /> Confirmar
                    </button>
                    <button
                      onClick={() => setPontaForm(null)}
                      disabled={register.isPending}
                      aria-label="Cancelar"
                      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => handlePonta("entrada")}
                    disabled={register.isPending || !registroPermitido}
                    className="flex h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-base font-semibold text-foreground transition-all hover:border-primary/40 active:scale-[0.98] disabled:opacity-60"
                  >
                    <LogIn className="h-6 w-6 flex-shrink-0 text-primary" />
                    <div className="flex flex-1 flex-col leading-tight">
                      <span>Registrar Entrada</span>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {diaContratado
                          ? `Contratada ${diaContratado.entry} · ${TOLERANCIA_ENTRADA_MIN} min de tolerância`
                          : "Sem horário neste dia · hora extra"}
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
                        {diaContratado
                          ? `Contratada ${diaContratado.exit} · ${TOLERANCIA_SAIDA_MIN} min de tolerância`
                          : "Sem horário neste dia · hora extra"}
                      </span>
                    </div>
                  </button>
                </>
              )}
            </div>
            <p className="px-1 text-[11px] text-muted-foreground">
              Registre só a ponta que aconteceu fora do combinado. O que não for registrado vale
              como no horário contratado. O horário vem preenchido com agora e pode ser ajustado
              antes de confirmar.
            </p>

            <div className="mt-2 border-t border-border pt-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Histórico do dia {formatDateBR(selectedDate)}
              </h3>
              {carregandoDia ? (
                <p className="py-2 text-center text-sm text-muted-foreground">Carregando…</p>
              ) : eventosDoDia.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  Nenhum registro nesta data.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {eventosDoDia.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm"
                    >
                      <span className="flex-1 font-medium text-foreground">{ev.label}</span>
                      {ev.event_type === "checkinout" ? (
                        <span className="tabular-nums text-muted-foreground">
                          {fmtHora(ev.created_at)}
                          {ev.extra_minutes ? ` · ${formatarMinutos(ev.extra_minutes)}` : ""}
                        </span>
                      ) : (
                        <span className={ev.extra_charge ? "text-amber-700" : "text-emerald-600"}>
                          {ev.extra_charge ? "Extra" : "Realizado"}
                        </span>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => {
                            const regra = podeExcluirRegistro(ev);
                            if (!regra.ok) {
                              toast.error("Não é possível excluir", { description: regra.erro });
                              return;
                            }
                            setExcluindo(ev);
                          }}
                          disabled={excluir.isPending}
                          aria-label={`Excluir ${ev.label}`}
                          title={
                            ev.faturamento_id
                              ? "Já faturado — cancele o faturamento primeiro"
                              : "Excluir registro"
                          }
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border transition disabled:opacity-60 ${
                            ev.faturamento_id
                              ? "cursor-not-allowed text-muted-foreground/50"
                              : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          }`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
                    ? "não há horário contratado neste dia, então a duração da hora extra terá que ser conferida manualmente."
                    : `${formatarMinutos(pending.minutos)} de hora extra além da tolerância.`}{" "}
                  Registrar gerará cobrança para a família. Deseja continuar?
                </>
              ) : (
                <>
                  <strong className="text-foreground">{student.name}</strong> não tem{" "}
                  <strong className="text-foreground">{pending?.label}</strong> contratado para{" "}
                  {hojeSelecionado ? "hoje" : formatDateBR(selectedDate)}. Registrar gerará uma
                  cobrança extra para a família. Deseja continuar?
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

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <Trash2 className="h-6 w-6 text-destructive" />
            </div>
            <AlertDialogTitle className="text-center">Excluir registro?</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {excluindo && (
                <>
                  <span className="font-semibold text-foreground">{excluindo.label}</span>
                  {excluindo.event_type === "checkinout" &&
                    ` às ${fmtHora(excluindo.created_at)}`}{" "}
                  de {student.name} em {formatDateBR(selectedDate)} será apagado de forma
                  irreversível. Use só para registro feito por engano — para não cobrar um consumo
                  que aconteceu, use "Isentar" em Consumos Extras.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              onClick={() => excluindo && excluir.mutate(excluindo)}
              disabled={excluir.isPending}
              className="h-12 w-full rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
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
