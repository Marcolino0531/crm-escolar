import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
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
  FileText,
  TrendingUp,
  KanbanSquare,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Users,
  AlertCircle,
  PiggyBank,
  ListTodo,
  HandCoins,
  Bot,
  MessageSquare,
  Sparkles,
  Shirt,
  Package,
  BookOpen,
  PartyPopper,
  Dumbbell,
  CreditCard,
  Menu,
  UtensilsCrossed,
  GraduationCap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import {
  AuthProvider,
  SchoolProvider,
  useAuth,
  usePermissions,
  useSchool,
} from "@/lib/app-context";
import { LoginScreen } from "@/components/LoginScreen";
import { UpdatePasswordScreen } from "@/components/UpdatePasswordScreen";
import { SchoolFilter } from "@/components/SchoolFilter";
import { NotificationsBell } from "@/components/NotificationsBell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  isExpanded,
  toggleExclusive,
  collapseAll,
  flattenTos,
  type ExpandedState,
} from "@/lib/sidebar-nav";

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

type IconComp = React.ComponentType<{ className?: string }>;

// Modelo de navegação em árvore: itens (uma rota) e grupos (categorias e
// subcategorias). Compatível estruturalmente com NavNode (lib pura).
type NavItemNode = { kind: "item"; to: string; icon: IconComp; label: string };
type NavGroupNode = { kind: "group"; id: string; label: string; children: NavTreeNode[] };
type NavTreeNode = NavItemNode | NavGroupNode;

function NavItem({
  to,
  icon: Icon,
  label,
  depth,
  onNavigate,
}: Omit<NavItemNode, "kind"> & { depth: number; onNavigate?: () => void }) {
  const pad = depth > 0 ? { paddingLeft: `${0.75 + depth * 0.75}rem` } : undefined;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      style={pad}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      activeProps={{
        className:
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-primary text-primary-foreground shadow-sm",
      }}
      activeOptions={{ exact: to === "/" }}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

// Cabeçalho de uma categoria/subcategoria, com chevron de estado. O clique
// alterna; abrir uma recolhe as irmãs do mesmo nível.
function NavGroupHeader({
  label,
  expanded,
  depth,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  depth: number;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const pad = depth > 0 ? { paddingLeft: `${0.75 + depth * 0.75}rem` } : undefined;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      style={pad}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Chevron className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  );
}

function NavNodes({
  nodes,
  depth,
  expanded,
  onToggle,
  onNavigate,
}: {
  nodes: NavTreeNode[];
  depth: number;
  expanded: ExpandedState;
  onToggle: (id: string, siblingIds: string[]) => void;
  onNavigate?: () => void;
}) {
  const siblingIds = nodes.filter((node) => node.kind === "group").map((node) => node.id);
  return (
    <>
      {nodes.map((node) =>
        node.kind === "item" ? (
          <NavItem
            key={node.to}
            to={node.to}
            icon={node.icon}
            label={node.label}
            depth={depth}
            onNavigate={onNavigate}
          />
        ) : (
          <div key={node.id} className="flex flex-col gap-1">
            <NavGroupHeader
              label={node.label}
              expanded={isExpanded(expanded, node.id)}
              depth={depth}
              onToggle={() => onToggle(node.id, siblingIds)}
            />
            {isExpanded(expanded, node.id) && (
              <NavNodes
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </div>
        ),
      )}
    </>
  );
}

// Conteúdo da sidebar reutilizado no painel fixo (desktop) e no drawer
// (tablet/mobile). `onNavigate` recolhe as categorias (e fecha o drawer) ao
// clicar num item.
function SidebarContent({
  tree,
  expanded,
  onToggle,
  onNavigate,
}: {
  tree: NavTreeNode[];
  expanded: ExpandedState;
  onToggle: (id: string, siblingIds: string[]) => void;
  onNavigate?: () => void;
}) {
  return (
    <>
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
        <NavNodes
          nodes={tree}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          onNavigate={onNavigate}
        />
      </nav>
      <Button
        variant="ghost"
        size="sm"
        className="mt-auto justify-start gap-2 text-sidebar-foreground/70"
        onClick={() => supabase.auth.signOut()}
      >
        <LogOut className="h-4 w-4" /> Sair
      </Button>
    </>
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

// Rotas públicas: usadas pelos PAIS, que não têm usuário no Supabase Auth — o
// portal de recarga autentica pelo CPF do aluno na própria tela e o formulário
// de matrícula é protegido por captcha, então nenhuma das duas passa pelo login
// interno nem pelo shell do app. (O painel interno /matriculas, no plural,
// continua exigindo login.)
const ROTAS_PUBLICAS = ["/portal-cantina", "/matricula"];

function AuthGate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { session, loading, recovery } = useAuth();
  if (ROTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return <Outlet />;
  }
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
  const { noSchoolAccess } = useSchool();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const showMainDashboard = canView("dashboard");
  const showAgenda = canView("agenda");
  const showAdmissoes = canView("admissoes");
  const showOnboarding = canView("onboarding");
  const showRh = canView("rh");
  const showTasks = canView("tasks");
  const showUniformes = canView("uniformes");
  const showEstoqueMaterial = canView("estoque_material");
  const showDiario = canView("diario");
  const showColonia = canView("colonia") || canView("colonia_financeiro");
  const showEsportes = canView("esportes");
  const showDocumentos = canView("documentos");
  const showCantina = canView("cantina");
  const showRematricula = canView("rematricula");
  // Financeiro sub-tabs: each link is gated independently.
  const showDashboard = canView("financeiro_dashboard");
  const showUpload = canView("financeiro_upload") || canEdit("financeiro_upload");
  const showConciliacao = canView("financeiro_conciliacao");
  const showFluxo = canView("financeiro_fluxo");
  const showInadimplencia = canView("financeiro_inadimplencia");
  // Mensagens Automáticas vive em Operacional: como o Atendimento, não depende
  // mais do guarda-chuva Financeiro. A permissão segue sendo financeiro_cobranca,
  // que também libera a Régua de Cobrança dentro do Financeiro.
  const showCobranca = canView("financeiro_cobranca");
  // Atendimento vive em Operacional: não depende mais do guarda-chuva Financeiro.
  const showAtendimento = canView("financeiro_atendimento");
  // Assistente de IA: permissão própria (manda dados a serviço externo e tem custo).
  const showAtendimentoIa = canView("financeiro_atendimento_ia");
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

  // Modelo de navegação em árvore (mesma ordem do menu): categorias colapsáveis
  // com itens dentro. Itens avulsos (Dashboard, Configurações) ficam no nível
  // superior. Categorias sem itens visíveis são omitidas. Usado para renderizar
  // a sidebar e para achar a primeira rota permitida.
  const tree = useMemo<NavTreeNode[]>(() => {
    const item = (show: boolean, node: NavItemNode): NavTreeNode[] => (show ? [node] : []);
    const group = (id: string, label: string, children: NavTreeNode[]): NavTreeNode[] =>
      children.length ? [{ kind: "group", id, label, children }] : [];
    return [
      ...item(showMainDashboard, {
        kind: "item",
        to: "/",
        icon: LayoutDashboard,
        label: "Dashboard",
      }),
      ...group("comercial", "Comercial", [
        ...item(showAgenda, { kind: "item", to: "/agenda", icon: CalendarDays, label: "Agenda" }),
        ...item(showAdmissoes, {
          kind: "item",
          to: "/admissoes",
          icon: KanbanSquare,
          label: "Admissões",
        }),
        ...item(showAdmissoes, {
          kind: "item",
          to: "/matriculas",
          icon: ClipboardList,
          label: "Matrículas",
        }),
        ...item(showOnboarding, {
          kind: "item",
          to: "/onboarding",
          icon: ClipboardCheck,
          label: "Onboarding",
        }),
      ]),
      ...group("pedagogico", "Pedagógico", [
        ...item(showDiario, {
          kind: "item",
          to: "/diario",
          icon: BookOpen,
          label: "Diário do Aluno",
        }),
        ...item(showColonia, {
          kind: "item",
          to: "/colonia",
          icon: PartyPopper,
          label: "Colônia de Férias",
        }),
        ...item(showUniformes, {
          kind: "item",
          to: "/uniformes",
          icon: Shirt,
          label: "Uniformes",
        }),
        ...item(showEstoqueMaterial, {
          kind: "item",
          to: "/estoque-material",
          icon: Package,
          label: "Material Pedagógico",
        }),
        ...item(showEsportes, {
          kind: "item",
          to: "/esportes",
          icon: Dumbbell,
          label: "Esportes",
        }),
      ]),
      ...group("operacional", "Operacional", [
        ...item(showRh, { kind: "item", to: "/rh", icon: Users, label: "Recursos Humanos" }),
        ...item(showTasks, { kind: "item", to: "/tasks", icon: ListTodo, label: "Tasks" }),
        ...item(showAtendimento, {
          kind: "item",
          to: "/atendimento",
          icon: MessageSquare,
          label: "Atendimento",
        }),
        ...item(showAtendimentoIa, {
          kind: "item",
          to: "/atendimento-ia",
          icon: Sparkles,
          label: "Assistente de IA",
        }),
        ...item(showDocumentos, {
          kind: "item",
          to: "/documentos",
          icon: FileText,
          label: "Documentos",
        }),
        ...item(showCantina, {
          kind: "item",
          to: "/cantina",
          icon: UtensilsCrossed,
          label: "Cantina",
        }),
        ...item(showRematricula, {
          kind: "item",
          to: "/rematricula-acompanhamento",
          icon: GraduationCap,
          label: "Rematrícula",
        }),
        ...item(showCobranca, {
          kind: "item",
          to: "/cobranca-automatica",
          icon: Bot,
          label: "Mensagens Automáticas",
        }),
      ]),
      ...group("financeiro", "Financeiro", [
        ...item(showFinanceiro && showDashboard, {
          kind: "item",
          to: "/extrato-bancario",
          icon: Landmark,
          label: "Extrato Bancário",
        }),
        ...item(showFinanceiro && showUpload, {
          kind: "item",
          to: "/upload",
          icon: Upload,
          label: "Importar Extrato",
        }),
        ...item(showFinanceiro && showConciliacao, {
          kind: "item",
          to: "/conciliacao",
          icon: FileCheck2,
          label: "Faturamento",
        }),
        ...item(showFinanceiro && showFluxo, {
          kind: "item",
          to: "/fluxo-futuro",
          icon: TrendingUp,
          label: "Fluxo Futuro",
        }),
        ...item(showFinanceiro && showFundos, {
          kind: "item",
          to: "/fundos",
          icon: PiggyBank,
          label: "Investimentos",
        }),
        ...item(showFinanceiro && showCartao, {
          kind: "item",
          to: "/cartao-credito",
          icon: CreditCard,
          label: "Cartão de Crédito",
        }),
        ...item(showFinanceiro && showInadimplencia, {
          kind: "item",
          to: "/inadimplencia",
          icon: AlertCircle,
          label: "Inadimplência",
        }),
        ...item(showFinanceiro && showCobranca, {
          kind: "item",
          to: "/cobranca",
          icon: HandCoins,
          label: "Régua de Cobrança",
        }),
      ]),
      ...item(showConfig, {
        kind: "item",
        to: "/configuracoes",
        icon: Settings,
        label: "Configurações",
      }),
    ];
  }, [
    showMainDashboard,
    showAgenda,
    showAdmissoes,
    showOnboarding,
    showRh,
    showTasks,
    showUniformes,
    showEstoqueMaterial,
    showDiario,
    showColonia,
    showEsportes,
    showDocumentos,
    showRematricula,
    showFinanceiro,
    showDashboard,
    showUpload,
    showConciliacao,
    showFluxo,
    showInadimplencia,
    showCobranca,
    showAtendimento,
    showAtendimentoIa,
    showCartao,
    showFundos,
    showConfig,
  ]);

  const firstAllowed = useMemo(() => flattenTos(tree)[0] ?? null, [tree]);

  // Estado colapsável só em memória: as categorias sempre começam recolhidas,
  // abrem no clique (recolhendo as irmãs) e permanecem abertas até um clique
  // fora do menu ou a navegação para um item.
  const toggleGroup = (id: string, siblingIds: string[]) =>
    setExpanded((prev) => toggleExclusive(prev, id, siblingIds));
  const collapseGroups = () => setExpanded((prev) => collapseAll(prev));

  // Clique fora do menu (desktop ou drawer) recolhe as categorias abertas.
  // `pointerdown` para recolher no início do clique, antes de qualquer ação do
  // conteúdo; `[data-sidebar-nav]` marca as duas áreas de menu.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-sidebar-nav]")) return;
      setExpanded((prev) => collapseAll(prev));
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Preserva a rota exata em recarregamentos (F5) e deep links. Só redireciona
  // quando o usuário cai na raiz ("/") SEM acesso ao Dashboard, encaminhando
  // para a PRIMEIRA rota permitida (ex.: acesso só à Colônia → /colonia). Quem
  // já está numa rota profunda permanece nela. Aguarda a confirmação das
  // permissões antes de qualquer decisão.
  const didRedirect = useRef(false);
  useEffect(() => {
    if (permsLoading || didRedirect.current) return;
    didRedirect.current = true;
    if (pathname === "/" && !showMainDashboard && firstAllowed && firstAllowed !== "/") {
      router.navigate({ to: firstAllowed });
    }
  }, [permsLoading, showMainDashboard, firstAllowed, router, pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        data-sidebar-nav=""
        className="hidden lg:flex w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar p-4"
      >
        <SidebarContent
          tree={tree}
          expanded={expanded}
          onToggle={toggleGroup}
          onNavigate={collapseGroups}
        />
      </aside>

      {/* Drawer de navegação para tablet/mobile. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          data-sidebar-nav=""
          side="left"
          className="flex max-h-[100dvh] w-64 flex-col overflow-y-auto border-sidebar-border bg-sidebar p-4"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <SidebarContent
            tree={tree}
            expanded={expanded}
            onToggle={toggleGroup}
            onNavigate={() => {
              collapseGroups();
              setMenuOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col">
        <header className="lg:hidden flex items-center gap-2 border-b border-border bg-card px-4 py-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground transition hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/school-hub-logo.svg" alt="School Hub" className="h-8 w-8 object-contain" />
          <span className="font-semibold">School Hub</span>
        </header>
        <div className="flex items-center gap-2 border-b border-border bg-card/50 px-4 py-3 md:px-8">
          <SchoolFilter />
          <div className="ml-auto">
            <NotificationsBell />
          </div>
        </div>
        <main className="flex-1 p-4 md:p-8">
          {noSchoolAccess ? (
            <div className="mx-auto mt-16 max-w-md rounded-lg border border-border bg-card p-8 text-center">
              <h2 className="text-lg font-semibold text-foreground">Acesso não liberado</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Sua conta ainda não está vinculada a nenhuma unidade. Fale com um administrador para
                liberar o acesso.
              </p>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
