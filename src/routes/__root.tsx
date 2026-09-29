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
  BrainCircuit,
  Shirt,
  Package,
  BookOpen,
  Library,
  PartyPopper,
  Dumbbell,
  CreditCard,
  Menu,
  UtensilsCrossed,
  GraduationCap,
  School,
  Presentation,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
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
import { ehRotaPublica } from "@/lib/rotas-publicas";
import { useProfessor } from "@/lib/use-professor";
import {
  ARVORE_PERMISSOES,
  moduloVisivelNoMenu,
  type ChavePermissao,
  type NoArvore,
} from "@/lib/permissoes-arvore";
import {
  isExpanded,
  toggleExclusive,
  collapseAll,
  flattenTos,
  type ExpandedState,
} from "@/lib/sidebar-nav";

import appCss from "../styles.css?url";

/** Ícone de cada módulo do menu (chave da árvore → ícone). */
const ICONES_MENU: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  agenda: CalendarDays,
  admissoes: KanbanSquare,
  eformulario: ClipboardList,
  matricula: GraduationCap,
  onboarding: ClipboardCheck,
  secretaria: School,
  professor: Presentation,
  diario: BookOpen,
  colonia: PartyPopper,
  uniformes: Shirt,
  estoque_material: Package,
  esportes: Dumbbell,
  biblioteca: Library,
  rh: Users,
  tasks: ListTodo,
  atendimento: MessageSquare,
  assistente_ia: Sparkles,
  documentos: FileText,
  cantina: UtensilsCrossed,
  mensagens: Bot,
  analises_ia: BrainCircuit,
  extrato: Landmark,
  importar: Upload,
  faturamento: FileCheck2,
  fluxo: TrendingUp,
  investimentos: PiggyBank,
  cartao: CreditCard,
  inadimplencia: AlertCircle,
  regua: HandCoins,
  configuracoes: Settings,
};

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

// Erros podem chegar como string ou objeto sem `message` (ex.: html5-qrcode
// lança strings); nunca exibir a tela sem descrição.
function descricaoDoErro(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try {
      const s = JSON.stringify(error);
      if (s && s !== "{}") return s;
    } catch {
      // ignora
    }
  }
  const s = String(error);
  return s && s !== "[object Object]" ? s : "Erro desconhecido.";
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">{descricaoDoErro(error)}</p>
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

function AuthGate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { session, loading, recovery } = useAuth();
  if (ehRotaPublica(pathname)) {
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
  const { canView, loading: permsLoading } = usePermissions();
  // Professor com login vinculado: entrada própria "Minhas Turmas", sem
  // depender de nenhum app_module (a RLS limita o que ele enxerga).
  const { professor, loading: professorLoading } = useProfessor();
  const showProfessor = professor !== null;
  const { noSchoolAccess } = useSchool();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  // Menu lateral lido da árvore única (src/lib/permissoes-arvore.ts): nome,
  // ordem e visibilidade vêm de lá (moduloVisivelNoMenu: alguma folha visível,
  // ou a condição `menu` do módulo); grupos sem módulo visível são omitidos.
  // Só o ícone de cada módulo fica aqui.
  const tree = useMemo<NavTreeNode[]>(() => {
    const visivel = (m: NoArvore) =>
      m.acessoEspecial === "professor" ? showProfessor : moduloVisivelNoMenu(m, canView);
    const item = (m: NoArvore): NavItemNode => ({
      kind: "item",
      to: m.rota ?? "/",
      icon: ICONES_MENU[m.chave] ?? Settings,
      label: m.nome,
    });
    const nodes: NavTreeNode[] = [];
    for (const grupo of ARVORE_PERMISSOES as readonly NoArvore[]) {
      const modulos = (grupo.filhos as readonly NoArvore[]).filter(visivel).map(item);
      if (modulos.length === 0) continue;
      if (grupo.soltoNoMenu) nodes.push(...modulos);
      else nodes.push({ kind: "group", id: grupo.chave, label: grupo.nome, children: modulos });
    }
    return nodes;
  }, [canView, showProfessor]);
  const showMainDashboard = canView("dashboard");

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
    if (permsLoading || professorLoading || didRedirect.current) return;
    didRedirect.current = true;
    if (pathname === "/" && !showMainDashboard && firstAllowed && firstAllowed !== "/") {
      router.navigate({ to: firstAllowed });
    }
  }, [permsLoading, professorLoading, showMainDashboard, firstAllowed, router, pathname]);

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
