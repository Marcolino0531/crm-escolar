import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import {
  LayoutDashboard,
  Landmark,
  Upload,
  Settings,
  LogOut,
  FileCheck2,
  TrendingUp,
  KanbanSquare,
  CalendarDays,
  ClipboardCheck,
  Users,
  AlertCircle,
  PiggyBank,
  ListTodo,
  HandCoins,
  Shirt,
  BookOpen,
  PartyPopper,
  CreditCard,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, SchoolProvider, useAuth, usePermissions } from "@/lib/app-context";
import { LoginScreen } from "@/components/LoginScreen";
import { UpdatePasswordScreen } from "@/components/UpdatePasswordScreen";
import { SchoolFilter } from "@/components/SchoolFilter";
import { NotificationsBell } from "@/components/NotificationsBell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Página não encontrada.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "School Hub" },
      {
        name: "description",
        content:
          "Importe extratos, categorize por centro de custo e acompanhe o financeiro do colégio.",
      },
      { property: "og:title", content: "School Hub" },
      { name: "twitter:title", content: "School Hub" },
      {
        property: "og:description",
        content:
          "Importe extratos, categorize por centro de custo e acompanhe o financeiro do colégio.",
      },
      {
        name: "twitter:description",
        content:
          "Importe extratos, categorize por centro de custo e acompanhe o financeiro do colégio.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6a56dd46-dd62-4f56-ba56-f4942f91bdc0/id-preview-a4d05dd0--3ae47d10-0cbb-451a-80d8-e4f83acf4008.lovable.app-1779281612230.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/6a56dd46-dd62-4f56-ba56-f4942f91bdc0/id-preview-a4d05dd0--3ae47d10-0cbb-451a-80d8-e4f83acf4008.lovable.app-1779281612230.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/school-hub-logo.svg" },
      { rel: "shortcut icon", href: "/school-hub-logo.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      activeProps={{
        className:
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-primary text-primary-foreground shadow-sm",
      }}
      activeOptions={{ exact: to === "/" }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SchoolProvider>
          <AuthGate />
          <Toaster richColors position="top-right" />
        </SchoolProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { session, loading, recovery } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (recovery) return <UpdatePasswordScreen />;
  if (!session) return <LoginScreen />;
  return <AppShell />;
}

function AppShell() {
  const { canView, canEdit, loading: permsLoading } = usePermissions();
  const router = useRouter();
  // On every app open / login, land the user on the Dashboard ("/") — the
  // consolidated "Todas as Unidades" view (school filter defaults to "all").
  const didRedirect = useRef(false);
  useEffect(() => {
    if (permsLoading || didRedirect.current) return;
    didRedirect.current = true;
    if (canView("dashboard")) {
      router.navigate({ to: "/" });
    } else if (canView("financeiro_dashboard")) {
      router.navigate({ to: "/extrato-bancario" });
    }
  }, [permsLoading, canView, router]);
  const showMainDashboard = canView("dashboard");
  const showAgenda = canView("agenda");
  const showAdmissoes = canView("admissoes");
  const showOnboarding = canView("onboarding");
  const showRh = canView("rh");
  const showTasks = canView("tasks");
  const showUniformes = canView("uniformes");
  const showDiario = canView("diario");
  const showColonia = canView("colonia");
  // Financeiro sub-tabs: each link is gated independently.
  const showDashboard = canView("financeiro_dashboard");
  const showUpload = canView("financeiro_upload") || canEdit("financeiro_upload");
  const showConciliacao = canView("financeiro_conciliacao");
  const showFluxo = canView("financeiro_fluxo");
  const showInadimplencia = canView("financeiro_inadimplencia");
  // Cobrança em cadeia: macro Financeiro E o submódulo financeiro_cobranca.
  const showCobranca = canView("financeiro") && canView("financeiro_cobranca");
  const showCartao = canView("financeiro") && canView("financeiro_cartao");
  const showFundos = canView("financeiro_fundos");
  // The Financeiro section appears if the umbrella is granted AND at least one
  // sub-tab is visible.
  const showFinanceiro =
    canView("financeiro") &&
    (showDashboard ||
      showUpload ||
      showConciliacao ||
      showFluxo ||
      showInadimplencia ||
      showCobranca ||
      showCartao ||
      showFundos);
  const showConfig = canView("configuracoes");
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
            <img
              src="/school-hub-logo.svg"
              alt="School Hub"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">School Hub</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {showMainDashboard && <NavItem to="/" icon={LayoutDashboard} label="Dashboard" />}
          {(showAgenda ||
            showAdmissoes ||
            showOnboarding ||
            showRh ||
            showTasks ||
            showUniformes ||
            showDiario ||
            showColonia) && (
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Módulos
            </div>
          )}
          {showAgenda && <NavItem to="/agenda" icon={CalendarDays} label="Agenda" />}
          {showAdmissoes && <NavItem to="/admissoes" icon={KanbanSquare} label="Admissões" />}
          {showOnboarding && <NavItem to="/onboarding" icon={ClipboardCheck} label="Onboarding" />}
          {showRh && <NavItem to="/rh" icon={Users} label="Recursos Humanos" />}
          {showTasks && <NavItem to="/tasks" icon={ListTodo} label="Tasks" />}
          {showUniformes && <NavItem to="/uniformes" icon={Shirt} label="Uniformes" />}
          {showDiario && <NavItem to="/diario" icon={BookOpen} label="Diário do Aluno" />}
          {showColonia && <NavItem to="/colonia" icon={PartyPopper} label="Colônia de Férias" />}
          {showFinanceiro && (
            <>
              <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                Financeiro
              </div>
              {showDashboard && (
                <NavItem to="/extrato-bancario" icon={Landmark} label="Extrato Bancário" />
              )}
              {showUpload && <NavItem to="/upload" icon={Upload} label="Importar Extrato" />}
              {showConciliacao && (
                <NavItem to="/conciliacao" icon={FileCheck2} label="Faturamento" />
              )}
              {showFluxo && <NavItem to="/fluxo-futuro" icon={TrendingUp} label="Fluxo Futuro" />}
              {showInadimplencia && (
                <NavItem to="/inadimplencia" icon={AlertCircle} label="Inadimplência" />
              )}
              {/* Cobrança aparece logo abaixo de Inadimplência (gated por cobranca). */}
              {showCobranca && <NavItem to="/cobranca" icon={HandCoins} label="Cobrança" />}
              {showCartao && (
                <NavItem to="/cartao-credito" icon={CreditCard} label="Cartão de Crédito" />
              )}
              {showFundos && <NavItem to="/fundos" icon={PiggyBank} label="Fundos" />}
            </>
          )}
          {showConfig && <NavItem to="/configuracoes" icon={Settings} label="Configurações" />}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto justify-start gap-2 text-sidebar-foreground/70"
          onClick={() => supabase.auth.signOut()}
        >
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="md:hidden flex items-center gap-2 border-b border-border bg-card px-4 py-3">
          <img src="/school-hub-logo.svg" alt="School Hub" className="h-8 w-8 object-contain" />
          <span className="font-semibold">School Hub</span>
          <nav className="ml-auto flex gap-1">
            {showFinanceiro && showDashboard && (
              <Link
                to="/"
                className="rounded-md px-2 py-1 text-xs"
                activeProps={{
                  className: "rounded-md px-2 py-1 text-xs bg-primary text-primary-foreground",
                }}
                activeOptions={{ exact: true }}
              >
                Painel
              </Link>
            )}
            {showFinanceiro && showUpload && (
              <Link
                to="/upload"
                className="rounded-md px-2 py-1 text-xs"
                activeProps={{
                  className: "rounded-md px-2 py-1 text-xs bg-primary text-primary-foreground",
                }}
              >
                Upload
              </Link>
            )}
            {showFinanceiro && showConciliacao && (
              <Link
                to="/conciliacao"
                className="rounded-md px-2 py-1 text-xs"
                activeProps={{
                  className: "rounded-md px-2 py-1 text-xs bg-primary text-primary-foreground",
                }}
              >
                Faturamento
              </Link>
            )}
            {showFinanceiro && showFluxo && (
              <Link
                to="/fluxo-futuro"
                className="rounded-md px-2 py-1 text-xs"
                activeProps={{
                  className: "rounded-md px-2 py-1 text-xs bg-primary text-primary-foreground",
                }}
              >
                Futuro
              </Link>
            )}
            {showConfig && (
              <Link
                to="/configuracoes"
                className="rounded-md px-2 py-1 text-xs"
                activeProps={{
                  className: "rounded-md px-2 py-1 text-xs bg-primary text-primary-foreground",
                }}
              >
                Config
              </Link>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-md px-2 py-1 text-xs"
            >
              Sair
            </button>
          </nav>
        </header>
        <div className="flex items-center gap-2 border-b border-border bg-card/50 px-4 py-3 md:px-8">
          <SchoolFilter />
          <div className="ml-auto">
            <NotificationsBell />
          </div>
        </div>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
