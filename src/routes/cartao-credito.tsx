import { createFileRoute } from "@tanstack/react-router";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, CreditCard, ArrowRightLeft, Search, Loader2, User } from "lucide-react";
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
import { buscarAlunosSponte, type AlunoBuscaSponte } from "@/lib/sponte.functions";
import { useUnidadeAtiva } from "@/components/SelecioneUnidade";

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
  aluno_id: string | null;
  aluno_nome: string;
};

type NovoRecebivel = {
  data_pagamento: string;
  data_disponibilidade: string;
  valor_bruto: number;
  valor_liquido: number;
  aluno_id: string;
  aluno_nome: string;
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
          "id, data_pagamento, data_disponibilidade, valor_bruto, valor_liquido, status, unit_id, aluno_id, aluno_nome",
        )
        .order("data_disponibilidade", { ascending: true });
      if (schoolFilterIds) rq = rq.in("unit_id", schoolFilterIds as never);
      const { data, error } = await rq;
      if (error) throw error;
      return (data ?? []) as unknown as Receivable[];
    },
  });

  const create = useMutation({
    mutationFn: async (p: NovoRecebivel) => {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CreditCard className="h-6 w-6" /> Cartão de Crédito
            <AjudaTooltip
              rotulo="Sobre esta tela"
              texto="Controle dos recebíveis de cartão: liberação pela operadora e transferência para a conta do colégio."
            />
          </h1>
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
                  <TableHead>Aluno</TableHead>
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
                      <TableCell>
                        <div className="font-medium">
                          {r.aluno_nome || "—"}
                          {r.aluno_id && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              #{r.aluno_id}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {(r.unit_id && schoolNameById.get(r.unit_id)) || "—"}
                        </div>
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
  onSave: (p: NovoRecebivel) => void;
}) {
  const unidade = useUnidadeAtiva() ?? "";
  const buscar = useServerFn(buscarAlunosSponte);
  const [dataPagamento, setDataPagamento] = useState(defaultDate);
  const [dataDisp, setDataDisp] = useState("");
  const [valorBruto, setValorBruto] = useState("");
  const [valorLiquido, setValorLiquido] = useState("");
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [aluno, setAluno] = useState<AlunoBuscaSponte | null>(null);

  useEffect(() => {
    setResultados(null);
    setAluno(null);
  }, [unidade]);

  const reset = () => {
    setDataPagamento(defaultDate);
    setDataDisp("");
    setValorBruto("");
    setValorLiquido("");
    setTermo("");
    setResultados(null);
    setAluno(null);
  };

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: setResultados,
    onError: (e) => {
      setResultados(null);
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const t = termo.trim();
  const termoValido = !!unidade && (/^\d+$/.test(t) ? t.length >= 1 : t.length >= 3);

  const bruto = parseBRLNumber(valorBruto);
  const liquido = parseBRLNumber(valorLiquido);
  const valid =
    !!aluno && !!dataPagamento && !!dataDisp && Number.isFinite(bruto) && Number.isFinite(liquido);

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
          <div className="space-y-1">
            <Label htmlFor="rec-aluno">Aluno (nome ou AlunoID do Sponte)</Label>
            {aluno ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="font-medium">
                  {aluno.nome}{" "}
                  <span className="text-xs text-muted-foreground">
                    #{aluno.alunoId} · {aluno.turma || "sem turma"}
                  </span>
                </div>
                <Button variant="ghost" className="h-8 text-xs" onClick={() => setAluno(null)}>
                  Trocar aluno
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    id="rec-aluno"
                    value={termo}
                    onChange={(e) => setTermo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && termoValido) buscarAlunos.mutate();
                    }}
                    disabled={!unidade}
                    placeholder={unidade ? "" : "Selecione uma unidade no topo"}
                  />
                  <Button
                    variant="outline"
                    className="gap-1"
                    disabled={!termoValido || buscarAlunos.isPending}
                    onClick={() => buscarAlunos.mutate()}
                  >
                    {buscarAlunos.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Buscar
                  </Button>
                </div>
                {resultados && resultados.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    Nenhum aluno encontrado para “{t}” em {unidade}.
                  </div>
                )}
                {resultados && resultados.length > 0 && (
                  <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
                    {resultados.map((a) => (
                      <button
                        key={a.alunoId}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setAluno(a);
                          setResultados(null);
                          setTermo("");
                        }}
                      >
                        <span>
                          <span className="font-medium">{a.nome}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            #{a.alunoId} · {a.turma || "sem turma"} · {a.situacao}
                          </span>
                        </span>
                        <User className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
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
                aluno_id: aluno!.alunoId,
                aluno_nome: aluno!.nome,
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
