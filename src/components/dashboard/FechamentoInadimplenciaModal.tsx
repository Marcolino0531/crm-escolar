import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  gravarFechamentoInadimplencia,
  simularFechamentoInadimplencia,
} from "@/lib/inadimplencia-fechamento.functions";
import {
  formatarDataBr,
  formatarPercentual,
  mesAnterior,
  mesesFechaveis,
  rotuloMes,
  anoMesDeData,
} from "@/lib/inadimplencia-fechamento";
import { hojeEmBrasilia } from "@/lib/alunos-ativos";

export const QUERY_HISTORICO_INADIMPLENCIA = "dash-inadimplencia-historico";
export const QUERY_PENDENTES_INADIMPLENCIA = "inadimplencia-fechamento-pendentes";

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function FechamentoInadimplenciaModal({
  open,
  onOpenChange,
  unidade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unidade: string;
}) {
  const qc = useQueryClient();
  const simularFn = useServerFn(simularFechamentoInadimplencia);
  const gravarFn = useServerFn(gravarFechamentoInadimplencia);

  const hoje = hojeEmBrasilia();
  const opcoes = mesesFechaveis(hoje);
  const padrao = mesAnterior(anoMesDeData(hoje));
  const [anoMes, setAnoMes] = useState<string>(padrao);
  const [confirmarSubstituir, setConfirmarSubstituir] = useState(false);

  useEffect(() => {
    if (open) setAnoMes(padrao);
  }, [open, padrao]);

  const simulacao = useQuery({
    queryKey: ["inadimplencia-fechamento-simulacao", unidade, anoMes],
    enabled: open && opcoes.includes(anoMes),
    staleTime: 0,
    retry: false,
    queryFn: () => simularFn({ data: { unidade, anoMes } }),
  });

  const gravar = useMutation({
    mutationFn: (substituir: boolean) => gravarFn({ data: { unidade, anoMes, substituir } }),
    onSuccess: () => {
      toast.success(`Inadimplência de ${rotuloMes(anoMes)} fechada para ${unidade}.`);
      void qc.invalidateQueries({ queryKey: [QUERY_HISTORICO_INADIMPLENCIA] });
      void qc.invalidateQueries({ queryKey: [QUERY_PENDENTES_INADIMPLENCIA] });
      void qc.invalidateQueries({ queryKey: ["inadimplencia-fechamento-simulacao"] });
      onOpenChange(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const calc = simulacao.data?.calculo ?? null;
  const trava = simulacao.data?.trava ?? null;
  const existente = simulacao.data?.existente ?? null;
  const erro = simulacao.error instanceof Error ? simulacao.error.message : null;
  const podeGravar = !!calc && !trava && !gravar.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fechar inadimplência do mês</DialogTitle>
          <DialogDescription>
            {unidade}: os valores são recalculados no servidor com as mesmas fontes do card
            "Inadimplência anual" e gravados em R$ para o histórico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Mês de referência</label>
            {opcoes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum mês fechável ainda (o primeiro é Setembro/2026, a partir de 01/10/2026).
              </p>
            ) : (
              <Select value={anoMes} onValueChange={setAnoMes}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opcoes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {rotuloMes(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {simulacao.isFetching ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Consultando Sponte e extrato…
              </p>
            </div>
          ) : erro || trava ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro ?? trava}</span>
            </div>
          ) : calc ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Unidade</dt>
              <dd className="text-right font-medium">{calc.unidade}</dd>
              <dt className="text-muted-foreground">Mês</dt>
              <dd className="text-right font-medium">{rotuloMes(calc.anoMes)}</dd>
              <dt className="col-span-2 mt-2 border-t pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mês
              </dt>
              <dt className="text-muted-foreground">Inadimplente do mês</dt>
              <dd className="text-right tabular-nums">{brl(calc.inadimplenteMes)}</dd>
              <dt className="text-muted-foreground">Faturamento do mês</dt>
              <dd className="text-right tabular-nums">{brl(calc.faturamentoMes)}</dd>
              <dt className="text-muted-foreground">% mensal</dt>
              <dd className="text-right font-semibold tabular-nums">
                {formatarPercentual(calc.percentualMes)}
              </dd>
              <dt className="text-muted-foreground">Boletos em aberto (mês)</dt>
              <dd className="text-right tabular-nums">{calc.boletosMes}</dd>
              <dt className="col-span-2 mt-2 border-t pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Acumulado no ano
              </dt>
              <dt className="text-muted-foreground">Inadimplente acumulado</dt>
              <dd className="text-right tabular-nums">{brl(calc.inadimplenteAcumulado)}</dd>
              <dt className="text-muted-foreground">Faturamento acumulado</dt>
              <dd className="text-right tabular-nums">{brl(calc.faturamentoAcumulado)}</dd>
              <dt className="text-muted-foreground">% acumulado</dt>
              <dd className="text-right font-semibold tabular-nums">
                {formatarPercentual(calc.percentualAcumulado)}
              </dd>
              <dt className="text-muted-foreground">Boletos em aberto (ano)</dt>
              <dd className="text-right tabular-nums">{calc.boletosAcumulado}</dd>
            </dl>
          ) : null}

          {existente && !simulacao.isFetching && (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              Este mês já foi fechado em {formatarDataBr(existente.fechado_em)} por{" "}
              {existente.fechado_por_nome}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {existente ? (
            <Button
              variant="destructive"
              disabled={!podeGravar}
              onClick={() => setConfirmarSubstituir(true)}
            >
              Substituir fechamento
            </Button>
          ) : (
            <Button disabled={!podeGravar} onClick={() => gravar.mutate(false)}>
              {gravar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar e gravar
            </Button>
          )}
        </DialogFooter>

        <AlertDialog open={confirmarSubstituir} onOpenChange={setConfirmarSubstituir}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Substituir o fechamento de {rotuloMes(anoMes)}?</AlertDialogTitle>
              <AlertDialogDescription>
                O registro anterior de {unidade} será sobrescrito pelos valores recalculados agora.
                Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmarSubstituir(false);
                  gravar.mutate(true);
                }}
              >
                Substituir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
