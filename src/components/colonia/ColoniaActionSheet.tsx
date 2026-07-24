import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Coffee,
  Sun,
  Cookie,
  Moon,
  LogIn,
  LogOut,
  UserCircle2,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import { formatDateBR, todayISOLocal } from "@/lib/date-utils";
import {
  COLONIA_MEALS,
  COLONIA_GATE,
  COLONIA_RECORD_LABEL,
  ordenarRegistrosDoDia,
  type ColoniaRecordType,
  type ColoniaStudent,
} from "@/lib/colonia";

const ICONS: Record<ColoniaRecordType, React.ComponentType<{ className?: string }>> = {
  breakfast: Coffee,
  lunch: Sun,
  snack: Cookie,
  dinner: Moon,
  entry: LogIn,
  exit: LogOut,
};

type CampRecord = {
  id: string;
  record_type: ColoniaRecordType;
  occurred_at: string;
};

// Intervalo [00:00, 23:59:59.999] de um dia "YYYY-MM-DD" no fuso local.
function dayRange(ymd: string): { start: string; end: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Constrói um instante ISO a partir da data escolhida + hora local (h:min).
function atTime(ymd: string, h: number, min: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  student: ColoniaStudent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

export function ColoniaActionSheet({ student, open, onOpenChange, canEdit }: Props) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const userId = session?.user?.id;

  // Registro de portaria (Entrada/Saída) com horário editável (retroativo):
  // qual botão virou formulário e o horário HH:MM escolhido.
  const [gateForm, setGateForm] = useState<ColoniaRecordType | null>(null);
  const [gateTime, setGateTime] = useState("");

  // Data do registro (retroativa): padrão hoje, redefinida ao abrir o modal.
  const [selectedDate, setSelectedDate] = useState(todayISOLocal());
  useEffect(() => {
    if (open) setSelectedDate(todayISOLocal());
  }, [open, student?.id]);

  const { start, end } = dayRange(selectedDate);
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["colonia_records", student?.id ?? "none", selectedDate],
    enabled: open && !!student,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holiday_camp_records" as never)
        .select("id, record_type, occurred_at")
        .eq("student_id", student!.id)
        .gte("occurred_at", start)
        .lte("occurred_at", end)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CampRecord[];
    },
  });

  const register = useMutation({
    mutationFn: async ({ type, occurredAt }: { type: ColoniaRecordType; occurredAt: string }) => {
      if (!student) throw new Error("Aluno não selecionado");
      if (!userId) throw new Error("Sessão expirada");
      const { error } = await supabase.from("holiday_camp_records" as never).insert({
        student_id: student.id,
        school_id: student.schoolId,
        record_type: type,
        occurred_at: occurredAt,
        recorded_by: userId,
      } as never);
      if (error) throw error;
      return { type, occurredAt };
    },
    onSuccess: ({ type, occurredAt }) => {
      const isGate = type === "entry" || type === "exit";
      const hora = new Date(occurredAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.success(`${COLONIA_RECORD_LABEL[type]} ${isGate ? "registrado" : "marcado"}`, {
        description: `${student?.name} • ${isGate ? hora : "Realizado"}`,
      });
      setGateForm(null);
      qc.invalidateQueries({ queryKey: ["colonia_records"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao registrar", { description: msg });
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
      qc.invalidateQueries({ queryKey: ["colonia_records"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao remover", { description: msg });
    },
  });

  if (!student) return null;

  const ensureCanEdit = (): boolean => {
    if (!canEdit) {
      toast.error("Você não tem permissão para registrar na Colônia de Férias.");
      return false;
    }
    return true;
  };

  // Refeições viraram um status realizado/não realizado (sem hora exata):
  // marcar cria o registro; clicar de novo desmarca (remove o registro do dia).
  // Grava ao meio-dia para representar apenas a data, não a hora do evento.
  const toggleMeal = (type: ColoniaRecordType) => {
    if (!ensureCanEdit()) return;
    const existente = records.find((rec) => rec.record_type === type);
    if (existente) {
      remove.mutate(existente.id);
      return;
    }
    // Grava ao meio-dia da data escolhida para representar apenas a data.
    register.mutate({ type, occurredAt: atTime(selectedDate, 12, 0) });
  };

  // Entrada/Saída abrem um mini-formulário com o horário atual pré-preenchido.
  const openGate = (type: ColoniaRecordType) => {
    if (!ensureCanEdit()) return;
    setGateTime(nowHHMM());
    setGateForm(type);
  };

  const confirmGate = () => {
    if (!gateForm) return;
    const [h, m] = gateTime.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) {
      toast.error("Horário inválido");
      return;
    }
    // O horário confirmado é aplicado à data escolhida (registro retroativo).
    register.mutate({ type: gateForm, occurredAt: atTime(selectedDate, h, m) });
  };

  const handleSheetOpenChange = (v: boolean) => {
    if (!v) setGateForm(null);
    onOpenChange(v);
  };

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
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
          </div>
        </SheetHeader>

        <div className="grid gap-2.5 p-5 pb-8 pt-4">
          <div className="rounded-2xl border border-border bg-card p-3">
            <label
              htmlFor="colonia-data-registro"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Data do Registro
            </label>
            <input
              id="colonia-data-registro"
              type="date"
              value={selectedDate}
              max={todayISOLocal()}
              onChange={(e) => setSelectedDate(e.target.value || todayISOLocal())}
              className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-primary/60"
            />
          </div>

          {COLONIA_MEALS.map((r) => {
            const Icon = ICONS[r.key];
            const done = records.some((rec) => rec.record_type === r.key);
            return (
              <button
                key={r.key}
                onClick={() => toggleMeal(r.key)}
                disabled={register.isPending || remove.isPending}
                className={[
                  "flex h-16 w-full items-center gap-4 rounded-2xl px-5 text-left text-base font-semibold shadow-sm transition-all active:scale-[0.98] disabled:opacity-60",
                  done
                    ? "bg-emerald-500 text-white"
                    : "border border-border bg-card text-foreground hover:border-primary/40",
                ].join(" ")}
              >
                <Icon className={["h-6 w-6 flex-shrink-0", done ? "" : "text-primary"].join(" ")} />
                <span className="flex-1">{r.label}</span>
                <span
                  className={[
                    "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                    done ? "bg-white/20 text-white" : "bg-secondary text-muted-foreground",
                  ].join(" ")}
                >
                  {done ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Realizado
                    </>
                  ) : (
                    "Não realizado"
                  )}
                </span>
              </button>
            );
          })}

          <div className="mt-1 grid grid-cols-2 gap-2.5">
            {COLONIA_GATE.map((r) => {
              const Icon = ICONS[r.key];
              if (gateForm === r.key) {
                return (
                  <div
                    key={r.key}
                    className="col-span-2 rounded-2xl border border-primary/40 bg-card p-3 shadow-sm"
                  >
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Icon className="h-5 w-5 flex-shrink-0 text-primary" />
                      <span>{r.label} — confirme o horário</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={gateTime}
                        onChange={(e) => setGateTime(e.target.value)}
                        className="h-12 flex-1 rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus:border-primary/60"
                      />
                      <button
                        onClick={confirmGate}
                        disabled={register.isPending || !gateTime}
                        className="flex h-12 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
                      >
                        <Check className="h-4 w-4" /> Confirmar
                      </button>
                      <button
                        onClick={() => setGateForm(null)}
                        disabled={register.isPending}
                        aria-label="Cancelar"
                        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={r.key}
                  onClick={() => openGate(r.key)}
                  disabled={register.isPending}
                  className="flex h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 text-left text-base font-semibold text-foreground shadow-sm transition-all hover:border-primary/40 active:scale-[0.98] disabled:opacity-60"
                >
                  <Icon className="h-6 w-6 flex-shrink-0 text-primary" />
                  <span>{r.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Histórico do dia {formatDateBR(selectedDate)}
            </h3>
            {isLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : records.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum registro nesta data.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {ordenarRegistrosDoDia(records).map((rec) => {
                  const Icon = ICONS[rec.record_type];
                  return (
                    <li
                      key={rec.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"
                    >
                      <Icon className="h-5 w-5 flex-shrink-0 text-primary" />
                      <span className="flex-1 text-sm font-medium text-foreground">
                        {COLONIA_RECORD_LABEL[rec.record_type]}
                      </span>
                      {rec.record_type === "entry" || rec.record_type === "exit" ? (
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {fmtTime(rec.occurred_at)}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="h-4 w-4" /> Realizado
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
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
