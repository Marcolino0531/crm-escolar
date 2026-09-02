// Dashboard de Matrículas: auditoria das submissões do formulário de matrícula
// (Google Forms → webhook → Sponte). Lista o que entrou, mostra o payload
// original ao lado da resposta do Sponte e reenvia o que falhou.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Copy,
  CopyCheck,
  ExternalLink,
  Inbox,
  Printer,
  RefreshCw,
  RotateCw,
  Users,
} from "lucide-react";
import { usePermissions } from "@/lib/app-context";
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
import { detalheMatricula, reprocessarMatricula } from "@/lib/matriculas.functions";
import { STATUS_ERRO } from "@/lib/matriculas.audit";
import { montarSecoesDetalhe, type SecaoDetalhe } from "@/lib/matricula-detalhe";
import { gerarPdfFichaMatricula, nomeArquivoFichaMatricula } from "@/lib/matricula-detalhe-pdf";

export const Route = createFileRoute("/matriculas")({
  head: () => ({ meta: [{ title: "Matrículas — School Hub" }] }),
  component: MatriculasGate,
});

function MatriculasGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("admissoes"))
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
// só mostram o motivo — a correção é na origem (Google Forms).
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
  { value: "sucesso", label: "Sucesso" },
  { value: "duplicado", label: "Duplicado" },
  { value: "erros", label: "Todos os erros" },
  { value: "erro_aluno", label: "Erro no aluno" },
  { value: "erro_responsavel", label: "Erro no responsável" },
  { value: "erro_validacao", label: "Erro de validação" },
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
  aluno_cpf: string | null;
  sponte_aluno_id: number | null;
  status: SubmissionStatus;
  erro: string | null;
  payload: unknown;
  resultado: Resultado | null;
  tentativas: number | null;
  reprocessado_em: string | null;
  created_at: string;
};

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
  const podeReprocessar = canEdit("admissoes");
  const queryClient = useQueryClient();
  const reprocessarFn = useServerFn(reprocessarMatricula);

  // Escopo da listagem: unidade do topo (consolidado em "Todas as Unidades").
  const unidade = useUnidadeAtiva();
  const [status, setStatus] = useState("todos");
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [detalhe, setDetalhe] = useState<Submissao | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounced(busca.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  // Trocar a unidade no topo recomeça a paginação.
  useEffect(() => setPage(1), [unidade]);

  const queryKey = ["matriculas-submissoes", unidade, status, buscaDebounced, page];

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
      else if (status !== "todos") q = q.eq("status", status);
      if (buscaDebounced) {
        // Vírgula e parênteses quebram a sintaxe do filtro `or` do PostgREST.
        const termo = buscaDebounced.replace(/[,()]/g, " ").trim();
        if (termo) q = q.or(`aluno_nome.ilike.%${termo}%,aluno_cpf.ilike.%${termo}%`);
      }

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

  const filtrosAtivos = status !== "todos" || busca !== "";

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
            <p className="text-sm font-medium">Nenhuma matrícula registrada.</p>
            <p className="text-xs text-muted-foreground">
              As respostas do formulário aparecem aqui assim que chegam ao webhook.
            </p>
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
                  <TableCell className="text-sm font-medium">{row.aluno_nome || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {row.aluno_cpf || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{row.unidade || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
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
      />
    </div>
  );
}

function DetalheSubmissao({
  submissao,
  podeReprocessar,
  reprocessando,
  onReprocessar,
  onClose,
}: {
  submissao: Submissao | null;
  podeReprocessar: boolean;
  reprocessando: boolean;
  onReprocessar: (id: string) => void;
  onClose: () => void;
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

              <BlocoJson titulo="Payload recebido do Google Forms" valor={submissao.payload} />
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

  if (submissionId !== null && isFetching) return <Skeleton className="h-24 w-full" />;

  const locaisIndisponiveis = submissionId !== null && (isError || !data?.ok);
  const secoes = montarSecoesDetalhe({
    submissao: {
      submissionId: submissao.submission_id,
      unidade: submissao.unidade,
      alunoNome: submissao.aluno_nome,
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
