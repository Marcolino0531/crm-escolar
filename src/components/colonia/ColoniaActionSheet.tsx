import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Coffee, Sun, Cookie, Moon, LogIn, LogOut, UserCircle2 } from "lucide-react";
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
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Tente novamente.";
      toast.error("Erro ao registrar", { description: msg });
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
