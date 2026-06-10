import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Trash2,
  Plus,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Users,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  usePermissions,
  useSchool,
  APP_MODULES,
  ALL_MODULES,
  FINANCEIRO_SUBMODULES,
  MODULE_LABELS,
  type AppModule,
} from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { useServerFn } from "@tanstack/react-start";
import {
  listManagedUsers,
  createManagedUser,
  updateUserAccess,
  deleteManagedUser,
} from "@/lib/admin-users.functions";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — School Hub" },
      { name: "description", content: "Gerencie centros de custo e regras de categorização." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { isAdmin, canView, canEdit, loading } = usePermissions();
  if (loading) return null;
  if (!canView("configuracoes"))
    return <AccessDenied message="Você não tem permissão para acessar as Configurações." />;
  const podeEditar = canEdit("configuracoes");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie centros de custo, regras e acessos.
        </p>
      </div>

      <Tabs defaultValue="cc">
        <TabsList>
          <TabsTrigger value="cc">Despesas</TabsTrigger>
          <TabsTrigger value="rev">Receitas</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="faturamento">Faturamento</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users">
              <Users className="h-3.5 w-3.5 mr-1" />
              Gerenciar Acessos
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="cc" className="mt-4">
          <CostCenters podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="rev" className="mt-4">
          <RevenueCategories podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <Rules podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="faturamento" className="mt-4">
          <FaturamentoRetroativo podeEditar={isAdmin} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UserManagement />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type PermState = Record<AppModule, { view: boolean; edit: boolean }>;

function blankPerms(value = false): PermState {
  return ALL_MODULES.reduce((acc, m) => {
    acc[m] = { view: value, edit: value };
    return acc;
  }, {} as PermState);
}

function permsToArray(p: PermState) {
  return ALL_MODULES.map((m) => ({ module: m, can_view: p[m].view, can_edit: p[m].edit }));
}

function permsFromUser(u: any): PermState {
  const base = blankPerms(false);
  for (const row of (u?.permissions ?? []) as any[]) {
    if ((ALL_MODULES as readonly string[]).includes(row.module)) {
      base[row.module as AppModule] = {
        view: !!row.can_view || !!row.can_edit,
        edit: !!row.can_edit,
      };
    }
  }
  return base;
}

// A single module row with Visualizar / Editar switches.
function PermRow({
  module,
  value,
  onChange,
  disabled,
  indent,
}: {
  module: AppModule;
  value: PermState;
  onChange: (m: AppModule, key: "view" | "edit", v: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 ${
        indent ? "bg-muted/20" : ""
      }`}
    >
      <span className="text-sm font-medium">{MODULE_LABELS[module]}</span>
      <div className="flex items-center gap-5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={value[module].view}
            disabled={disabled}
            onCheckedChange={(v) => onChange(module, "view", v)}
          />
          Visualizar
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={value[module].edit}
            disabled={disabled}
            onCheckedChange={(v) => onChange(module, "edit", v)}
          />
          Editar
        </label>
      </div>
    </div>
  );
}

function PermissionMatrix({
  value,
  onChange,
  disabled,
}: {
  value: PermState;
  onChange: (m: AppModule, key: "view" | "edit", v: boolean) => void;
  disabled?: boolean;
}) {
  const [finOpen, setFinOpen] = useState(false);
  // Financeiro is rendered as an expandable group with its sub-tabs nested.
  const topModules = APP_MODULES.filter((m) => m !== "financeiro");
  return (
    <div className="space-y-2">
      {topModules
        .filter((m) => m !== "configuracoes")
        .map((m) => (
          <PermRow key={m} module={m} value={value} onChange={onChange} disabled={disabled} />
        ))}

      <Collapsible
        open={finOpen}
        onOpenChange={setFinOpen}
        className="rounded-md border border-border"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium">
            {finOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            {MODULE_LABELS.financeiro}
          </CollapsibleTrigger>
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={value.financeiro.view}
                disabled={disabled}
                onCheckedChange={(v) => onChange("financeiro", "view", v)}
              />
              Visualizar
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={value.financeiro.edit}
                disabled={disabled}
                onCheckedChange={(v) => onChange("financeiro", "edit", v)}
              />
              Editar
            </label>
          </div>
        </div>
        <CollapsibleContent className="space-y-2 px-3 pb-3">
          <p className="text-xs text-muted-foreground">
            Controle o acesso a cada sub-aba do Financeiro. As abas só aparecem no menu se o
            módulo Financeiro estiver com <strong>Visualizar</strong> ligado.
          </p>
          {FINANCEIRO_SUBMODULES.map((sm) => (
            <PermRow
              key={sm}
              module={sm}
              value={value}
              onChange={onChange}
              disabled={disabled}
              indent
            />
          ))}
        </CollapsibleContent>
      </Collapsible>

      <PermRow module="configuracoes" value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// Enabling Edit implies View; disabling View disables Edit.
function applyPermChange(
  prev: PermState,
  m: AppModule,
  key: "view" | "edit",
  v: boolean,
): PermState {
  const next = { ...prev, [m]: { ...prev[m] } };
  if (key === "edit") {
    next[m].edit = v;
    if (v) next[m].view = true;
  } else {
    next[m].view = v;
    if (!v) next[m].edit = false;
  }
  return next;
}

// Collapsible panel used to keep the long create/edit forms tidy.
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-border bg-background"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// Multi-select of the units (schools) a user may access. No selection means the
// user is unrestricted (can access every unit).
function SchoolSelector({
  schools,
  value,
  onChange,
}: {
  schools: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (schools.length === 0)
    return <p className="text-xs text-muted-foreground">Nenhuma unidade cadastrada.</p>;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? Array.from(new Set([...value, id])) : value.filter((x) => x !== id));
  return (
    <div className="space-y-2">
      {schools.map((s) => (
        <label
          key={s.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
        >
          <span className="text-sm font-medium">{s.name}</span>
          <Switch checked={value.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v)} />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Nenhuma unidade marcada = acesso a todas as unidades.
      </p>
    </div>
  );
}

function UserManagement() {
  const qc = useQueryClient();
  const { schools } = useSchool();
  const listFn = useServerFn(listManagedUsers);
  const createFn = useServerFn(createManagedUser);
  const updateFn = useServerFn(updateUserAccess);
  const deleteFn = useServerFn(deleteManagedUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<PermState>(() => blankPerms(false));
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editPerms, setEditPerms] = useState<PermState>(() => blankPerms(false));
  const [editSchoolIds, setEditSchoolIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["managed_users"],
    queryFn: () => listFn(),
  });

  async function handleCreate() {
    if (!name.trim()) {
      return toast.error("Informe o nome do usuário.");
    }
    if (!email.trim() || password.length < 6) {
      return toast.error("Informe e-mail válido e senha com ao menos 6 caracteres.");
    }
    if (!isAdmin && schoolIds.length === 0) {
      return toast.error("Selecione ao menos uma unidade (ou marque como Administrador).");
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          name: name.trim(),
          email: email.trim(),
          password,
          isAdmin,
          permissions: permsToArray(perms),
          schoolIds,
        },
      });
      toast.success("Usuário criado.");
      setName("");
      setEmail("");
      setPassword("");
      setIsAdmin(false);
      setPerms(blankPerms(false));
      setSchoolIds([]);
      qc.invalidateQueries({ queryKey: ["managed_users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao criar usuário.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(u: any) {
    setEditingId(u.id);
    setEditName(u.name ?? "");
    setEditEmail(u.email ?? "");
    setEditPassword("");
    setEditIsAdmin(u.roles.includes("admin"));
    setEditPerms(permsFromUser(u));
    setEditSchoolIds(u.schoolIds ?? []);
  }

  async function handleSaveEdit(userId: string) {
    if (!editEmail.trim()) {
      return toast.error("Informe um e-mail válido.");
    }
    if (editPassword.length > 0 && editPassword.length < 6) {
      return toast.error("A nova senha deve ter ao menos 6 caracteres.");
    }
    if (!editIsAdmin && editSchoolIds.length === 0) {
      return toast.error("Selecione ao menos uma unidade (ou marque como Administrador).");
    }
    setSavingEdit(true);
    try {
      await updateFn({
        data: {
          userId,
          isAdmin: editIsAdmin,
          permissions: permsToArray(editPerms),
          schoolIds: editSchoolIds,
          name: editName.trim(),
          email: editEmail.trim(),
          password: editPassword,
        },
      });
      toast.success("Usuário atualizado.");
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["managed_users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar usuário.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(id: string, mail: string) {
    if (!confirm(`Excluir o acesso de ${mail}?`)) return;
    try {
      await deleteFn({ data: { userId: id } });
      toast.success("Usuário removido.");
      qc.invalidateQueries({ queryKey: ["managed_users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao excluir.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cadastrar novo usuário</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nome</label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: João da Silva"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">E-mail</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@exemplo.com"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Senha inicial</label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mín. 6 caracteres"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-medium">Administrador (acesso total)</div>
                <div className="text-xs text-muted-foreground">
                  Concede acesso completo a todos os módulos e à gestão de acessos.
                </div>
              </div>
            </div>
            <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
          </div>

          <CollapsibleSection title="Permissões por módulo">
            <PermissionMatrix
              value={isAdmin ? blankPerms(true) : perms}
              disabled={isAdmin}
              onChange={(m, key, v) => setPerms((prev) => applyPermChange(prev, m, key, v))}
            />
          </CollapsibleSection>

          <CollapsibleSection title={isAdmin ? "Unidades permitidas" : "Unidades permitidas (obrigatório)"}>
            <SchoolSelector schools={schools} value={schoolIds} onChange={setSchoolIds} />
          </CollapsibleSection>

          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={busy}>
              <Plus className="h-4 w-4" /> Adicionar usuário
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuários cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {users.map((u: any) => {
                const isAdminUser = u.roles.includes("admin");
                const editing = editingId === u.id;
                const viewModules = (u.permissions ?? [])
                  .filter(
                    (p: any) =>
                      (p.can_view || p.can_edit) &&
                      (APP_MODULES as readonly string[]).includes(p.module),
                  )
                  .map((p: any) => MODULE_LABELS[p.module as AppModule] ?? p.module);
                return (
                  <div key={u.id} className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        {u.name ? (
                          <div className="truncate text-sm font-semibold">
                            {u.name}{" "}
                            <span className="font-normal text-muted-foreground">
                              - {u.email}
                            </span>
                          </div>
                        ) : (
                          <div className="text-sm font-medium">{u.email}</div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {isAdminUser
                            ? "Administrador (acesso total)"
                            : viewModules.length > 0
                              ? `Acesso: ${viewModules.join(", ")}`
                              : "Sem permissões"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => (editing ? setEditingId(null) : startEdit(u))}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(u.id, u.email)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {editing && (
                      <div className="mt-3 space-y-3 rounded-md bg-muted/30 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Nome
                            </label>
                            <Input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Ex.: João da Silva"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              E-mail
                            </label>
                            <Input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="usuario@exemplo.com"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              Redefinir senha
                            </label>
                            <Input
                              type="text"
                              value={editPassword}
                              onChange={(e) => setEditPassword(e.target.value)}
                              placeholder="deixe em branco para manter"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                          <span className="text-sm font-medium">Administrador (acesso total)</span>
                          <Switch checked={editIsAdmin} onCheckedChange={setEditIsAdmin} />
                        </div>
                        <CollapsibleSection title="Permissões por módulo">
                          <PermissionMatrix
                            value={editIsAdmin ? blankPerms(true) : editPerms}
                            disabled={editIsAdmin}
                            onChange={(m, key, v) =>
                              setEditPerms((prev) => applyPermChange(prev, m, key, v))
                            }
                          />
                        </CollapsibleSection>
                        <CollapsibleSection title="Unidades permitidas">
                          <SchoolSelector
                            schools={schools}
                            value={editSchoolIds}
                            onChange={setEditSchoolIds}
                          />
                        </CollapsibleSection>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            <X className="h-4 w-4" /> Cancelar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(u.id)}
                            disabled={savingEdit}
                          >
                            <Check className="h-4 w-4" /> Salvar alterações
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type SchoolFaturamento = {
  id: string;
  name: string;
  faturamento_retroativo_jan_mai: number | null;
};

// Converte o texto digitado (pt-BR, ex.: "1.234,56" ou "1234,56") em número.
function parseMoedaInput(s: string): number | null {
  const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (cleaned.trim() === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Faturamento histórico Jan–Mai por unidade (denominador da Inadimplência Anual).
// Escrita restrita a administradores (RLS de public.schools); leitura aberta.
function FaturamentoRetroativo({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: schools = [], isLoading } = useQuery({
    queryKey: ["schools-faturamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("id, name, faturamento_retroativo_jan_mai")
        .order("name");
      if (error) throw error;
      return (data ?? []) as SchoolFaturamento[];
    },
  });

  const valorExibido = (s: SchoolFaturamento) =>
    valores[s.id] ??
    (s.faturamento_retroativo_jan_mai != null
      ? String(s.faturamento_retroativo_jan_mai).replace(".", ",")
      : "");

  async function salvar(s: SchoolFaturamento) {
    const raw = valores[s.id];
    if (raw === undefined) return;
    const parsed = parseMoedaInput(raw);
    if (raw.trim() !== "" && (parsed === null || parsed < 0)) {
      return toast.error("Informe um valor monetário válido.");
    }
    setSavingId(s.id);
    const { error } = await supabase
      .from("schools")
      .update({ faturamento_retroativo_jan_mai: raw.trim() === "" ? null : parsed })
      .eq("id", s.id);
    setSavingId(null);
    if (error) return toast.error(error.message);
    setValores((prev) => {
      const copy = { ...prev };
      delete copy[s.id];
      return copy;
    });
    qc.invalidateQueries({ queryKey: ["schools-faturamento"] });
    qc.invalidateQueries({ queryKey: ["faturamento-anual"] });
    toast.success(`Faturamento retroativo de ${s.name} salvo.`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Faturamento Retroativo (Janeiro a Maio)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Informe, por unidade, o faturamento histórico de <strong>Janeiro a Maio</strong>. O
          sistema só passou a registrar receitas reais a partir de Junho, então este valor compõe o
          denominador do card <strong>Inadimplência Acumulada (Ano)</strong> na tela de
          Inadimplência.
        </p>
        {!podeEditar && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Apenas administradores podem editar estes valores.
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando unidades…</p>
        ) : schools.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma unidade cadastrada.</p>
        ) : (
          <div className="space-y-2">
            {schools.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-[200px] flex-1">
                  <label className="text-xs font-medium text-muted-foreground">{s.name}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <Input
                      inputMode="decimal"
                      value={valorExibido(s)}
                      disabled={!podeEditar}
                      onChange={(e) =>
                        setValores((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                      placeholder="0,00"
                    />
                  </div>
                </div>
                {podeEditar && (
                  <Button
                    onClick={() => salvar(s)}
                    disabled={savingId === s.id || valores[s.id] === undefined}
                  >
                    {savingId === s.id ? "Salvando…" : "Salvar"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostCenters({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingCC, setEditingCC] = useState<string | null>(null);
  const [editCCName, setEditCCName] = useState("");
  const [editCCColor, setEditCCColor] = useState("#3b82f6");
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState("");

  const { data: ccs = [] } = useQuery({
    queryKey: ["cc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_centers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: subs = [] } = useQuery({
    queryKey: ["sub_cc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_cost_centers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["cc"] });
    qc.invalidateQueries({ queryKey: ["sub_cc"] });
    qc.invalidateQueries({ queryKey: ["refs"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  async function add() {
    if (!name.trim()) return;
    const { error } = await supabase.from("cost_centers").insert({ name: name.trim(), color });
    if (error) return toast.error(error.message);
    setName("");
    setColor("#3b82f6");
    invalidateAll();
    toast.success("Centro de custo criado.");
  }

  async function remove(id: string) {
    if (
      !confirm("Excluir este centro de custo? Subcentros e vínculos em transações serão removidos.")
    )
      return;
    const { error } = await supabase.from("cost_centers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidateAll();
  }

  function startEditCC(cc: { id: string; name: string; color: string }) {
    setEditingCC(cc.id);
    setEditCCName(cc.name);
    setEditCCColor(cc.color);
  }

  async function saveEditCC(id: string) {
    if (!editCCName.trim()) return;
    const { error } = await supabase
      .from("cost_centers")
      .update({ name: editCCName.trim(), color: editCCColor })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setEditingCC(null);
    invalidateAll();
  }

  async function addSub(ccId: string) {
    const n = (newSubName[ccId] ?? "").trim();
    if (!n) return;
    const { error } = await supabase
      .from("sub_cost_centers")
      .insert({ cost_center_id: ccId, name: n });
    if (error) return toast.error(error.message);
    setNewSubName((prev) => ({ ...prev, [ccId]: "" }));
    invalidateAll();
  }

  async function removeSub(id: string) {
    if (!confirm("Excluir este subcentro?")) return;
    const { error } = await supabase.from("sub_cost_centers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidateAll();
  }

  async function saveEditSub(id: string) {
    if (!editSubName.trim()) return;
    const { error } = await supabase
      .from("sub_cost_centers")
      .update({ name: editSubName.trim() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setEditingSub(null);
    invalidateAll();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Centros de Custo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {podeEditar && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">Nome</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Material Escolar"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Cor</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-md border border-input bg-transparent"
              />
            </div>
            <Button onClick={add}>
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>
        )}

        <div className="divide-y divide-border rounded-lg border border-border">
          {ccs.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Nenhum centro de custo ainda.</div>
          )}
          {ccs.map((cc) => {
            const ccSubs = subs.filter((s) => s.cost_center_id === cc.id);
            const isOpen = expanded[cc.id] ?? false;
            const isEditing = editingCC === cc.id;
            return (
              <div key={cc.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [cc.id]: !isOpen }))}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    {isEditing ? (
                      <div
                        className="flex flex-1 items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="color"
                          value={editCCColor}
                          onChange={(e) => setEditCCColor(e.target.value)}
                          className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent"
                        />
                        <Input
                          value={editCCName}
                          onChange={(e) => setEditCCName(e.target.value)}
                          className="h-8 max-w-xs"
                        />
                      </div>
                    ) : (
                      <>
                        <span className="h-4 w-4 rounded" style={{ background: cc.color }} />
                        <span className="font-medium">{cc.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({ccSubs.length} subcentro{ccSubs.length === 1 ? "" : "s"})
                        </span>
                      </>
                    )}
                  </button>
                  {podeEditar && (
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => saveEditCC(cc.id)}>
                            <Check className="h-4 w-4 text-success" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCC(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startEditCC(cc)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(cc.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-3 ml-6 space-y-2 border-l-2 border-border pl-4">
                    {ccSubs.length === 0 && (
                      <div className="text-xs text-muted-foreground">Nenhum subcentro.</div>
                    )}
                    {ccSubs.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between gap-2">
                        {editingSub === sub.id ? (
                          <>
                            <Input
                              value={editSubName}
                              onChange={(e) => setEditSubName(e.target.value)}
                              className="h-8 max-w-xs"
                            />
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => saveEditSub(sub.id)}>
                                <Check className="h-4 w-4 text-success" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingSub(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-sm">{sub.name}</span>
                            {podeEditar && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingSub(sub.id);
                                    setEditSubName(sub.name);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => removeSub(sub.id)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    {podeEditar && (
                      <div className="flex items-end gap-2 pt-1">
                        <Input
                          value={newSubName[cc.id] ?? ""}
                          onChange={(e) =>
                            setNewSubName((p) => ({ ...p, [cc.id]: e.target.value }))
                          }
                          placeholder="Novo subcentro…"
                          className="h-8 max-w-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addSub(cc.id);
                          }}
                        />
                        <Button size="sm" onClick={() => addSub(cc.id)}>
                          <Plus className="h-3.5 w-3.5" /> Subcentro
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Rules({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [kind, setKind] = useState<"expense" | "revenue">("expense");
  const [ccId, setCcId] = useState<string>("");
  const [subCcId, setSubCcId] = useState<string>("");
  const [revCatId, setRevCatId] = useState<string>("");
  const [revSubId, setRevSubId] = useState<string>("");

  const { data: ccs = [] } = useQuery({
    queryKey: ["cc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_centers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: subCcs = [] } = useQuery({
    queryKey: ["sub_cc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_cost_centers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: revCats = [] } = useQuery({
    queryKey: ["rev_cat"],
    queryFn: async () => {
      const { data, error } = await supabase.from("revenue_categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: revSubs = [] } = useQuery({
    queryKey: ["rev_sub"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_subcategories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const { data: rules = [] } = useQuery({
    queryKey: ["rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorization_rules")
        .select(
          "*, cost_centers(name, color), sub_cost_centers(name), revenue_categories(name), revenue_subcategories(name)",
        )
        .order("keyword");
      if (error) throw error;
      return data;
    },
  });

  const filteredSubCcs = subCcs.filter((s: any) => s.cost_center_id === ccId);
  const filteredRevSubs = revSubs.filter((s: any) => s.revenue_category_id === revCatId);

  function resetRefs() {
    setCcId("");
    setSubCcId("");
    setRevCatId("");
    setRevSubId("");
  }

  async function add() {
    const kw = keyword.trim();
    if (!kw) return toast.error("Informe a palavra-chave.");
    if (kind === "expense" && !ccId) return toast.error("Selecione a categoria de Despesa.");
    if (kind === "revenue" && !revCatId) return toast.error("Selecione a categoria de Receita.");
    // Allow same keyword across different kinds (e.g. "COB COMPE" como Receita e Despesa),
    // but bloqueia duplicata exata (mesma keyword + mesmo tipo).
    const dup = (rules as any[]).some(
      (r) =>
        String(r.keyword).trim().toLowerCase() === kw.toLowerCase() &&
        (r.kind ?? "expense") === kind,
    );
    if (dup)
      return toast.error(
        `Já existe uma regra de ${kind === "expense" ? "Despesa" : "Receita"} com essa palavra-chave.`,
      );
    const payload: any = {
      keyword: kw,
      kind,
      cost_center_id: kind === "expense" ? ccId : null,
      sub_cost_center_id: kind === "expense" ? subCcId || null : null,
      revenue_category_id: kind === "revenue" ? revCatId : null,
      revenue_subcategory_id: kind === "revenue" ? revSubId || null : null,
    };
    const { error } = await supabase.from("categorization_rules").insert(payload);
    if (error) return toast.error(error.message);
    setKeyword("");
    resetRefs();
    qc.invalidateQueries({ queryKey: ["rules"] });
    qc.invalidateQueries({ queryKey: ["refs"] });
    toast.success("Regra criada.");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("categorization_rules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["rules"] });
    qc.invalidateQueries({ queryKey: ["refs"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Regras de Categorização</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Quando a descrição da transação contiver a palavra-chave, ela será categorizada
          automaticamente. Regras de Despesa se aplicam a valores negativos; regras de Receita a
          valores positivos.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {podeEditar && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Palavra-chave</label>
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Ex.: Supermercado"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">
                Tipo de Regra
              </label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as any);
                  resetRefs();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Despesa</SelectItem>
                  <SelectItem value="revenue">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {kind === "expense" ? (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block">
                    Categoria de Despesa
                  </label>
                  <Select
                    value={ccId}
                    onValueChange={(v) => {
                      setCcId(v);
                      setSubCcId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar…" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...ccs]
                        .sort((a: any, b: any) => a.name.localeCompare(b.name))
                        .map((cc: any) => (
                          <SelectItem key={cc.id} value={cc.id}>
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: cc.color }}
                              />
                              {cc.name}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block">
                    Subcategoria de Despesa (opcional)
                  </label>
                  <Select
                    value={subCcId}
                    onValueChange={setSubCcId}
                    disabled={!ccId || filteredSubCcs.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!ccId ? "Selecione a categoria…" : "Selecionar…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {[...filteredSubCcs]
                        .sort((a: any, b: any) => a.name.localeCompare(b.name))
                        .map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block">
                    Categoria de Receita
                  </label>
                  <Select
                    value={revCatId}
                    onValueChange={(v) => {
                      setRevCatId(v);
                      setRevSubId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar…" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...revCats]
                        .sort((a: any, b: any) => a.name.localeCompare(b.name))
                        .map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block">
                    Subcategoria de Receita (opcional)
                  </label>
                  <Select
                    value={revSubId}
                    onValueChange={setRevSubId}
                    disabled={!revCatId || filteredRevSubs.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={!revCatId ? "Selecione a categoria…" : "Selecionar…"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {[...filteredRevSubs]
                        .sort((a: any, b: any) => a.name.localeCompare(b.name))
                        .map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}
        {podeEditar && (
          <div>
            <Button onClick={add}>
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>
        )}

        <div className="divide-y divide-border rounded-lg border border-border">
          {rules.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Nenhuma regra ainda.</div>
          )}
          {rules.map((r: any) => {
            const isRev = r.kind === "revenue";
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className={`text-[10px] uppercase font-semibold rounded px-1.5 py-0.5 ${isRev ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}
                  >
                    {isRev ? "Receita" : "Despesa"}
                  </span>
                  <span className="font-medium">"{r.keyword}"</span>
                  <span className="text-muted-foreground text-sm">→</span>
                  {isRev ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-2 py-0.5 text-xs">
                      {r.revenue_categories?.name}
                      {r.revenue_subcategories?.name && (
                        <span className="text-muted-foreground">
                          › {r.revenue_subcategories.name}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-2 py-0.5 text-xs">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: r.cost_centers?.color }}
                      />
                      {r.cost_centers?.name}
                      {r.sub_cost_centers?.name && (
                        <span className="text-muted-foreground">› {r.sub_cost_centers.name}</span>
                      )}
                    </span>
                  )}
                </div>
                {podeEditar && (
                  <Button size="sm" variant="ghost" onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueCategories({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatColor, setEditCatColor] = useState("#10b981");
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState("");

  const { data: cats = [] } = useQuery({
    queryKey: ["rev_cat"],
    queryFn: async () => {
      const { data, error } = await supabase.from("revenue_categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: subs = [] } = useQuery({
    queryKey: ["rev_sub"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_subcategories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["rev_cat"] });
    qc.invalidateQueries({ queryKey: ["rev_sub"] });
    qc.invalidateQueries({ queryKey: ["refs"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  async function add() {
    if (!name.trim()) return;
    const { error } = await supabase
      .from("revenue_categories")
      .insert({ name: name.trim(), color } as any);
    if (error) return toast.error(error.message);
    setName("");
    setColor("#10b981");
    invalidateAll();
    toast.success("Categoria de receita criada.");
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta categoria? Subcategorias e vínculos serão removidos.")) return;
    const { error } = await supabase.from("revenue_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidateAll();
  }

  function startEditCat(cat: { id: string; name: string; color?: string }) {
    setEditingCat(cat.id);
    setEditCatName(cat.name);
    setEditCatColor(cat.color ?? "#10b981");
  }

  async function saveEditCat(id: string) {
    if (!editCatName.trim()) return;
    const { error } = await supabase
      .from("revenue_categories")
      .update({ name: editCatName.trim(), color: editCatColor } as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    setEditingCat(null);
    invalidateAll();
  }

  async function addSub(catId: string) {
    const n = (newSubName[catId] ?? "").trim();
    if (!n) return;
    const { error } = await supabase
      .from("revenue_subcategories")
      .insert({ revenue_category_id: catId, name: n });
    if (error) return toast.error(error.message);
    setNewSubName((prev) => ({ ...prev, [catId]: "" }));
    invalidateAll();
  }

  async function removeSub(id: string) {
    if (!confirm("Excluir esta subcategoria?")) return;
    const { error } = await supabase.from("revenue_subcategories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidateAll();
  }

  async function saveEditSub(id: string) {
    if (!editSubName.trim()) return;
    const { error } = await supabase
      .from("revenue_subcategories")
      .update({ name: editSubName.trim() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setEditingSub(null);
    invalidateAll();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categorias de Receita</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {podeEditar && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-muted-foreground">Nome da categoria</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Mensalidades"
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block">Cor</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-md border border-input bg-transparent"
              />
            </div>
            <Button onClick={add}>
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>
        )}

        <div className="divide-y divide-border rounded-lg border border-border">
          {cats.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              Nenhuma categoria de receita ainda.
            </div>
          )}
          {cats.map((cat: any) => {
            const catSubs = subs.filter((s) => s.revenue_category_id === cat.id);
            const isOpen = expanded[cat.id] ?? false;
            const isEditing = editingCat === cat.id;
            return (
              <div key={cat.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [cat.id]: !isOpen }))}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    {isEditing ? (
                      <div
                        className="flex flex-1 items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="color"
                          value={editCatColor}
                          onChange={(e) => setEditCatColor(e.target.value)}
                          className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent"
                        />
                        <Input
                          value={editCatName}
                          onChange={(e) => setEditCatName(e.target.value)}
                          className="h-8 max-w-xs"
                        />
                      </div>
                    ) : (
                      <>
                        <span
                          className="h-4 w-4 rounded"
                          style={{ background: cat.color ?? "#10b981" }}
                        />
                        <span className="font-medium">{cat.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({catSubs.length} subcategoria{catSubs.length === 1 ? "" : "s"})
                        </span>
                      </>
                    )}
                  </button>
                  {podeEditar && (
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => saveEditCat(cat.id)}>
                            <Check className="h-4 w-4 text-success" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCat(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startEditCat(cat)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(cat.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-3 ml-6 space-y-2 border-l-2 border-border pl-4">
                    {catSubs.length === 0 && (
                      <div className="text-xs text-muted-foreground">Nenhuma subcategoria.</div>
                    )}
                    {catSubs.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between gap-2">
                        {editingSub === sub.id ? (
                          <>
                            <Input
                              value={editSubName}
                              onChange={(e) => setEditSubName(e.target.value)}
                              className="h-8 max-w-xs"
                            />
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => saveEditSub(sub.id)}>
                                <Check className="h-4 w-4 text-success" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingSub(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-sm">{sub.name}</span>
                            {podeEditar && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingSub(sub.id);
                                    setEditSubName(sub.name);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => removeSub(sub.id)}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    {podeEditar && (
                      <div className="flex items-end gap-2 pt-1">
                        <Input
                          value={newSubName[cat.id] ?? ""}
                          onChange={(e) =>
                            setNewSubName((p) => ({ ...p, [cat.id]: e.target.value }))
                          }
                          placeholder="Nova subcategoria…"
                          className="h-8 max-w-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addSub(cat.id);
                          }}
                        />
                        <Button size="sm" onClick={() => addSub(cat.id)}>
                          <Plus className="h-3.5 w-3.5" /> Subcategoria
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
