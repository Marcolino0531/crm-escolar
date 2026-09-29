import { createFileRoute } from "@tanstack/react-router";
import RHPage from "@/components/crm/RHPage";
import { useFuncionarios } from "@/lib/crm/hooks";
import { useSchool, usePermissions } from "@/lib/app-context";
import { PAGINAS_RH_SEM_SALARIO } from "@/lib/permissoes-arvore";
import { AccessDenied } from "@/components/AccessDenied";

export const Route = createFileRoute("/rh")({
  head: () => ({ meta: [{ title: "Recursos Humanos — School Hub" }] }),
  component: RecursosHumanosPage,
});

function RecursosHumanosPage() {
  const { selected, schools } = useSchool();
  const { canView, loading } = usePermissions();
  const rhHook = useFuncionarios();
  const unidadeNome = schools.find((s) => s.id === selected)?.name ?? "Todas as unidades";
  if (loading) return null;
  if (!PAGINAS_RH_SEM_SALARIO.some((c) => canView(c)))
    return <AccessDenied message="Você não tem permissão para visualizar Recursos Humanos." />;
  return (
    <div className="-m-4 md:-m-8 flex flex-col">
      <RHPage rhHook={rhHook} unidadeSelecionada={unidadeNome} />
    </div>
  );
}
