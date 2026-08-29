import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, GraduationCap, Loader2, PencilLine } from "lucide-react";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialPedagogicoSeries } from "@/components/rematricula/MaterialPedagogicoSeries";
import { usePermissions, useSchool } from "@/lib/app-context";
import { unidadeDaSelecao } from "@/lib/esportes-unidades";
import { formatarBRL } from "@/lib/rematricula";
import {
  STATUS_ACOMPANHAMENTO_LABEL,
  contadoresAcompanhamento,
  filtrarAcompanhamento,
  filtrarPorStatus,
  montarLinhasAcompanhamento,
  ordenarAcompanhamento,
  turmasAcompanhamento,
  type LinhaAcompanhamento,
  type StatusAcompanhamento,
} from "@/lib/rematricula-acompanhamento";
import {
  acompanhamentoRematricula,
  detalheAcompanhamentoRematricula,
  efetivarEscolhaRematricula,
} from "@/lib/rematricula.functions";

export const Route = createFileRoute("/rematricula-acompanhamento")({
  component: RematriculaAcompanhamentoPage,
});

function formatarDataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const CORES_STATUS: Record<StatusAcompanhamento, string> = {
  nao_iniciado: "bg-slate-100 text-slate-700",
  em_andamento: "bg-blue-100 text-blue-800",
  aguardando_aprovacao: "bg-amber-100 text-amber-900",
  rematriculado: "bg-emerald-100 text-emerald-800",
};

// Revisão antes do lançamento: a secretaria confere o que o responsável escolheu
// e as correções cadastrais registradas, e só então o material é criado no Sponte.
function DialogoRevisao({ linha, onFechar }: { linha: LinhaAcompanhamento; onFechar: () => void }) {
  const qc = useQueryClient();
  const carregarDetalhe = useServerFn(detalheAcompanhamentoRematricula);
  const efetivar = useServerFn(efetivarEscolhaRematricula);

  const detalhe = useQuery({
    queryKey: ["rematricula_detalhe", linha.unidade, linha.alunoId],
    queryFn: async () =>
      carregarDetalhe({ data: { unidade: linha.unidade, alunoId: linha.alunoId } }),
  });

  const aprovar = useMutation({
    mutationFn: async (id: string) => efetivar({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.erro ?? "Não foi possível aprovar.");
        return;
      }
      if (res.lancadaNoSponte) {
        toast.success(
          `Material lançado no Sponte (conta a receber ${res.sponteContaReceberId || "sem número"}).`,
        );
      } else {
        toast.error(
          `Solicitação aprovada, mas o material NÃO foi lançado no Sponte: ${
            res.sponteErro ?? "falha desconhecida"
          }`,
          { duration: 12000 },
        );
      }
      void qc.invalidateQueries({ queryKey: ["rematricula_acompanhamento"] });
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const escolha = detalhe.data?.escolha ?? null;
  const anoLetivo = detalhe.data?.anoLetivo ?? escolha?.anoLetivo ?? null;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Revisar e aprovar — {linha.nome}</DialogTitle>
          <DialogDescription>
            {linha.unidade}
            {linha.turma ? ` · ${linha.turma}` : ""}
          </DialogDescription>
        </DialogHeader>

        {detalhe.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !escolha ? (
          <p className="text-sm text-muted-foreground">
            A escolha deste aluno não está mais disponível. Recarregue a tela.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded-md border p-3">
              <p className="font-medium">Material pedagógico que será lançado</p>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Série</dt>
                  <dd>{escolha.serie || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Valor anual</dt>
                  <dd>{formatarBRL(escolha.valorAnual)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Parcelas</dt>
                  <dd>
                    {escolha.parcelas}x de {formatarBRL(escolha.valorParcela)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">1ª parcela</dt>
                  <dd>{formatarBRL(escolha.valorPrimeiraParcela)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Ano letivo de referência</dt>
                  <dd>{anoLetivo ?? "não configurado"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Escolhido em</dt>
                  <dd>{formatarDataHora(escolha.solicitadaEm)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                Categoria <strong>Material Pedagógico</strong>. Cada parcela vence no mesmo dia da
                mensalidade do aluno, mês a mês, a partir da primeira mensalidade em aberto de{" "}
                {anoLetivo ?? "—"} — sem ajuste de feriado. A sobra de centavos fica na 1ª parcela.
              </p>
            </div>

            {escolha.sponteErro && (
              <p className="flex items-start gap-1 rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Tentativa anterior falhou: {escolha.sponteErro}
              </p>
            )}

            <div className="rounded-md border p-3">
              <p className="font-medium">Correções cadastrais feitas pelo responsável</p>
              {(detalhe.data?.alteracoes.length ?? 0) === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Nenhuma alteração registrada — os dados do Sponte seguem como estavam.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {detalhe.data?.alteracoes.map((a, i) => (
                    <li key={`${a.campo}-${a.em}-${i}`}>
                      <span className="text-muted-foreground">
                        {a.escopo === "aluno" ? "Aluno" : "Responsável"} · {a.campo}:
                      </span>{" "}
                      {a.valorAntes || "vazio"} → <strong>{a.valorDepois || "vazio"}</strong>{" "}
                      <span className="text-muted-foreground">
                        ({formatarDataHora(a.em)}
                        {a.resultado === "gravado" ? "" : ` · falhou: ${a.erro}`})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            className="gap-2"
            disabled={!escolha || aprovar.isPending}
            onClick={() => escolha && aprovar.mutate(escolha.id)}
          >
            {aprovar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Aprovar e lançar no Sponte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RematriculaAcompanhamentoPage() {
  const { canView, canEdit } = usePermissions();
  const { schools, selected } = useSchool();
  const carregar = useServerFn(acompanhamentoRematricula);

  const [busca, setBusca] = useState("");
  const [filtroUnidade, setFiltroUnidade] = useState<string>("todas");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusAcompanhamento>("todos");
  const [filtroTurma, setFiltroTurma] = useState<string>("todas");
  const [revisando, setRevisando] = useState<LinhaAcompanhamento | null>(null);

  // Isolamento por unidade: com uma unidade selecionada no topo só ela é
  // consultada; em "Todas as Unidades" ficam as unidades permitidas ao usuário.
  const unidadeAtiva = useMemo(() => unidadeDaSelecao(selected, schools), [selected, schools]);
  const unidades = useMemo(
    () => (unidadeAtiva ? [unidadeAtiva] : schools.map((s) => s.name)),
    [unidadeAtiva, schools],
  );

  const consultas = useQueries({
    queries: unidades.map((unidade) => ({
      queryKey: ["rematricula_acompanhamento", unidade],
      queryFn: async () => carregar({ data: { unidade } }),
    })),
  });

  const carregando = consultas.some((c) => c.isLoading);
  const erros = consultas
    .map((c) => c.data?.error)
    .filter((e): e is string => Boolean(e))
    .join(" · ");

  const linhas = consultas.flatMap((c) =>
    c.data
      ? montarLinhasAcompanhamento({
          alunos: c.data.alunos,
          escolhas: c.data.escolhas,
          acessos: c.data.acessos,
          cadastroAlterados: c.data.cadastroAlterados,
        })
      : [],
  );

  // Base dos cards: mesma coleção da tabela antes do filtro de status, para os
  // contadores nunca contradizerem o que a secretaria vê ao filtrar.
  // As turmas oferecidas no filtro saem das linhas já restritas à unidade; se a
  // turma escolhida não pertence mais à unidade atual, o filtro volta a "todas".
  const daUnidade = useMemo(
    () =>
      filtrarAcompanhamento(linhas, {
        unidade: filtroUnidade === "todas" ? unidadeAtiva : filtroUnidade,
        unidadesPermitidas: schools.map((s) => s.name),
      }),
    [linhas, filtroUnidade, unidadeAtiva, schools],
  );
  const turmas = useMemo(() => turmasAcompanhamento(daUnidade), [daUnidade]);
  const turmaAtiva = filtroTurma !== "todas" && turmas.includes(filtroTurma) ? filtroTurma : null;

  const base = useMemo(
    () => ordenarAcompanhamento(filtrarAcompanhamento(daUnidade, { turma: turmaAtiva, busca })),
    [daUnidade, turmaAtiva, busca],
  );

  const cards = useMemo(() => contadoresAcompanhamento(base), [base]);
  const visiveis = useMemo(() => filtrarPorStatus(base, filtroStatus), [base, filtroStatus]);
  const podeEditar = canEdit("rematricula");

  if (!canView("rematricula")) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <GraduationCap className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Rematrícula — Acompanhamento</h1>
          <p className="text-sm text-muted-foreground">
            Uma linha por aluno ativo: quem já confirmou a rematrícula no portal, quem ainda não
            respondeu e o que está aguardando o lançamento do material no Sponte.
          </p>
        </div>
      </div>

      <Tabs defaultValue="alunos">
        <TabsList>
          <TabsTrigger value="alunos">Alunos</TabsTrigger>
          <TabsTrigger value="material">Material Pedagógico por Série</TabsTrigger>
        </TabsList>

        <TabsContent value="alunos" className="mt-4 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Alunos ativos</p>
              <p className="text-2xl font-semibold">{cards.total}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Já responderam</p>
              <p className="text-2xl font-semibold">{cards.responderam}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Ainda não responderam</p>
              <p className="text-2xl font-semibold">{cards.naoResponderam}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Aguardando aprovação</p>
              <p className="text-2xl font-semibold">{cards.aguardandoAprovacao}</p>
            </div>
          </div>

          {erros && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {erros}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Buscar por aluno"
              className="max-w-xs"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <Select value={filtroUnidade} onValueChange={setFiltroUnidade}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as unidades</SelectItem>
                {unidades.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={turmaAtiva ?? "todas"} onValueChange={setFiltroTurma}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as turmas</SelectItem>
                {turmas.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filtroStatus}
              onValueChange={(v) => setFiltroStatus(v as "todos" | StatusAcompanhamento)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="nao_iniciado">
                  {STATUS_ACOMPANHAMENTO_LABEL.nao_iniciado}
                </SelectItem>
                <SelectItem value="em_andamento">
                  {STATUS_ACOMPANHAMENTO_LABEL.em_andamento}
                </SelectItem>
                <SelectItem value="aguardando_aprovacao">
                  {STATUS_ACOMPANHAMENTO_LABEL.aguardando_aprovacao}
                </SelectItem>
                <SelectItem value="rematriculado">
                  {STATUS_ACOMPANHAMENTO_LABEL.rematriculado}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {carregando ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aluno</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Última atualização</TableHead>
                    <TableHead>Parcelamento</TableHead>
                    <TableHead>Dados cadastrais</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                        Nenhum aluno encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                  {visiveis.map((l) => (
                    <TableRow key={`${l.unidade}-${l.alunoId}`}>
                      <TableCell>
                        <p className="font-medium">{l.nome}</p>
                        {l.turma && <p className="text-xs text-muted-foreground">{l.turma}</p>}
                      </TableCell>
                      <TableCell>{l.unidade}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={CORES_STATUS[l.status]}>
                          {STATUS_ACOMPANHAMENTO_LABEL[l.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatarDataHora(l.atualizadoEm)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{l.parcelamento || "—"}</TableCell>
                      <TableCell>
                        {l.cadastroAlterado ? (
                          <span className="flex items-center gap-1 text-sm text-blue-800">
                            <PencilLine className="h-4 w-4 shrink-0" />
                            Alterados
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sem alteração</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {podeEditar && l.status === "aguardando_aprovacao" && (
                          <Button size="sm" variant="outline" onClick={() => setRevisando(l)}>
                            Revisar e Aprovar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="material" className="mt-4">
          <MaterialPedagogicoSeries podeEditar={podeEditar} />
        </TabsContent>
      </Tabs>

      {revisando && <DialogoRevisao linha={revisando} onFechar={() => setRevisando(null)} />}
    </div>
  );
}
