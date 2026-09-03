import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen,
  Search,
  Settings2,
  UserCircle2,
  AlertTriangle,
  Download,
  Utensils,
  RefreshCw,
  QrCode,
  Loader2,
} from "lucide-react";
import { usePermissions, useSchool } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR } from "@/lib/date-utils";
import { StudentActionSheet } from "@/components/diario/StudentActionSheet";
import { DiarioManager } from "@/components/diario/DiarioManager";
import { QrScannerDialog } from "@/components/diario/QrScannerDialog";
import { downloadKeychainPdf, sanitizeFileName } from "@/lib/diario-keychain";
import { syncDiarioSponte } from "@/lib/sponte.functions";
import {
  MEALS,
  MEAL_LABEL,
  emptyPlan,
  emptySchedule,
  groupMealPlans,
  groupSchedules,
  isCoveredToday,
  type DiarioStudent,
  type MealKey,
  type MealPlanRow,
  type ScheduleRow,
  type Weekday,
} from "@/lib/diario";
import { selectAll } from "@/lib/supabase-paginate";

export const Route = createFileRoute("/diario")({
  head: () => ({ meta: [{ title: "Diário do Aluno — School Hub" }] }),
  component: DiarioGate,
});

function DiarioGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("diario"))
    return <AccessDenied message="Você não tem permissão para visualizar o Diário do Aluno." />;
  return <DiarioPage />;
}

type StudentRow = {
  id: string;
  name: string;
  class_id: string | null;
  class_name: string;
  school_id: string;
  photo: string | null;
};

function useStudents(schoolFilterIds: string[] | null) {
  return useQuery({
    queryKey: ["diario_students", schoolFilterIds ?? "all"],
    queryFn: async () => {
      const [students, plans, schedules] = await Promise.all([
        selectAll<StudentRow>(() => {
          let sq = supabase
            .from("diario_students" as never)
            .select("id, name, class_id, class_name, school_id, photo")
            .order("class_name")
            .order("name")
            .order("id");
          if (schoolFilterIds) sq = sq.in("school_id", schoolFilterIds as never);
          return sq;
        }),
        selectAll<MealPlanRow>(() =>
          supabase
            .from("diario_meal_plans" as never)
            .select("student_id, meal, weekday")
            .order("id"),
        ),
        selectAll<ScheduleRow>(() =>
          supabase
            .from("diario_schedules" as never)
            .select("student_id, weekday, entry, exit")
            .order("id"),
        ),
      ]);

      const planByStudent = groupMealPlans(plans);
      const schedByStudent = groupSchedules(schedules);

      return students.map<DiarioStudent>((s) => ({
        id: s.id,
        name: s.name,
        className: s.class_name,
        classId: s.class_id,
        schoolId: s.school_id,
        photo: s.photo,
        plan: planByStudent.get(s.id) ?? emptyPlan(),
        schedule: schedByStudent.get(s.id) ?? emptySchedule(),
      }));
    },
  });
}

function DiarioPage() {
  const { canEdit, isAdmin } = usePermissions();
  const podeEditar = canEdit("diario");
  const { selected, schools, schoolFilterIds } = useSchool();
  const { data: students = [], isLoading } = useStudents(schoolFilterIds);
  const qc = useQueryClient();

  // Sincronização com o Sponte (fonte da verdade de turmas/alunos). Admin-only.
  const sync = useMutation({
    mutationFn: async () => {
      const res = await syncDiarioSponte();
      if (res.error) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["diario_students"] });
      if (res.indisponivel) {
        toast.warning("Sponte indisponível ou sem alunos ativos.");
      } else {
        toast.success(
          `Sincronizado com o Sponte: ${res.alunos} aluno(s) e ${res.turmas} turma(s).`,
        );
      }
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar com o Sponte."),
  });

  const [busca, setBusca] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [active, setActive] = useState<DiarioStudent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [downloadingClass, setDownloadingClass] = useState<string | null>(null);

  const baixarTurma = async (className: string, alunos: DiarioStudent[]) => {
    setDownloadingClass(className);
    try {
      await downloadKeychainPdf(
        alunos.map((s) => ({ id: s.id, name: s.name, className: s.className })),
        `chaveiros_${sanitizeFileName(className || "sem_turma")}.pdf`,
      );
    } catch (e) {
      toast.error("Erro ao gerar os chaveiros", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setDownloadingClass(null);
    }
  };

  const specificSchoolId = selected !== "all" ? selected : null;
  const specificSchoolName =
    schools.find((s) => s.id === specificSchoolId)?.name ?? "Todas as Unidades";

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.className.toLowerCase().includes(q),
    );
  }, [students, busca]);

  const grouped = useMemo(() => {
    const groups = new Map<string, DiarioStudent[]>();
    for (const s of filtered) {
      const key = s.className || "Sem turma";
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [filtered]);

  // Turmas iniciam MINIMIZADAS. Durante uma busca ativa, expande as turmas que
  // têm resultados para que os alunos filtrados fiquem visíveis; ao limpar a
  // busca, volta ao estado padrão (todas fechadas).
  const groupKeys = grouped.map(([className]) => className).join("|");
  useEffect(() => {
    const q = busca.trim();
    setOpenGroups(q ? grouped.map(([className]) => className) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, groupKeys]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Diário do Aluno</h1>
            <p className="text-sm text-muted-foreground">
              Registro de refeições e entrada/saída · {specificSchoolName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
              {sync.isPending ? "Sincronizando…" : "Sincronizar com Sponte"}
            </Button>
          )}
          {podeEditar && (
            <Button onClick={() => setScannerOpen(true)}>
              <QrCode className="mr-2 h-4 w-4" /> Ler QR Code
            </Button>
          )}
          {podeEditar && (
            <Button variant="outline" onClick={() => setManagerOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" /> Gerenciar
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="registro" className="w-full">
        <TabsList>
          <TabsTrigger value="registro">
            <Utensils className="mr-1.5 h-4 w-4" /> Registro
          </TabsTrigger>
          <TabsTrigger value="extras">
            <AlertTriangle className="mr-1.5 h-4 w-4" /> Consumos Extras
          </TabsTrigger>
        </TabsList>

        <TabsContent value="registro" className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por aluno ou turma…"
              className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : grouped.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <UserCircle2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum aluno encontrado.{" "}
                {podeEditar && "Use \u201cGerenciar\u201d para cadastrar turmas e alunos."}
              </p>
            </div>
          ) : (
            <Accordion
              type="multiple"
              value={openGroups}
              onValueChange={setOpenGroups}
              className="space-y-2"
            >
              {grouped.map(([className, alunos]) => (
                <AccordionItem
                  key={className}
                  value={className}
                  className="overflow-hidden rounded-2xl border border-border bg-card px-3"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {className || "Sem turma"}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {alunos.length} {alunos.length === 1 ? "aluno" : "alunos"}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    {podeEditar && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={downloadingClass === className}
                          onClick={() => baixarTurma(className, alunos)}
                        >
                          {downloadingClass === className ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          ) : (
                            <QrCode className="mr-1.5 h-4 w-4" />
                          )}
                          Baixar Turma Toda (chaveiros)
                        </Button>
                      </div>
                    )}
                    {alunos.map((s) => (
                      <StudentCard
                        key={s.id}
                        student={s}
                        onClick={() => {
                          setActive(s);
                          setSheetOpen(true);
                        }}
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </TabsContent>

        <TabsContent value="extras">
          <ExtraChargesTab schoolFilterIds={schoolFilterIds} studentIndex={students} />
        </TabsContent>
      </Tabs>

      <StudentActionSheet
        student={active}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canEdit={podeEditar}
      />
      <DiarioManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        schoolId={specificSchoolId}
        schoolName={specificSchoolName}
      />
      <QrScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} students={students} />
    </div>
  );
}

function StudentCard({ student, onClick }: { student: DiarioStudent; onClick: () => void }) {
  const coveredCount = MEALS.filter((m) => isCoveredToday(student.plan, m.key)).length;
  const noneToday = coveredCount === 0;
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm active:scale-[0.99]"
    >
      {student.photo ? (
        <img
          src={student.photo}
          alt={student.name}
          width={44}
          height={44}
          className="h-11 w-11 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
          <UserCircle2 className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{student.name}</p>
        <p className="truncate text-xs text-muted-foreground">{student.className || "Sem turma"}</p>
      </div>
      <span
        className={[
          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
          noneToday ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
        ].join(" ")}
      >
        {noneToday ? "Sem plano hoje" : `${coveredCount} de 4 hoje`}
      </span>
    </button>
  );
}

type ExtraEventRow = {
  id: string;
  student_id: string;
  event_type: string;
  meal: MealKey | null;
  label: string;
  reason: string | null;
  created_at: string;
};

function ExtraChargesTab({
  schoolFilterIds,
  studentIndex,
}: {
  schoolFilterIds: string[] | null;
  studentIndex: DiarioStudent[];
}) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const nameById = useMemo(() => {
    const m = new Map<string, { name: string; className: string }>();
    for (const s of studentIndex) m.set(s.id, { name: s.name, className: s.className });
    return m;
  }, [studentIndex]);
  const allowedStudentIds = useMemo(
    () => (schoolFilterIds ? new Set(studentIndex.map((s) => s.id)) : null),
    [schoolFilterIds, studentIndex],
  );

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["diario_extra_events", from, to, schoolFilterIds ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("diario_events" as never)
        .select("id, student_id, event_type, meal, label, reason, created_at")
        .eq("extra_charge", true)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      let rows = (data ?? []) as unknown as ExtraEventRow[];
      if (allowedStudentIds) rows = rows.filter((r) => allowedStudentIds.has(r.student_id));
      return rows;
    },
  });

  const exportCSV = () => {
    const header = ["Data/Hora", "Aluno", "Turma", "Tipo", "Item", "Motivo"];
    const lines = events.map((e) => {
      const info = nameById.get(e.student_id);
      const tipo = e.event_type === "meal" ? "Refeição" : "Entrada/Saída";
      const dt =
        e.event_type === "meal"
          ? formatDateBR(e.created_at)
          : new Date(e.created_at).toLocaleString("pt-BR");
      return [dt, info?.name ?? "—", info?.className ?? "—", tipo, e.label, e.reason ?? ""].map(
        (c) => `"${String(c).replace(/"/g, '""')}"`,
      );
    });
    const csv = [header.join(","), ...lines.map((l) => l.join(","))].join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consumos-extras_${from}_a_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            De
          </span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Até
          </span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </label>
        <Button
          variant="outline"
          onClick={exportCSV}
          disabled={events.length === 0}
          className="ml-auto"
        >
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum consumo extra registrado no período selecionado.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Data/Hora</th>
                <th className="px-3 py-2 font-semibold">Aluno</th>
                <th className="px-3 py-2 font-semibold">Item</th>
                <th className="px-3 py-2 font-semibold">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => {
                const info = nameById.get(e.student_id);
                return (
                  <tr key={e.id} className="hover:bg-accent/40">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateBR(e.created_at)}
                      {e.event_type !== "meal" && (
                        <>
                          {" "}
                          {new Date(e.created_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{info?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{info?.className ?? ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {e.meal ? MEAL_LABEL[e.meal] : e.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{e.reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
