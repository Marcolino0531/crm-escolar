import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Coffee, Sun, Cookie, Moon, LogIn, LogOut, UserCircle2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/app-context";
import {
  COLONIA_MEALS,
  COLONIA_GATE,
  COLONIA_RECORD_LABEL,
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

function todayRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

  const { start, end } = todayRange();
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["colonia_records", student?.id ?? "none", start],
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
    mutationFn: async (type: ColoniaRecordType) => {
      if (!student) throw new Error("Aluno não selecionado");
      if (!userId) throw new Error("Sessão expirada");
      const { error } = await supabase.from("holiday_camp_records" as never).insert({
        student_id: student.id,
        school_id: student.schoolId,
        record_type: type,
        recorded_by: userId,
      } as never);
      if (error) throw error;
      return type;
    },
    onSuccess: (type) => {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      toast.success(`${COLONIA_RECORD_LABEL[type]} registrado`, {
        description: `${student?.name} • ${hora}`,
      });
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

  const handle = (type: ColoniaRecordType) => {
    if (!canEdit) {
      toast.error("Você não tem permissão para registrar na Colônia de Férias.");
      return;
    }
    register.mutate(type);
  };

  return (
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
          </div>
        </SheetHeader>

        <div className="grid gap-2.5 p-5 pb-8 pt-4">
          {COLONIA_MEALS.map((r) => {
            const Icon = ICONS[r.key];
            return (
              <button
                key={r.key}
                onClick={() => handle(r.key)}
                disabled={register.isPending}
                className="flex h-16 w-full items-center gap-4 rounded-2xl bg-primary px-5 text-left text-base font-semibold text-primary-foreground shadow-sm transition-all active:scale-[0.98] disabled:opacity-60"
              >
                <Icon className="h-6 w-6 flex-shrink-0" />
                <span>Registrar {r.label}</span>
              </button>
            );
          })}

          <div className="mt-1 grid grid-cols-2 gap-2.5">
            {COLONIA_GATE.map((r) => {
              const Icon = ICONS[r.key];
              return (
                <button
                  key={r.key}
                  onClick={() => handle(r.key)}
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
              Histórico de hoje
            </h3>
            {isLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : records.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum registro hoje.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {records.map((rec) => {
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
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
