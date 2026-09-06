import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
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
import { executarAuditoriaDiario, listarAuditoriaDiario } from "@/lib/diario-auditoria.functions";

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
          <p>
            Compara, para cada aluno de <strong>{unidade}</strong> com plano no Diário, as refeições
            marcadas como contratadas e o Horário Estendido com as categorias de parcela ativas no
            Sponte (Lanche da Manhã, Almoço, Lanche da Tarde, Jantar, Hora Extra). Só aparecem os
            alunos com algo contratado sem lançamento.
          </p>
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
    </div>
  );
}
