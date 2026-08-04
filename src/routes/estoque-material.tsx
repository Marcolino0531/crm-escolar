// Estoque de Material Escolar — tabela única compartilhada entre as quatro
// unidades (sem filtro por colégio). Controle simples de material pedagógico
// por turma e quantidade, com adicionar/editar/excluir.

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/lib/app-context";
import { normalizarQuantidade } from "@/lib/estoque-material";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/estoque-material")({
  head: () => ({ meta: [{ title: "Estoque de Material Escolar — School Hub" }] }),
  component: EstoqueMaterialGate,
});

function EstoqueMaterialGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("estoque_material"))
    return (
      <AccessDenied message="Você não tem permissão para acessar o Estoque de Material Escolar." />
    );
  return <EstoqueMaterialPage />;
}

type MaterialStock = {
  id: string;
  material: string;
  turma: string;
  quantidade: number;
  created_at: string;
};

type FormValues = { material: string; turma: string; quantidade: number };

function EstoqueMaterialPage() {
  const { canEdit } = usePermissions();
  const editable = canEdit("estoque_material");
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<MaterialStock | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["school_material_stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_material_stock" as any)
        .select("*")
        .order("material", { ascending: true })
        .order("turma", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MaterialStock[];
    },
  });

  const createItem = useMutation({
    mutationFn: async (payload: FormValues) => {
      const { error } = await supabase.from("school_material_stock" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["school_material_stock"] });
      toast.success("Registro adicionado.");
      setShowCreate(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar registro."),
  });

  const updateItem = useMutation({
    mutationFn: async (payload: { id: string; quantidade: number }) => {
      const { error } = await supabase
        .from("school_material_stock" as any)
        .update({ quantidade: payload.quantidade })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["school_material_stock"] });
      toast.success("Quantidade atualizada.");
      setEditItem(null);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar quantidade."),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("school_material_stock" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["school_material_stock"] });
      toast.success("Registro excluído.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erro ao excluir registro."),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Package className="h-6 w-6 text-primary" /> Estoque de Material Escolar
          </h1>
          <p className="text-sm text-muted-foreground">
            Controle de material pedagógico por turma. Listagem única compartilhada entre todas as
            unidades.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Novo Registro
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Materiais em Estoque</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum registro cadastrado.{" "}
              {editable ? 'Clique em "Novo Registro" para começar.' : ""}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material Pedagógico</TableHead>
                  <TableHead>Turma</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  {editable && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.material}</TableCell>
                    <TableCell>{row.turma}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.quantidade}</TableCell>
                    {editable && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Editar quantidade"
                            onClick={() => setEditItem(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Excluir registro"
                            onClick={() => {
                              if (confirm(`Excluir "${row.material}" da turma "${row.turma}"?`))
                                deleteItem.mutate(row.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSave={(p) => createItem.mutate(p)}
        saving={createItem.isPending}
      />

      {editItem && (
        <EditQuantityDialog
          item={editItem}
          open
          onClose={() => setEditItem(null)}
          onSave={(quantidade) => updateItem.mutate({ id: editItem.id, quantidade })}
          saving={updateItem.isPending}
        />
      )}
    </div>
  );
}

function CreateDialog({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (p: FormValues) => void;
  saving: boolean;
}) {
  const [material, setMaterial] = useState("");
  const [turma, setTurma] = useState("");
  const [quantidade, setQuantidade] = useState("");

  const reset = () => {
    setMaterial("");
    setTurma("");
    setQuantidade("");
  };

  const canSave = material.trim() !== "" && turma.trim() !== "";

  const submit = () => {
    if (!canSave) return;
    onSave({
      material: material.trim(),
      turma: turma.trim(),
      quantidade: normalizarQuantidade(quantidade),
    });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Registro</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Material Pedagógico</Label>
            <Input
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="Ex.: Lápis de cor"
            />
          </div>
          <div>
            <Label>Turma</Label>
            <Input
              value={turma}
              onChange={(e) => setTurma(e.target.value)}
              placeholder="Ex.: Maternal II"
            />
          </div>
          <div>
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSave || saving}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditQuantityDialog({
  item,
  open,
  onClose,
  onSave,
  saving,
}: {
  item: MaterialStock;
  open: boolean;
  onClose: () => void;
  onSave: (quantidade: number) => void;
  saving: boolean;
}) {
  const [quantidade, setQuantidade] = useState(String(item.quantidade));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Quantidade</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {item.material} · {item.turma}
          </p>
          <div>
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(normalizarQuantidade(quantidade))} disabled={saving}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
