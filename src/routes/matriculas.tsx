// Dashboard de Matrículas: auditoria das submissões do formulário de matrícula
// (/matricula → Sponte; histórico do antigo Google Forms preservado). Lista o que entrou, mostra o payload
// original ao lado da resposta do Sponte e reenvia o que falhou.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ClipboardList,
  Copy,
  CopyCheck,
  ExternalLink,
  Inbox,
  Printer,
  RefreshCw,
  RotateCw,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { usePermissions, useRole } from "@/lib/app-context";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AVISO_SPONTE, rotuloCobrancas } from "@/lib/matricula-exclusao";
import { AccessDenied } from "@/components/AccessDenied";
import { useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { supabase } from "@/integrations/supabase/client";
import {
  arquivarMatricula,
  desarquivarMatricula,
  atualizarNomeMatricula,
  desfazerConferenciaMatricula,
  detalheMatricula,
  excluirMatricula,
  reprocessarMatricula,
  resolverPendenciaMatricula,
  resumoExclusaoMatricula,
  salvarConferenciaManual,
} from "@/lib/matriculas.functions";
import { lerConferenciaManual } from "@/lib/matricula-conferencia";
import { STATUS_ERRO } from "@/lib/matriculas.audit";
import { montarSecoesDetalhe, type SecaoDetalhe } from "@/lib/matricula-detalhe";
import {
  FILTRO_OR_PENDENCIA,
  seloCobranca,
  seloTurma,
  temPendencia,
  type Selo,
} from "@/lib/matricula-integracao";
import { gerarPdfFichaMatricula, nomeArquivoFichaMatricula } from "@/lib/matricula-detalhe-pdf";

export interface MatriculasSearch {
  /** Submissão a abrir na ficha (deep link do aviso do sino). */
  id?: string;
}

export const Route = createFileRoute("/matriculas")({
  head: () => ({ meta: [{ title: "Matrículas — School Hub" }] }),
  validateSearch: (s: Record<string, unknown>): MatriculasSearch => ({
    id: typeof s.id === "string" && s.id ? s.id : undefined,
  }),
  component: MatriculasGate,
});

function MatriculasGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("eformulario"))
    return <AccessDenied message="Você não tem permissão para acessar as Matrículas." />;
  return <MatriculasPage />;
}

const PER_PAGE = 20;

type SubmissionStatus =
  | "sucesso"
  | "duplicado"
  | "erro_aluno"
  | "erro_responsavel"
  | "erro_validacao";

// `reprocessavel` separa "badge de erro" de "pode reenviar ao Sponte": erros de
// validação não têm o que reenviar (o payload gravado continua inválido), então
// só mostram o motivo — a correção é na origem.
const STATUS_STYLE: Record<
  SubmissionStatus,
  { label: string; cls: string; erro: boolean; reprocessavel: boolean }
> = {
  sucesso: {
    label: "Sucesso",
    cls: "bg-emerald-100 text-emerald-700",
    erro: false,
    reprocessavel: false,
  },
  duplicado: {
    label: "Duplicado",
    cls: "bg-amber-100 text-amber-700",
    erro: false,
    reprocessavel: false,
  },
  erro_aluno: {
    label: "Erro no aluno",
    cls: "bg-red-100 text-red-700",
    erro: true,
    reprocessavel: true,
  },
  erro_responsavel: {
    label: "Erro no responsável",
    cls: "bg-red-100 text-red-700",
    erro: true,
    reprocessavel: true,
  },
  erro_validacao: {
    label: "Erro de validação",
    cls: "bg-amber-100 text-amber-800",
    erro: true,
    reprocessavel: false,
  },
};

const STATUS_FILTROS = [
  { value: "todos", label: "Todos os status" },
  { value: "pendencia", label: "Com pendência" },
  { value: "sucesso", label: "Sucesso" },
  { value: "duplicado", label: "Duplicado" },
  { value: "erros", label: "Todos os erros" },
  { value: "erro_aluno", label: "Erro no aluno" },
  { value: "erro_responsavel", label: "Erro no responsável" },
  { value: "erro_validacao", label: "Erro de validação" },
];

type Exibir = "ativas" | "arquivadas";

const EXIBIR_FILTROS: { value: Exibir; label: string }[] = [
  { value: "ativas", label: "Ativas" },
  { value: "arquivadas", label: "Arquivadas" },
];

// Espelha `ResponsavelResultado` do motor da matrícula (matriculas.sponte).
type ResponsavelResultado = {
  nome: string;
  parentesco: string;
  parentescoId: number;
  responsavelFinanceiro: boolean;
  responsavelDidatico: boolean;
  ok: boolean;
  retorno: string;
  responsavelId: number | null;
  parentescoConfirmado: string | null;
  reaproveitado?: boolean;
};

type Resultado = {
  ok?: boolean;
  status?: string;
  alunoId?: number | null;
  alunoJaExistia?: boolean;
  endereco?: Record<string, string>;
  responsaveis?: ResponsavelResultado[];
  error?: string;
};

type Submissao = {
  id: string;
  submission_id: string | null;
  unidade: string | null;
  aluno_nome: string | null;
  aluno_nome_formulario: string | null;
  aluno_cpf: string | null;
  sponte_aluno_id: number | null;
  status: SubmissionStatus;
  erro: string | null;
  payload: unknown;
  resultado: Resultado | null;
  tentativas: number | null;
  reprocessado_em: string | null;
  created_at: string;
  turma_status: string | null;
  turma_pendencia: string | null;
  turma_nome: string | null;
  faturamento_status: string | null;
  faturamento_pendencia: string | null;
  matricula_valor: number | null;
  matricula_parcelas: number | null;
  matricula_primeiro_vencimento: string | null;
  material_valor_anual: number | null;
  material_parcelas: number | null;
  pendencia_resolvida_em: string | null;
  arquivada_em: string | null;
  conferido_em: string | null;
  conferido_por_nome: string | null;
  conferencia: unknown;
};

const SELO_CLS: Record<string, string> = {
  matriculado: "bg-emerald-100 text-emerald-900",
  conferido: "bg-sky-100 text-sky-900",
  lancada: "bg-emerald-100 text-emerald-900",
  parcial: "bg-amber-100 text-amber-900",
  pendente: "bg-amber-100 text-amber-900",
  erro: "bg-red-100 text-red-900",
};

function SeloIntegracao({ selo }: { selo: Selo<string> | null }) {
  if (!selo) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      title={selo.motivo}
      className={`inline-flex cursor-help items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${SELO_CLS[selo.valor] ?? ""}`}
    >
      {selo.rotulo}
    </span>
  );
}

function formatDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: SubmissionStatus }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.erro_aluno;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}
    >
      {style.erro ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {style.label}
    </span>
  );
}

function MatriculasPage() {
  const { canEdit } = usePermissions();
  const { isAdmin } = useRole();
  const podeReprocessar = canEdit("eformulario");
  const queryClient = useQueryClient();
  const reprocessarFn = useServerFn(reprocessarMatricula);
  const arquivarFn = useServerFn(arquivarMatricula);
  const desarquivarFn = useServerFn(desarquivarMatricula);
  const [excluindo, setExcluindo] = useState<Submissao | null>(null);
  const desfazerFn = useServerFn(desfazerConferenciaMatricula);
  const salvarConferenciaFn = useServerFn(salvarConferenciaManual);

  // Escopo da listagem: unidade do topo (consolidado em "Todas as Unidades").
  const unidade = useUnidadeAtiva();
  const [status, setStatus] = useState("todos");
  const [exibir, setExibir] = useState<Exibir>("ativas");
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [detalhe, setDetalhe] = useState<Submissao | null>(null);
  const { id: idDoAviso } = Route.useSearch();

  // Deep link do sino: abre a ficha da submissão indicada assim que ela carrega.
  useEffect(() => {
    if (!idDoAviso) return;
    let cancelado = false;
    supabase
      .from("enrollment_submissions" as never)
      .select("*")
      .eq("id", idDoAviso)
      .maybeSingle()
      .then(({ data: row }) => {
        if (!cancelado && row) setDetalhe(row as unknown as Submissao);
      });
    return () => {
      cancelado = true;
    };
  }, [idDoAviso]);

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounced(busca.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  // Trocar a unidade no topo recomeça a paginação.
  useEffect(() => setPage(1), [unidade]);

  const queryKey = ["matriculas-submissoes", unidade, status, exibir, buscaDebounced, page];

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from("enrollment_submissions" as never)
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

      if (unidade) q = q.eq("unidade", unidade);
      if (status === "erros") q = q.in("status", STATUS_ERRO as unknown as string[]);
      else if (status === "pendencia")
        q = q.is("pendencia_resolvida_em", null).or(FILTRO_OR_PENDENCIA);
      else if (status !== "todos") q = q.eq("status", status);
      // Vírgula e parênteses quebram a sintaxe do filtro `or` do PostgREST.
      const termo = buscaDebounced.replace(/[,()]/g, " ").trim();
      // Com busca, ativas e arquivadas aparecem juntas; sem busca vale o "Exibir".
      if (termo)
        q = q.or(
          `aluno_nome.ilike.%${termo}%,aluno_nome_formulario.ilike.%${termo}%,aluno_cpf.ilike.%${termo}%`,
        );
      else if (exibir === "arquivadas") q = q.not("arquivada_em", "is", null);
      else q = q.is("arquivada_em", null);

      const { data: rows, count, error: err } = await q;
      if (err) throw new Error(err.message);
      return { rows: (rows ?? []) as unknown as Submissao[], total: count ?? 0 };
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // O painel aberto reflete a linha recarregada (o reprocessamento muda status,
  // erro e resultado da mesma submissão).
  useEffect(() => {
    if (!detalhe) return;
    const atualizada = rows.find((r) => r.id === detalhe.id);
    if (atualizada && atualizada !== detalhe) setDetalhe(atualizada);
  }, [rows, detalhe]);

  // Ao abrir a ficha, o nome do aluno é relido no Sponte (só leitura).
  const atualizarNomeFn = useServerFn(atualizarNomeMatricula);
  const idDetalhe = detalhe?.id ?? null;
  useEffect(() => {
    if (!idDetalhe) return;
    let cancelado = false;
    atualizarNomeFn({ data: { id: idDetalhe } })
      .then(async (res) => {
        if (cancelado || !res.atualizado) return;
        await queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
        setDetalhe((d) => (d && d.id === idDetalhe ? { ...d, aluno_nome: res.alunoNome } : d));
      })
      .catch((e) => console.error("[matrículas] falha ao atualizar o nome pelo Sponte:", e));
    return () => {
      cancelado = true;
    };
  }, [idDetalhe, atualizarNomeFn, queryClient]);

  const reprocessar = useMutation({
    mutationFn: (id: string) => reprocessarFn({ data: { id } }),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Matrícula reprocessada com sucesso (AlunoID ${res.alunoId}).`);
      else toast.error(res.error ?? "O reenvio ao Sponte não foi concluído.");
      queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar a matrícula."),
  });

  const arquivamento = useMutation({
    mutationFn: ({ id, arquivar }: { id: string; arquivar: boolean }) =>
      arquivar ? arquivarFn({ data: { id } }) : desarquivarFn({ data: { id } }),
    onSuccess: (_res, { arquivar }) => {
      toast.success(arquivar ? "Matrícula arquivada." : "Matrícula desarquivada.");
      queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
      queryClient.invalidateQueries({ queryKey: ["matriculas-pendencias"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao arquivar a matrícula."),
  });

  const desfazer = useMutation({
    mutationFn: (id: string) => desfazerFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Conferência desfeita.");
      queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
      queryClient.invalidateQueries({ queryKey: ["matriculas-pendencias"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Falha ao desfazer a conferência."),
  });

  const salvarConferencia = useMutation({
    mutationFn: (v: { id: string; turmaConferida: boolean; cobrancaLancada: boolean }) =>
      salvarConferenciaFn({ data: v }),
    onSuccess: (res) => {
      toast.success(res.mensagem);
      queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
      queryClient.invalidateQueries({ queryKey: ["matriculas-pendencias"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar a conferência."),
  });

  const conferenciaProps = (row: Submissao) => ({
    submissao: row,
    salvando: salvarConferencia.isPending && salvarConferencia.variables?.id === row.id,
    desfazendo: desfazer.isPending && desfazer.variables === row.id,
    onSalvar: (turmaConferida: boolean, cobrancaLancada: boolean) =>
      salvarConferencia.mutate({ id: row.id, turmaConferida, cobrancaLancada }),
    onDesfazer: () => desfazer.mutate(row.id),
  });

  const filtrosAtivos = status !== "todos" || exibir !== "ativas" || busca !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ClipboardList className="h-5 w-5 text-primary" /> Matrículas
          </h1>
          <p className="text-sm text-muted-foreground">
            Submissões do formulário de matrícula e o resultado da criação no Sponte.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Unidade</label>
          <div className="flex h-9 w-52 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
            {unidade ?? "Todas as Unidades"}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Status</label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-52">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTROS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Exibir</label>
          <Select
            value={exibir}
            onValueChange={(v) => {
              setExibir(v as Exibir);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="Exibir" />
            </SelectTrigger>
            <SelectContent>
              {EXIBIR_FILTROS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            Buscar por aluno ou CPF
          </label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Digite um nome ou CPF…"
            className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        {filtrosAtivos && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("todos");
              setExibir("ativas");
              setBusca("");
              setPage(1);
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-border bg-card">
        {isError ? (
          <div className="px-4 py-6 text-sm text-red-600">
            {error instanceof Error ? error.message : "Falha ao carregar as matrículas."}
          </div>
        ) : isFetching && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">
              {filtrosAtivos
                ? "Nenhuma matrícula encontrada com estes filtros."
                : "Nenhuma matrícula registrada."}
            </p>
            {!filtrosAtivos && (
              <p className="text-xs text-muted-foreground">
                As respostas do formulário aparecem aqui assim que são enviadas.
              </p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data e Hora</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Status da Integração</TableHead>
                <TableHead>Turma</TableHead>
                <TableHead>Cobrança</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setDetalhe(row)}
                  title="Ver payload e resposta do Sponte"
                >
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDataHora(row.created_at)}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {row.aluno_nome || "—"}
                    {row.arquivada_em && (
                      <span className="ml-2 inline-flex items-center whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        Arquivada
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {row.aluno_cpf || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{row.unidade || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    <SeloIntegracao selo={seloTurma(row)} />
                  </TableCell>
                  <TableCell>
                    <SeloIntegracao selo={seloCobranca(row)} />
                  </TableCell>
                  <TableCell className="text-right">
                    {STATUS_STYLE[row.status]?.reprocessavel && podeReprocessar && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reprocessar.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          reprocessar.mutate(row.id);
                        }}
                      >
                        <RotateCw
                          className={`mr-2 h-3.5 w-3.5 ${
                            reprocessar.isPending && reprocessar.variables === row.id
                              ? "animate-spin"
                              : ""
                          }`}
                        />
                        Reprocessar
                      </Button>
                    )}
                    {isAdmin && <ConferenciaManualControles {...conferenciaProps(row)} />}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-1"
                        title={row.arquivada_em ? "Desarquivar" : "Arquivar"}
                        disabled={arquivamento.isPending && arquivamento.variables?.id === row.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          arquivamento.mutate({ id: row.id, arquivar: !row.arquivada_em });
                        }}
                      >
                        {row.arquivada_em ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-1 text-red-600 hover:text-red-700"
                        title="Excluir submissão (somente admin)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExcluindo(row);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Paginação */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} submissão(ões) · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <DetalheSubmissao
        submissao={detalhe}
        podeReprocessar={podeReprocessar}
        reprocessando={reprocessar.isPending}
        onReprocessar={(id) => reprocessar.mutate(id)}
        onClose={() => setDetalhe(null)}
        conferencia={isAdmin && detalhe ? conferenciaProps(detalhe) : null}
      />

      <ExcluirSubmissaoDialog
        submissao={excluindo}
        onClose={() => setExcluindo(null)}
        onExcluida={() => {
          setExcluindo(null);
          if (detalhe?.id === excluindo?.id) setDetalhe(null);
          queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
        }}
      />
    </div>
  );
}

// Conferência manual (só admin): "Turma conferida" e "Cobrança lançada".
// Com as duas salvas a submissão fica conferida e aparece "Desfazer conferência".
function ConferenciaManualControles({
  submissao,
  salvando,
  desfazendo,
  onSalvar,
  onDesfazer,
  className = "",
}: {
  submissao: Submissao;
  salvando: boolean;
  desfazendo: boolean;
  onSalvar: (turmaConferida: boolean, cobrancaLancada: boolean) => void;
  onDesfazer: () => void;
  className?: string;
}) {
  const gravada = lerConferenciaManual(submissao.conferencia);
  const turmaInicial = gravada?.turmaConferida ?? submissao.turma_status === "matriculado";
  const cobrancaInicial = gravada?.cobrancaLancada ?? submissao.faturamento_status === "lancado";
  const [turma, setTurma] = useState(turmaInicial);
  const [cobranca, setCobranca] = useState(cobrancaInicial);
  useEffect(() => {
    setTurma(turmaInicial);
    setCobranca(cobrancaInicial);
  }, [submissao.id, submissao.conferido_em, turmaInicial, cobrancaInicial]);

  if (submissao.conferido_em) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={`ml-1 ${className}`}
        disabled={desfazendo}
        onClick={(e) => {
          e.stopPropagation();
          onDesfazer();
        }}
      >
        <Undo2 className="mr-2 h-3.5 w-3.5" /> Desfazer conferência
      </Button>
    );
  }
  const alterado = turma !== turmaInicial || cobranca !== cobrancaInicial;
  return (
    <div
      className={`ml-1 inline-flex flex-wrap items-center gap-3 align-middle ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
        <Checkbox checked={turma} onCheckedChange={(v) => setTurma(v === true)} />
        Turma conferida
      </label>
      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
        <Checkbox checked={cobranca} onCheckedChange={(v) => setCobranca(v === true)} />
        Cobrança lançada
      </label>
      <Button
        variant="outline"
        size="sm"
        disabled={salvando || (!turma && !cobranca) || (!alterado && !(turma && cobranca))}
        onClick={() => onSalvar(turma, cobranca)}
      >
        Salvar
      </Button>
    </div>
  );
}

// Confirmação da exclusão (só admin): mostra o que já foi criado no Sponte a
// partir dos dados gravados e exige "Estou ciente" quando houver algo.
function ExcluirSubmissaoDialog({
  submissao,
  onClose,
  onExcluida,
}: {
  submissao: Submissao | null;
  onClose: () => void;
  onExcluida: () => void;
}) {
  const resumoFn = useServerFn(resumoExclusaoMatricula);
  const excluirFn = useServerFn(excluirMatricula);
  const [ciente, setCiente] = useState(false);

  useEffect(() => setCiente(false), [submissao?.id]);

  const { data: resumo, isLoading } = useQuery({
    queryKey: ["matricula-exclusao-resumo", submissao?.id],
    queryFn: () => resumoFn({ data: { id: submissao!.id } }),
    enabled: !!submissao,
  });

  const excluir = useMutation({
    mutationFn: () => excluirFn({ data: { id: submissao!.id, ciente } }),
    onSuccess: (res) => {
      toast.success(
        res.arquivosRemovidos > 0
          ? `Submissão excluída do School Hub (${res.arquivosRemovidos} arquivo(s) removido(s)).`
          : "Submissão excluída do School Hub.",
      );
      onExcluida();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir a submissão."),
  });

  const bloqueado = !resumo || excluir.isPending || (resumo.exigeCiencia && !ciente);

  return (
    <Dialog open={!!submissao} onOpenChange={(o) => !o && !excluir.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-red-600" /> Excluir submissão
          </DialogTitle>
          <DialogDescription>
            A submissão e todos os registros ligados a ela no School Hub (rotina, saúde, documentos
            e arquivos, onboarding e lançamentos) serão apagados. Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !resumo ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Aluno</dt>
              <dd className="font-medium">{resumo.alunoNome || "—"}</dd>
              <dt className="text-muted-foreground">CPF</dt>
              <dd>{resumo.cpf || "—"}</dd>
              <dt className="text-muted-foreground">Unidade</dt>
              <dd>{resumo.unidade || "—"}</dd>
              <dt className="text-muted-foreground">Envio</dt>
              <dd>{formatDataHora(resumo.enviadoEm)}</dd>
            </dl>

            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 font-medium">Já criado no Sponte</p>
              <ul className="space-y-0.5">
                <li>
                  Aluno criado:{" "}
                  {resumo.integracao.alunoCriado
                    ? `sim (AlunoID ${resumo.integracao.spontAlunoId})`
                    : "não"}
                </li>
                <li>
                  Matrícula na turma:{" "}
                  {resumo.integracao.turmaMatriculada
                    ? `sim${resumo.integracao.turmaNome ? ` (${resumo.integracao.turmaNome})` : ""}`
                    : "não"}
                </li>
                <li>Cobranças lançadas: {rotuloCobrancas(resumo.integracao.cobrancasLancadas)}</li>
              </ul>
            </div>

            {resumo.exigeCiencia && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <p className="flex items-start gap-2 font-semibold">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {AVISO_SPONTE}
                </p>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox checked={ciente} onCheckedChange={(v) => setCiente(v === true)} />
                  Estou ciente
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={excluir.isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={bloqueado} onClick={() => excluir.mutate()}>
            {excluir.isPending ? "Excluindo…" : "Excluir do School Hub"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetalheSubmissao({
  submissao,
  podeReprocessar,
  reprocessando,
  onReprocessar,
  onClose,
  conferencia,
}: {
  submissao: Submissao | null;
  podeReprocessar: boolean;
  reprocessando: boolean;
  onReprocessar: (id: string) => void;
  onClose: () => void;
  conferencia: ComponentProps<typeof ConferenciaManualControles> | null;
}) {
  const responsaveis = submissao?.resultado?.responsaveis ?? [];
  const ehReprocessavel = submissao
    ? (STATUS_STYLE[submissao.status]?.reprocessavel ?? false)
    : false;

  return (
    <Sheet
      open={!!submissao}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {submissao && (
          <>
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="pr-6 text-base leading-tight">
                {submissao.aluno_nome || "Submissão sem nome"}
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusBadge status={submissao.status} />
                <span className="text-xs text-muted-foreground">
                  {formatDataHora(submissao.created_at)}
                </span>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 px-4 py-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Campo rotulo="Unidade" valor={submissao.unidade} />
                <Campo rotulo="CPF do aluno" valor={submissao.aluno_cpf} />
                <Campo
                  rotulo="AlunoID no Sponte"
                  valor={submissao.sponte_aluno_id ? String(submissao.sponte_aluno_id) : null}
                />
                <Campo rotulo="ID da resposta do Forms" valor={submissao.submission_id} />
                <Campo rotulo="Tentativas" valor={String(submissao.tentativas ?? 1)} />
                <Campo
                  rotulo="Reprocessado em"
                  valor={
                    submissao.reprocessado_em ? formatDataHora(submissao.reprocessado_em) : null
                  }
                />
              </dl>

              {conferencia && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                  <p className="flex-1 text-xs text-muted-foreground">
                    {submissao.conferido_em
                      ? `Conferido em ${formatDataHora(submissao.conferido_em)}${
                          submissao.conferido_por_nome ? ` por ${submissao.conferido_por_nome}` : ""
                        }.`
                      : "Conferência manual da turma e da cobrança deste envio."}
                  </p>
                  <ConferenciaManualControles {...conferencia} />
                </div>
              )}

              {submissao.erro && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {submissao.erro}
                </div>
              )}

              {responsaveis.length > 0 && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Responsáveis enviados
                  </h3>
                  {responsaveis.map((r, i) => (
                    <div key={`${r.nome}-${i}`} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{r.nome}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            r.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {r.ok ? (r.reaproveitado ? "Reaproveitado" : "Criado") : "Falhou"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.parentescoConfirmado || r.parentesco} ({r.parentescoId})
                        {r.responsavelId ? ` · ResponsávelID ${r.responsavelId}` : ""}
                        {r.responsavelFinanceiro ? " · Financeiro" : ""}
                        {r.responsavelDidatico ? " · Didático" : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{r.retorno}</p>
                    </div>
                  ))}
                </section>
              )}

              <FichaSubmissao submissao={submissao} />

              <BlocoJson titulo="Payload recebido do formulário" valor={submissao.payload} />
              <BlocoJson titulo="Resposta do Sponte" valor={submissao.resultado} />
            </div>

            {ehReprocessavel && podeReprocessar && (
              <div className="border-t px-4 py-3">
                <Button
                  className="w-full"
                  disabled={reprocessando}
                  onClick={() => onReprocessar(submissao.id)}
                >
                  <RotateCw className={`mr-2 h-4 w-4 ${reprocessando ? "animate-spin" : ""}`} />
                  Reprocessar no Sponte
                </Button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Reenvia o payload original. Se o aluno já tiver sido criado, apenas os
                  responsáveis são enviados novamente.
                </p>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// A ficha completa combina o payload gravado na submissão com rotina, saúde e
// documentos (tabelas locais, lidas sob demanda). Vale também para submissões
// que falharam no Sponte: o cadastro é gravado antes da integração.
function FichaSubmissao({ submissao }: { submissao: Submissao }) {
  const carregar = useServerFn(detalheMatricula);
  const submissionId = submissao.submission_id;
  const { data, isFetching, isError } = useQuery({
    queryKey: ["matricula-detalhe", submissionId],
    enabled: submissionId !== null,
    queryFn: async () => carregar({ data: { submissionId: submissionId ?? "" } }),
    // O link do documento é assinado e expira: não vale reaproveitar cache velho.
    staleTime: 0,
    gcTime: 0,
  });
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const resolverFn = useServerFn(resolverPendenciaMatricula);
  const resolver = useMutation({
    mutationFn: async () => resolverFn({ data: { id: submissao.id } }),
    onSuccess: async () => {
      toast.success("Pendência baixada. O aviso sai do sino.");
      await queryClient.invalidateQueries({ queryKey: ["matriculas-submissoes"] });
      await queryClient.invalidateQueries({ queryKey: ["matriculas-pendencias"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (submissionId !== null && isFetching) return <Skeleton className="h-24 w-full" />;

  const locaisIndisponiveis = submissionId !== null && (isError || !data?.ok);
  const secoes = montarSecoesDetalhe({
    submissao: {
      submissionId: submissao.submission_id,
      unidade: submissao.unidade,
      alunoNome: submissao.aluno_nome,
      alunoNomeFormulario: submissao.aluno_nome_formulario,
      alunoCpf: submissao.aluno_cpf,
      status: STATUS_STYLE[submissao.status]?.label ?? submissao.status,
      criadoEm: formatDataHora(submissao.created_at),
      sponteAlunoId: submissao.sponte_aluno_id,
      erro: submissao.erro,
      payload: submissao.payload,
    },
    rotina: data?.rotina ?? null,
    saude: data?.saude ?? null,
    documentos: data?.documentos ?? [],
    financeiro: {
      situacao: submissao,
      snapshot: submissao,
      lancamentos: data?.lancamentos ?? [],
    },
  });

  async function baixarPdf() {
    try {
      await gerarPdfFichaMatricula(
        "Ficha de matrícula",
        `${submissao.aluno_nome ?? "Aluno sem nome"} · ${submissao.unidade ?? "Unidade não informada"} · ${formatDataHora(submissao.created_at)}`,
        secoes,
        nomeArquivoFichaMatricula(submissao.aluno_nome, submissao.submission_id),
      );
    } catch {
      toast.error("Não foi possível gerar o PDF da ficha.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Formulário completo
        </h3>
        <Button variant="outline" size="sm" onClick={baixarPdf}>
          <Printer className="mr-2 h-3.5 w-3.5" /> Baixar PDF
        </Button>
      </div>

      {isAdmin && temPendencia(submissao) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Pendência de integração</p>
          <p className="mt-1">
            O aviso some sozinho quando o reprocessamento resolve. Se a turma ou as cobranças foram
            tratadas manualmente no Sponte, dê baixa aqui.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={resolver.isPending}
            onClick={() => resolver.mutate()}
          >
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Dar baixa na pendência
          </Button>
        </div>
      )}

      {locaisIndisponiveis && (
        <p className="text-xs text-muted-foreground">
          Não foi possível carregar rotina, saúde e documentos desta submissão.
        </p>
      )}

      {secoes.map((secao) => (
        <BlocoSecao key={secao.titulo} secao={secao} />
      ))}
    </div>
  );
}

function BlocoSecao({ secao }: { secao: SecaoDetalhe }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {secao.titulo}
      </h4>
      {secao.grupos.map((grupo, i) => (
        <div key={grupo.titulo ?? i} className="rounded-lg border border-border p-3">
          {grupo.titulo !== null && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {grupo.titulo}
            </p>
          )}
          <dl className="space-y-1.5">
            {grupo.campos.map((campo) => (
              <div key={campo.rotulo} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {campo.rotulo}
                  </dt>
                  <dd className="whitespace-pre-wrap break-words text-sm">{campo.valor}</dd>
                </div>
                {campo.link !== undefined && (
                  <Button asChild variant="outline" size="sm">
                    <a href={campo.link} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-sm" title={valor ?? undefined}>
        {valor || "—"}
      </dd>
    </div>
  );
}

function BlocoJson({ titulo, valor }: { titulo: string; valor: unknown }) {
  const [copiado, setCopiado] = useState(false);
  const texto = valor == null ? "—" : JSON.stringify(valor, null, 2);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar — copie manualmente do painel.");
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </h3>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copiar}>
          {copiado ? <CopyCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="ml-1 text-[11px]">{copiado ? "Copiado" : "Copiar"}</span>
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
        {texto}
      </pre>
    </section>
  );
}
