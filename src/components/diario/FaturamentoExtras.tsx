import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { descreverItem, type StatusFaturamento } from "@/lib/diario-faturamento";
import {
  definirMinutosHoraExtraDiario,
  faturarExtrasDiario,
  faturarTodosExtrasDiario,
  listarFaturamentosDiario,
  listarPendenciasFaturamentoDiario,
  marcarFaturamentoDiarioManual,
  relancarFaturamentoDiario,
  type ResultadoFaturamento,
} from "@/lib/diario-faturamento.functions";
import { formatarBRL } from "@/lib/rematricula";

type Props = { unidade: string | null; podeEditar: boolean };

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

const ROTULO_STATUS: Record<StatusFaturamento, string> = {
  faturando: "Em andamento",
  erro: "Falhou no Sponte",
  lancado: "Lançado",
};

const COR_STATUS: Record<StatusFaturamento, string> = {
  faturando: "border-sky-300 bg-sky-50 text-sky-800",
  erro: "border-rose-300 bg-rose-50 text-rose-800",
  lancado: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

function mensagemResultado(r: ResultadoFaturamento): void {
  if (!r.ok) {
    toast.error(r.erro ?? "Não foi possível faturar.");
  } else if (r.lancadoNoSponte) {
    toast.success(
      `Cobrança criada no Sponte${r.sponteContaReceberId ? ` (conta ${r.sponteContaReceberId})` : ""}, vencimento ${r.sponteVencimento ? data(r.sponteVencimento) : "—"}.`,
    );
  } else {
    toast.error(r.sponteErro ?? "O Sponte não confirmou a cobrança.");
  }
}

export function FaturamentoExtras({ unidade, podeEditar }: Props) {
  const qc = useQueryClient();
  const listarPend = useServerFn(listarPendenciasFaturamentoDiario);
  const listarHist = useServerFn(listarFaturamentosDiario);
  const faturar = useServerFn(faturarExtrasDiario);
  const faturarTodos = useServerFn(faturarTodosExtrasDiario);
  const relancar = useServerFn(relancarFaturamentoDiario);
  const marcarManual = useServerFn(marcarFaturamentoDiarioManual);
  const definirMinutos = useServerFn(definirMinutosHoraExtraDiario);
  const [minutosEdit, setMinutosEdit] = useState<Record<string, string>>({});

  const pendencias = useQuery({
    queryKey: ["diario_faturamento_pendencias", unidade],
    enabled: unidade !== null,
    queryFn: async () => listarPend({ data: { unidade: unidade as string } }),
  });
  const historico = useQuery({
    queryKey: ["diario_faturamentos", unidade],
    enabled: unidade !== null,
    queryFn: async () => listarHist({ data: { unidade: unidade as string } }),
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["diario_faturamento_pendencias", unidade] });
    void qc.invalidateQueries({ queryKey: ["diario_faturamentos", unidade] });
  };
  const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha na operação.");

  const mFaturar = useMutation({
    mutationFn: async (studentId: string) =>
      faturar({ data: { unidade: unidade as string, studentId } }),
    onSuccess: (r) => {
      mensagemResultado(r);
      recarregar();
    },
    onError: erro,
  });
  const mTodos = useMutation({
    mutationFn: async () => faturarTodos({ data: { unidade: unidade as string } }),
    onSuccess: (r) => {
      if (r.lancados > 0) toast.success(`${r.lancados} cobrança(s) criada(s) no Sponte.`);
      for (const e of r.comErro) toast.error(`${e.aluno}: ${e.erro}`);
      if (r.lancados === 0 && r.comErro.length === 0) toast.info("Nenhum aluno faturável.");
      recarregar();
    },
    onError: erro,
  });
  const mRelancar = useMutation({
    mutationFn: async (id: string) => relancar({ data: { id } }),
    onSuccess: (r) => {
      mensagemResultado(r);
      recarregar();
    },
    onError: erro,
  });
  const mManual = useMutation({
    mutationFn: async (id: string) => marcarManual({ data: { id } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Registrado como lançado manualmente no Sponte.");
      else toast.error(r.erro ?? "Não foi possível registrar.");
      recarregar();
    },
    onError: erro,
  });
  const mMinutos = useMutation({
    mutationFn: async (p: { eventId: string; minutos: number }) => definirMinutos({ data: p }),
    onSuccess: (r, p) => {
      if (r.ok) {
        toast.success("Duração gravada.");
        setMinutosEdit((s) => ({ ...s, [p.eventId]: "" }));
      } else toast.error(r.erro ?? "Não foi possível gravar.");
      recarregar();
    },
    onError: erro,
  });

  if (unidade === null) {
    return <SelecioneUnidade acao="ver o faturamento dos Extras" />;
  }

  const lista = pendencias.data ?? [];
  const faturaveis = lista.filter((p) => p.bloqueios.length === 0 && p.total > 0);
  const ocupado = mFaturar.isPending || mTodos.isPending;
  const hist = historico.data ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-foreground">
              Pendentes de faturar · {unidade}
            </h3>
            <AjudaTooltip
              rotulo="Como funciona o faturamento dos Extras"
              texto="Cada aluno acumula os consumos fora do plano (refeições) e os minutos de Hora Extra ainda não faturados. O valor usa a Tabela de Preços do ano do consumo. Ao faturar, o School Hub reserva o período e cria UM título no Sponte, com vencimento na próxima mensalidade em aberto do aluno. Um aluno sem preço cadastrado ou com registro sem duração fica bloqueado até a pendência ser resolvida."
            />
          </div>
          {podeEditar && (
            <Button
              className="gap-2"
              disabled={ocupado || faturaveis.length === 0}
              onClick={() => mTodos.mutate()}
            >
              {mTodos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Receipt className="h-4 w-4" />
              )}
              Faturar Todos ({faturaveis.length})
            </Button>
          )}
        </div>

        {pendencias.isLoading ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : lista.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Nenhum consumo pendente de
            faturamento.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Turma</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Composição</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => {
                  const ok = p.bloqueios.length === 0 && p.total > 0;
                  return (
                    <TableRow key={`${p.studentId}-${p.anoLetivo}`}>
                      <TableCell className="font-medium">{p.aluno}</TableCell>
                      <TableCell className="text-muted-foreground">{p.turma}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {data(p.periodoInicio)} a {data(p.periodoFim)}
                        <span className="block text-muted-foreground">Ano {p.anoLetivo}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.itens.map((i) => (
                          <span key={i.categoria} className="block">
                            {descreverItem(i)}
                            {i.precoUnitario === null
                              ? " — sem preço"
                              : ` = ${formatarBRL(i.valor)}`}
                          </span>
                        ))}
                        {p.bloqueios.map((b) => (
                          <span key={b} className="mt-1 flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> {b}
                          </span>
                        ))}
                        {podeEditar &&
                          p.eventosSemDuracao.map((e) => (
                            <span key={e.id} className="mt-1 flex items-center gap-1.5">
                              <span className="text-muted-foreground">{dataHora(e.createdAt)}</span>
                              <Input
                                className="h-7 w-20 text-xs"
                                inputMode="numeric"
                                placeholder="min"
                                value={minutosEdit[e.id] ?? ""}
                                onChange={(ev) =>
                                  setMinutosEdit((s) => ({
                                    ...s,
                                    [e.id]: ev.target.value.replace(/\D/g, "").slice(0, 4),
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={!(minutosEdit[e.id] ?? "").length || mMinutos.isPending}
                                onClick={() =>
                                  mMinutos.mutate({
                                    eventId: e.id,
                                    minutos: Number(minutosEdit[e.id]),
                                  })
                                }
                              >
                                Gravar minutos
                              </Button>
                            </span>
                          ))}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatarBRL(p.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        {podeEditar && (
                          <Button
                            size="sm"
                            disabled={!ok || ocupado}
                            onClick={() => mFaturar.mutate(p.studentId)}
                          >
                            {mFaturar.isPending && mFaturar.variables === p.studentId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Faturar"
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold text-foreground">Faturamentos realizados</h3>
          <AjudaTooltip
            rotulo="Status dos faturamentos"
            texto="Lançado: título criado no Sponte (automático) ou registrado como lançado manualmente. Falhou no Sponte: o período está reservado, mas a cobrança não foi criada — use Relançar ou, se a equipe já lançou à mão, Marcar lançado manualmente. Um faturamento com número de conta no Sponte nunca é lançado de novo."
          />
        </div>
        {historico.isLoading ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : hist.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum faturamento ainda.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Composição</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sponte</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {hist.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {dataHora(f.createdAt)}
                      <span className="block text-muted-foreground">{f.createdByNome}</span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {f.aluno}
                      <span className="block text-xs text-muted-foreground">{f.turma}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {data(f.periodoInicio)} a {data(f.periodoFim)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {f.itens.map((i) => (
                        <span key={i.categoria} className="block">
                          {descreverItem(i)} = {formatarBRL(i.valor)}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatarBRL(f.valorTotal)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={COR_STATUS[f.status]}>
                        {ROTULO_STATUS[f.status]}
                        {f.status === "lancado" && f.lancadoAutomatico === false ? " (manual)" : ""}
                      </Badge>
                      {f.status === "erro" && f.sponteErro && (
                        <span className="mt-1 block max-w-xs text-xs text-rose-700">
                          {f.sponteErro}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {f.sponteContaReceberId ? (
                        <>
                          Conta {f.sponteContaReceberId}
                          {f.sponteVencimento && (
                            <span className="block text-muted-foreground">
                              Venc. {data(f.sponteVencimento)}
                            </span>
                          )}
                        </>
                      ) : f.status === "lancado" ? (
                        <span className="text-muted-foreground">
                          Manual · {f.lancadoPorNome}
                          {f.observacao ? ` · ${f.observacao}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {podeEditar && f.status === "erro" && !f.sponteContaReceberId && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={mRelancar.isPending || mManual.isPending}
                            onClick={() => mRelancar.mutate(f.id)}
                          >
                            Relançar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={mRelancar.isPending || mManual.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Confirmar que a cobrança de ${f.aluno} (${formatarBRL(f.valorTotal)}) já foi lançada manualmente no Sponte? O sistema não vai lançar de novo.`,
                                )
                              )
                                mManual.mutate(f.id);
                            }}
                          >
                            Marcar lançado manualmente
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
