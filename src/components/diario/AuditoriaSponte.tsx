import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { BotaoReconferirExtras } from "@/components/rematricula/BotaoReconferirExtras";
import { executarAuditoriaDiario, listarAuditoriaDiario } from "@/lib/diario-auditoria.functions";
import { listarDivergenciasExtras } from "@/lib/rematricula-extras.functions";
import { ROTULO_TIPO_DIVERGENCIA, type TipoDivergenciaExtra } from "@/lib/rematricula-extras";

const COR_TIPO: Record<TipoDivergenciaExtra, string> = {
  inconsistente: "border-amber-300 bg-amber-50 text-amber-800",
  remocao_pendente: "border-rose-300 bg-rose-50 text-rose-800",
  lancamento_pendente: "border-sky-300 bg-sky-50 text-sky-800",
};

function brl(valor: number | null): string {
  if (valor === null) return "a definir";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Props = { unidade: string | null; podeExecutar: boolean };

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditoriaSponte({ unidade, podeExecutar }: Props) {
  const qc = useQueryClient();
  const listar = useServerFn(listarAuditoriaDiario);
  const executar = useServerFn(executarAuditoriaDiario);

  const auditoria = useQuery({
    queryKey: ["diario_auditoria", unidade],
    enabled: unidade !== null,
    queryFn: async () => listar({ data: { unidade: unidade as string } }),
  });

  const listarDivergencias = useServerFn(listarDivergenciasExtras);
  const divergencias = useQuery({
    queryKey: ["rematricula_extras_divergencias", unidade],
    enabled: unidade !== null,
    queryFn: async () => listarDivergencias({ data: { unidade: unidade as string } }),
  });

  const rodar = useMutation({
    mutationFn: async () => executar({ data: { unidade: unidade as string } }),
    onSuccess: (res) => {
      toast.success(
        `Auditoria de ${res.unidade}: ${res.alunosAuditados} aluno(s) conferido(s), ${res.alunosComInconsistencia} com inconsistência.`,
      );
      void qc.invalidateQueries({ queryKey: ["diario_auditoria", unidade] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível executar a auditoria."),
  });

  if (unidade === null) {
    return <SelecioneUnidade acao="ver a auditoria Plano do Diário × Sponte" />;
  }

  const exec = auditoria.data?.execucao ?? null;
  const linhas = auditoria.data?.linhas ?? [];
  const comErro = linhas.filter((l) => l.erro);
  const inconsistentes = linhas.filter((l) => !l.erro);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-foreground">
              Auditoria Sponte · {unidade}
            </h3>
            <AjudaTooltip
              rotulo="O que a Auditoria Sponte confere"
              texto={`Compara, para cada aluno de ${unidade} com plano no Diário, as refeições marcadas como contratadas e o Horário Estendido com as categorias de parcela ativas no Sponte (Lanche da Manhã, Almoço, Lanche da Tarde, Jantar, Hora Extra). Só aparecem os alunos com algo contratado sem lançamento.`}
            />
          </div>
          {exec ? (
            <p className="mt-1">
              Última execução ({exec.origem === "cron" ? "automática" : "manual"}):{" "}
              {dataHora(exec.executadaEm)} · ano letivo {exec.anoLetivo} · {exec.alunosAuditados}{" "}
              aluno(s) conferido(s).
            </p>
          ) : (
            !auditoria.isLoading && <p className="mt-1">Ainda não executada para esta unidade.</p>
          )}
        </div>
        {podeExecutar && (
          <Button variant="outline" onClick={() => rodar.mutate()} disabled={rodar.isPending}>
            {rodar.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {rodar.isPending ? "Consultando o Sponte…" : "Atualizar auditoria"}
          </Button>
        )}
      </div>

      {auditoria.isLoading ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : exec && inconsistentes.length === 0 && comErro.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          Nenhuma inconsistência: tudo que está contratado no Diário tem lançamento ativo no Sponte.
        </div>
      ) : exec ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aluno</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Turma</TableHead>
                <TableHead>Sem lançamento no Sponte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inconsistentes.map((l) => (
                <TableRow key={l.studentId}>
                  <TableCell className="font-medium">{l.aluno}</TableCell>
                  <TableCell>{l.unidade}</TableCell>
                  <TableCell>{l.turma || "—"}</TableCell>
                  <TableCell>
                    <ul className="space-y-1">
                      {l.itens.map((item) => (
                        <li key={item} className="flex items-center gap-1.5 text-sm">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
              {comErro.map((l) => (
                <TableRow key={l.studentId}>
                  <TableCell className="font-medium">{l.aluno}</TableCell>
                  <TableCell>{l.unidade}</TableCell>
                  <TableCell>{l.turma || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">Não conferido: {l.erro}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <section className="space-y-3 pt-4">
        <div className="text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-foreground">
              Divergências pós-rematrícula
            </h3>
            <AjudaTooltip
              rotulo="O que são as divergências pós-rematrícula"
              texto="Geradas ao “Finalizar Matrícula” no portal: comparam os extras lançados no Sponte para o ano da rematrícula, o que o responsável deixou marcado e o plano do Diário do mesmo ano. São só alertas — nada é alterado automaticamente no Sponte nem no Diário. Depois de corrigir manualmente, use “Conferir novamente” para reler o Sponte e o Diário e atualizar a lista."
            />
          </div>
        </div>
        {divergencias.isLoading ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : divergencias.isError ? (
          <div className="rounded-2xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
            {divergencias.error instanceof Error
              ? divergencias.error.message
              : "Não foi possível carregar as divergências."}
          </div>
        ) : (divergencias.data ?? []).length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Nenhuma divergência de extras registrada nas rematrículas finalizadas.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Ano</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor mensal</TableHead>
                  <TableHead>Ação manual</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(divergencias.data ?? []).map((d, i, lista) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.aluno}</TableCell>
                    <TableCell>{d.unidade}</TableCell>
                    <TableCell>{d.anoLetivo}</TableCell>
                    <TableCell>{d.categoria}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={COR_TIPO[d.tipo]}>
                        {ROTULO_TIPO_DIVERGENCIA[d.tipo]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brl(d.valor)}</TableCell>
                    <TableCell className="max-w-md text-sm text-muted-foreground">
                      {d.mensagem}
                      <span className="block text-xs">
                        Registrada em {dataHora(d.registradaEm)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(i === 0 ||
                        lista[i - 1].alunoId !== d.alunoId ||
                        lista[i - 1].anoLetivo !== d.anoLetivo) &&
                        podeExecutar && (
                          <BotaoReconferirExtras
                            unidade={d.unidade}
                            alunoId={d.alunoId}
                            anoLetivo={d.anoLetivo}
                            size="xs"
                          />
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
