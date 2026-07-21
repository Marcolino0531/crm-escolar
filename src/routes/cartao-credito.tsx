import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, CreditCard, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions, useSchool } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { parseBRLNumber, formatBRLInput } from "@/lib/currency";
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
import { Badge } from "@/components/ui/badge";
import { formatDateBR, todayISOLocal } from "@/lib/date-utils";

export const Route = createFileRoute("/cartao-credito")({
  head: () => ({ meta: [{ title: "Cartão de Crédito — School Hub" }] }),
  component: CartaoGate,
});

function CartaoGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro_cartao"))
    return (
      <AccessDenied message="Você não tem permissão para visualizar o Controle de Recebíveis." />
    );
  return <CartaoPage />;
}

type ReceivableStatus = "aguardando" | "disponivel" | "transferido";

type Receivable = {
  id: string;
  data_pagamento: string;
  data_disponibilidade: string;
  valor_bruto: number;
  valor_liquido: number;
  status: ReceivableStatus;
  unit_id: string | null;
};

function fmtBRL(n: number) {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Status "efetivo": mesmo antes do cron diário rodar, um recebível cuja data de
// disponibilidade já chegou é tratado como 'disponivel' na interface.
function effectiveStatus(r: Receivable, today: string): ReceivableStatus {
  if (r.status === "aguardando" && r.data_disponibilidade <= today) return "disponivel";
  return r.status;
}

const STATUS_META: Record<ReceivableStatus, { label: string; className: string }> = {
  aguardando: { label: "Aguardando", className: "bg-amber-100 text-amber-800" },
  disponivel: { label: "Disponível", className: "bg-emerald-100 text-emerald-800" },
  transferido: { label: "Transferido", className: "bg-slate-100 text-slate-700" },
};

function CartaoPage() {
  const { session } = useAuth();
  const { canEdit } = usePermissions();
  const { selected, schoolFilterIds, schools } = useSchool();
  const editable = canEdit("financeiro_cartao");
  const qc = useQueryClient();
  const today = todayISOLocal();
  const schoolNameById = useMemo(() => new Map(schools.map((s) => [s.id, s.name])), [schools]);
  const [showCreate, setShowCreate] = useState(false);

  const { data: receivables = [], isLoading } = useQuery({
    queryKey: ["credit_card_receivables", schoolFilterIds ?? "all"],
    refetchInterval: 60000,
    queryFn: async () => {
      let rq = supabase
        .from("credit_card_receivables" as never)
        .select(
          "id, data_pagamento, data_disponibilidade, valor_bruto, valor_liquido, status, unit_id",
        )
        .order("data_disponibilidade", { ascending: true });
      if (schoolFilterIds) rq = rq.in("unit_id", schoolFilterIds as never);
      const { data, error } = await rq;
      if (error) throw error;
      return (data ?? []) as unknown as Receivable[];
    },
  });

  const create = useMutation({
    mutationFn: async (p: {
      data_pagamento: string;
      data_disponibilidade: string;
      valor_bruto: number;
      valor_liquido: number;
    }) => {
      if (selected === "all") {
        throw new Error(
          "Selecione uma unidade específica no seletor do topo para cadastrar um recebível.",
        );
      }
      const { error } = await supabase.from("credit_card_receivables" as never).insert({
        ...p,
        unit_id: selected,
        created_by: session?.user?.id ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit_card_receivables"] });
      qc.invalidateQueries({ queryKey: ["credit_card_available"] });
      toast.success("Recebível registrado.");
      setShowCreate(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erro ao registrar recebível."),
  });

  const transferir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("credit_card_receivables" as never)
        .update({ status: "transferido" } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit_card_receivables"] });
      qc.invalidateQueries({ queryKey: ["credit_card_available"] });
      toast.success("Recebível marcado como transferido.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao transferir."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("credit_card_receivables" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit_card_receivables"] });
      qc.invalidateQueries({ queryKey: ["credit_card_available"] });
      toast.success("Recebível removido.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao remover."),
  });

  const totals = useMemo(() => {
    let disponivel = 0;
    let aguardando = 0;
    for (const r of receivables) {
      const st = effectiveStatus(r, today);
      if (st === "disponivel") disponivel += Number(r.valor_liquido) || 0;
      else if (st === "aguardando") aguardando += Number(r.valor_liquido) || 0;
    }
    return { disponivel, aguardando };
  }, [receivables, today]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CreditCard className="h-6 w-6" /> Cartão de Crédito
          </h1>
          <p className="text-sm text-muted-foreground">
            Controle dos recebíveis de cartão: liberação pela operadora e transferência para a conta
            do colégio.
          </p>
        </div>
        {editable && (
          <Button
            size="sm"
            className="gap-1"
            disabled={selected === "all"}
            title={
              selected === "all"
                ? "Selecione uma unidade específica no topo para cadastrar"
                : undefined
            }
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" /> Novo Recebível
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Disponível para transferir
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold text-emerald-600">{fmtBRL(totals.disponivel)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Aguardando liberação</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold text-amber-600">{fmtBRL(totals.aguardando)}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recebíveis</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : receivables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum recebível registrado. Clique em "Novo Recebível" para começar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Disponibilidade</TableHead>
                  <TableHead className="text-right">Valor Bruto</TableHead>
                  <TableHead className="text-right">Valor Líquido</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivables.map((r) => {
                  const st = effectiveStatus(r, today);
                  const meta = STATUS_META[st];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {(r.unit_id && schoolNameById.get(r.unit_id)) || "—"}
                      </TableCell>
                      <TableCell>{formatDateBR(r.data_pagamento)}</TableCell>
                      <TableCell>{formatDateBR(r.data_disponibilidade)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtBRL(r.valor_bruto)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtBRL(r.valor_liquido)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`text-xs ${meta.className}`}>
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1"
                              disabled={st !== "disponivel" || transferir.isPending}
                              onClick={() => transferir.mutate(r.id)}
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" /> Transferir para Conta
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Remover"
                              onClick={() => {
                                if (confirm("Remover este recebível?")) remover.mutate(r.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editable && (
        <NovoRecebivelDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          defaultDate={today}
          saving={create.isPending}
          onSave={(p) => create.mutate(p)}
        />
      )}
    </div>
  );
}

function NovoRecebivelDialog({
  open,
  onClose,
  defaultDate,
  saving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  saving: boolean;
  onSave: (p: {
    data_pagamento: string;
    data_disponibilidade: string;
    valor_bruto: number;
    valor_liquido: number;
  }) => void;
}) {
  const [dataPagamento, setDataPagamento] = useState(defaultDate);
  const [dataDisp, setDataDisp] = useState("");
  const [valorBruto, setValorBruto] = useState("");
  const [valorLiquido, setValorLiquido] = useState("");

  const reset = () => {
    setDataPagamento(defaultDate);
    setDataDisp("");
    setValorBruto("");
    setValorLiquido("");
  };

  const bruto = parseBRLNumber(valorBruto);
  const liquido = parseBRLNumber(valorLiquido);
  const valid = !!dataPagamento && !!dataDisp && Number.isFinite(bruto) && Number.isFinite(liquido);

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
          <DialogTitle>Novo Recebível</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rec-pagamento">Data do Pagamento</Label>
              <Input
                id="rec-pagamento"
                type="date"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-disp">Data de Disponibilidade</Label>
              <Input
                id="rec-disp"
                type="date"
                value={dataDisp}
                onChange={(e) => setDataDisp(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rec-bruto">Valor Bruto (R$)</Label>
              <Input
                id="rec-bruto"
                inputMode="decimal"
                value={valorBruto}
                onChange={(e) => setValorBruto(e.target.value)}
                onBlur={() => {
                  const n = parseBRLNumber(valorBruto);
                  if (Number.isFinite(n)) setValorBruto(formatBRLInput(n));
                }}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-liquido">Valor Líquido (R$)</Label>
              <Input
                id="rec-liquido"
                inputMode="decimal"
                value={valorLiquido}
                onChange={(e) => setValorLiquido(e.target.value)}
                onBlur={() => {
                  const n = parseBRLNumber(valorLiquido);
                  if (Number.isFinite(n)) setValorLiquido(formatBRLInput(n));
                }}
                placeholder="0,00"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Cancelar
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={() => {
              onSave({
                data_pagamento: dataPagamento,
                data_disponibilidade: dataDisp,
                valor_bruto: bruto,
                valor_liquido: liquido,
              });
              reset();
            }}
          >
            {saving ? "Salvando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
