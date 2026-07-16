import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PartyPopper, Search, UserCircle2 } from "lucide-react";
import { usePermissions, useSchool } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { ColoniaActionSheet } from "@/components/colonia/ColoniaActionSheet";
import { FechamentoSemanal } from "@/components/colonia/FechamentoSemanal";
import { type ColoniaStudent } from "@/lib/colonia";

export const Route = createFileRoute("/colonia")({
  head: () => ({ meta: [{ title: "Colônia de Férias — School Hub" }] }),
  component: ColoniaGate,
});

function ColoniaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("colonia") && !canView("colonia_financeiro"))
    return <AccessDenied message="Você não tem permissão para visualizar a Colônia de Férias." />;
  return <ColoniaPage />;
}

type StudentRow = {
  id: string;
  name: string;
  class_name: string;
  school_id: string;
  photo: string | null;
};

// Roster vindo da base do Sponte (diario_students), respeitando o filtro de
// unidade do cabeçalho.
function useColoniaStudents(schoolFilterIds: string[] | null) {
  return useQuery({
    queryKey: ["colonia_students", schoolFilterIds ?? "all"],
    queryFn: async () => {
      let sq = supabase
        .from("diario_students" as never)
        .select("id, name, class_name, school_id, photo")
        .order("class_name")
        .order("name");
      if (schoolFilterIds) sq = sq.in("school_id", schoolFilterIds as never);
      const { data, error } = await sq;
      if (error) throw error;
      const rows = (data ?? []) as unknown as StudentRow[];
      return rows.map<ColoniaStudent>((s) => ({
        id: s.id,
        name: s.name,
        className: s.class_name,
        schoolId: s.school_id,
        photo: s.photo,
      }));
    },
  });
}

function ColoniaPage() {
  const { canView, canEdit } = usePermissions();
  const podeEditar = canEdit("colonia");
  // Dois níveis de acesso: Operacional (registros) e Financeiro (fechamento).
  const podeOperacional = canView("colonia");
  const podeFinanceiro = canView("colonia_financeiro");
  const { selected, schools, schoolFilterIds } = useSchool();

  const specificSchoolId = selected !== "all" ? selected : null;
  const specificSchoolName =
    schools.find((s) => s.id === specificSchoolId)?.name ?? "Todas as Unidades";

  const defaultTab = podeOperacional ? "registro" : "fechamento";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PartyPopper className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Colônia de Férias</h1>
            <p className="text-sm text-muted-foreground">
              Registro avulso de refeições e portaria · {specificSchoolName}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList>
          {podeOperacional && <TabsTrigger value="registro">Registrar Consumos</TabsTrigger>}
          {podeFinanceiro && <TabsTrigger value="fechamento">Fechamento Semanal</TabsTrigger>}
        </TabsList>

        {podeOperacional && (
          <TabsContent value="registro" className="space-y-4 pt-4">
            <RegistrarConsumos schoolFilterIds={schoolFilterIds} canEdit={podeEditar} />
          </TabsContent>
        )}

        {podeFinanceiro && (
          <TabsContent value="fechamento" className="pt-4">
            <FechamentoSemanal
              schoolFilterIds={schoolFilterIds}
              canEdit={podeEditar}
              canFaturar={podeFinanceiro}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function RegistrarConsumos({
  schoolFilterIds,
  canEdit,
}: {
  schoolFilterIds: string[] | null;
  canEdit: boolean;
}) {
  const { data: students = [], isLoading } = useColoniaStudents(schoolFilterIds);

  const [busca, setBusca] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [active, setActive] = useState<ColoniaStudent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.className.toLowerCase().includes(q),
    );
  }, [students, busca]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ColoniaStudent[]>();
    for (const s of filtered) {
      const key = s.className || "Sem turma";
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [filtered]);

  // Turmas iniciam MINIMIZADAS. Durante uma busca ativa, expande as turmas que
  // têm resultados; ao limpar a busca, volta ao padrão (todas fechadas).
  const groupKeys = grouped.map(([className]) => className).join("|");
  useEffect(() => {
    const q = busca.trim();
    setOpenGroups(q ? grouped.map(([className]) => className) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, groupKeys]);

  return (
    <>
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
          <p className="text-sm text-muted-foreground">Nenhum aluno encontrado.</p>
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

      <ColoniaActionSheet
        student={active}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canEdit={canEdit}
      />
    </>
  );
}

function StudentCard({ student, onClick }: { student: ColoniaStudent; onClick: () => void }) {
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
      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
        Registrar
      </span>
    </button>
  );
}
