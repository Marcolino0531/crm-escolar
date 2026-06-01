import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

type Kind = "expense" | "revenue";

interface Props {
  trigger: React.ReactNode;
  defaultKind?: Kind;
}

export function CategoryManagerDialog({ trigger, defaultKind = "expense" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerenciar Categorias</DialogTitle>
          <DialogDescription>
            Crie ou edite categorias e subcategorias sem sair da tela.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={defaultKind}>
          <TabsList>
            <TabsTrigger value="expense">Despesas (Centros de Custo)</TabsTrigger>
            <TabsTrigger value="revenue">Receitas</TabsTrigger>
          </TabsList>
          <TabsContent value="expense" className="mt-4">
            <ExpenseManager />
          </TabsContent>
          <TabsContent value="revenue" className="mt-4">
            <RevenueManager />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["cc"] });
    qc.invalidateQueries({ queryKey: ["sub_cc"] });
    qc.invalidateQueries({ queryKey: ["rev_cat"] });
    qc.invalidateQueries({ queryKey: ["rev_sub"] });
    qc.invalidateQueries({ queryKey: ["refs"] });
  };
}

function ExpenseManager() {
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingCC, setEditingCC] = useState<string | null>(null);
  const [editCCName, setEditCCName] = useState("");
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState("");

  const { data: ccs = [] } = useQuery({
    queryKey: ["cc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_centers").select("*").order("name");
      if (error) throw error; return data;
    },
  });
  const { data: subs = [] } = useQuery({
    queryKey: ["sub_cc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_cost_centers").select("*").order("name");
      if (error) throw error; return data;
    },
  });

  async function add() {
    if (!name.trim()) return;
    const { error } = await supabase.from("cost_centers").insert({ name: name.trim(), color });
    if (error) return toast.error(error.message);
    setName(""); invalidate(); toast.success("Centro criado.");
  }
  async function remove(id: string) {
    if (!confirm("Excluir este centro de custo?")) return;
    const { error } = await supabase.from("cost_centers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }
  async function saveEdit(id: string) {
    if (!editCCName.trim()) return;
    const { error } = await supabase.from("cost_centers").update({ name: editCCName.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingCC(null); invalidate();
  }
  async function addSub(ccId: string) {
    const n = (newSubName[ccId] ?? "").trim();
    if (!n) return;
    const { error } = await supabase.from("sub_cost_centers").insert({ cost_center_id: ccId, name: n });
    if (error) return toast.error(error.message);
    setNewSubName(p => ({ ...p, [ccId]: "" })); invalidate();
  }
  async function removeSub(id: string) {
    if (!confirm("Excluir subcentro?")) return;
    const { error } = await supabase.from("sub_cost_centers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }
  async function saveEditSub(id: string) {
    if (!editSubName.trim()) return;
    const { error } = await supabase.from("sub_cost_centers").update({ name: editSubName.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingSub(null); invalidate();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nova categoria…" className="flex-1 min-w-[180px]" />
        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-input bg-transparent" />
        <Button size="sm" onClick={add}><Plus className="h-4 w-4" /> Adicionar</Button>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border max-h-[400px] overflow-y-auto">
        {ccs.length === 0 && <div className="p-3 text-sm text-muted-foreground">Nenhuma categoria.</div>}
        {ccs.map(cc => {
          const ccSubs = subs.filter(s => s.cost_center_id === cc.id);
          const isOpen = expanded[cc.id] ?? false;
          const isEditing = editingCC === cc.id;
          return (
            <div key={cc.id} className="p-2">
              <div className="flex items-center gap-2">
                <button onClick={() => setExpanded(p => ({ ...p, [cc.id]: !isOpen }))} className="flex flex-1 items-center gap-2 text-left">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  {isEditing ? (
                    <Input value={editCCName} onChange={e => setEditCCName(e.target.value)} className="h-8 max-w-xs" onClick={e => e.stopPropagation()} />
                  ) : (
                    <>
                      <span className="h-3 w-3 rounded-full" style={{ background: cc.color }} />
                      <span className="text-sm font-medium">{cc.name}</span>
                      <span className="text-xs text-muted-foreground">({ccSubs.length})</span>
                    </>
                  )}
                </button>
                {isEditing ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => saveEdit(cc.id)}><Check className="h-4 w-4 text-success" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingCC(null)}><X className="h-4 w-4" /></Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingCC(cc.id); setEditCCName(cc.name); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(cc.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </>
                )}
              </div>
              {isOpen && (
                <div className="mt-2 ml-6 space-y-1.5 border-l-2 border-border pl-3">
                  {ccSubs.map(sub => (
                    <div key={sub.id} className="flex items-center gap-2">
                      {editingSub === sub.id ? (
                        <>
                          <Input value={editSubName} onChange={e => setEditSubName(e.target.value)} className="h-7 max-w-xs" />
                          <Button size="sm" variant="ghost" onClick={() => saveEditSub(sub.id)}><Check className="h-3.5 w-3.5 text-success" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingSub(null)}><X className="h-3.5 w-3.5" /></Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{sub.name}</span>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingSub(sub.id); setEditSubName(sub.name); }}><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => removeSub(sub.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Input value={newSubName[cc.id] ?? ""} onChange={e => setNewSubName(p => ({ ...p, [cc.id]: e.target.value }))} placeholder="Novo subcentro…" className="h-7 max-w-xs" onKeyDown={e => { if (e.key === "Enter") addSub(cc.id); }} />
                    <Button size="sm" variant="outline" onClick={() => addSub(cc.id)}><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevenueManager() {
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [newSubName, setNewSubName] = useState<Record<string, string>>({});
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubName, setEditSubName] = useState("");

  const { data: cats = [] } = useQuery({
    queryKey: ["rev_cat"],
    queryFn: async () => {
      const { data, error } = await supabase.from("revenue_categories").select("*").order("name");
      if (error) throw error; return data;
    },
  });
  const { data: subs = [] } = useQuery({
    queryKey: ["rev_sub"],
    queryFn: async () => {
      const { data, error } = await supabase.from("revenue_subcategories").select("*").order("name");
      if (error) throw error; return data;
    },
  });

  async function add() {
    if (!name.trim()) return;
    const { error } = await supabase.from("revenue_categories").insert({ name: name.trim() });
    if (error) return toast.error(error.message);
    setName(""); invalidate(); toast.success("Categoria criada.");
  }
  async function remove(id: string) {
    if (!confirm("Excluir categoria?")) return;
    const { error } = await supabase.from("revenue_categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }
  async function saveEdit(id: string) {
    if (!editCatName.trim()) return;
    const { error } = await supabase.from("revenue_categories").update({ name: editCatName.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingCat(null); invalidate();
  }
  async function addSub(catId: string) {
    const n = (newSubName[catId] ?? "").trim();
    if (!n) return;
    const { error } = await supabase.from("revenue_subcategories").insert({ revenue_category_id: catId, name: n });
    if (error) return toast.error(error.message);
    setNewSubName(p => ({ ...p, [catId]: "" })); invalidate();
  }
  async function removeSub(id: string) {
    if (!confirm("Excluir subcategoria?")) return;
    const { error } = await supabase.from("revenue_subcategories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  }
  async function saveEditSub(id: string) {
    if (!editSubName.trim()) return;
    const { error } = await supabase.from("revenue_subcategories").update({ name: editSubName.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingSub(null); invalidate();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nova categoria de receita…" className="flex-1 min-w-[180px]" />
        <Button size="sm" onClick={add}><Plus className="h-4 w-4" /> Adicionar</Button>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border max-h-[400px] overflow-y-auto">
        {cats.length === 0 && <div className="p-3 text-sm text-muted-foreground">Nenhuma categoria.</div>}
        {cats.map(cat => {
          const cSubs = subs.filter(s => s.revenue_category_id === cat.id);
          const isOpen = expanded[cat.id] ?? false;
          const isEditing = editingCat === cat.id;
          return (
            <div key={cat.id} className="p-2">
              <div className="flex items-center gap-2">
                <button onClick={() => setExpanded(p => ({ ...p, [cat.id]: !isOpen }))} className="flex flex-1 items-center gap-2 text-left">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  {isEditing ? (
                    <Input value={editCatName} onChange={e => setEditCatName(e.target.value)} className="h-8 max-w-xs" onClick={e => e.stopPropagation()} />
                  ) : (
                    <>
                      <span className="text-sm font-medium">{cat.name}</span>
                      <span className="text-xs text-muted-foreground">({cSubs.length})</span>
                    </>
                  )}
                </button>
                {isEditing ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => saveEdit(cat.id)}><Check className="h-4 w-4 text-success" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingCat(null)}><X className="h-4 w-4" /></Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingCat(cat.id); setEditCatName(cat.name); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(cat.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </>
                )}
              </div>
              {isOpen && (
                <div className="mt-2 ml-6 space-y-1.5 border-l-2 border-border pl-3">
                  {cSubs.map(sub => (
                    <div key={sub.id} className="flex items-center gap-2">
                      {editingSub === sub.id ? (
                        <>
                          <Input value={editSubName} onChange={e => setEditSubName(e.target.value)} className="h-7 max-w-xs" />
                          <Button size="sm" variant="ghost" onClick={() => saveEditSub(sub.id)}><Check className="h-3.5 w-3.5 text-success" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingSub(null)}><X className="h-3.5 w-3.5" /></Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">{sub.name}</span>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingSub(sub.id); setEditSubName(sub.name); }}><Pencil className="h-3 w-3" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => removeSub(sub.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Input value={newSubName[cat.id] ?? ""} onChange={e => setNewSubName(p => ({ ...p, [cat.id]: e.target.value }))} placeholder="Nova subcategoria…" className="h-7 max-w-xs" onKeyDown={e => { if (e.key === "Enter") addSub(cat.id); }} />
                    <Button size="sm" variant="outline" onClick={() => addSub(cat.id)}><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
