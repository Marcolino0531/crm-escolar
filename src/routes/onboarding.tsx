import { createFileRoute } from "@tanstack/react-router";
import OnboardingBoard from "@/components/crm/OnboardingBoard";
import { useOnboarding } from "@/lib/crm/hooks";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding — Schooler Hub" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const onboardingHook = useOnboarding();
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("onboarding"))
    return <AccessDenied message="Você não tem permissão para visualizar Onboarding." />;
  return (
    <div className="-m-4 md:-m-8 flex flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-6 py-4">
        <h2 className="text-xl font-bold text-foreground">Onboarding</h2>
        <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700">
          {onboardingHook.alunos.length} alunos
        </span>
      </header>
      <OnboardingBoard onboardingHook={onboardingHook} />
    </div>
  );
}
