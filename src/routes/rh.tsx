import { createFileRoute } from "@tanstack/react-router";
import RHPage from "@/components/crm/RHPage";
import { useFuncionarios } from "@/lib/crm/hooks";
import { useSchool } from "@/lib/app-context";

export const Route = createFileRoute("/rh")({
  head: () => ({ meta: [{ title: "Recursos Humanos — Schooler Hub" }] }),
  component: RecursosHumanosPage,
});

function RecursosHumanosPage() {
  const { selected, schools } = useSchool();
  const rhHook = useFuncionarios();
  const unidadeNome = schools.find((s) => s.id === selected)?.name ?? "Todas as unidades";
  return (
    <div className="-m-4 md:-m-8 flex flex-col">
      <RHPage rhHook={rhHook} unidadeSelecionada={unidadeNome} />
    </div>
  );
}
