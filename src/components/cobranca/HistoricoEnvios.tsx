import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle, Send, Inbox, CalendarCheck, CheckCircle2 } from "lucide-react";
import { useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR } from "@/lib/date-utils";
import { displayPhoneBR } from "@/lib/phone";

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Aba "Histórico de Envios" (Dashboard de logs de WhatsApp) ───────────────

const STATUS_FILTROS = [
  { value: "todos", label: "Todos os status" },
  { value: "pendente", label: "Pendente" },
  { value: "enviado", label: "Enviado" },
  { value: "entregue", label: "Entregue" },
  { value: "lido", label: "Lido" },
  { value: "falha", label: "Falha" },
  { value: "sucesso", label: "Sucesso (manual)" },
  { value: "erro", label: "Erro (manual)" },
] as const;

type BillingStatus = "sucesso" | "erro" | "pendente" | "enviado" | "entregue" | "lido" | "falha";

type BillingLog = {
  id: string;
  data_envio: string;
  responsavel_name: string;
  aluno_name: string;
  telefone: string;
  unidade: string;
  valor: number;
  vencimento: string | null;
  status: BillingStatus;
  erro_mensagem: string | null;
  fatura_id: string | null;
};

// Tag visual por status (verde = entregue/lido, vermelho = falha, etc.).
const STATUS_STYLE: Record<BillingStatus, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-slate-100 text-slate-600" },
  enviado: { label: "Enviado", cls: "bg-sky-100 text-sky-700" },
  entregue: { label: "Entregue", cls: "bg-emerald-100 text-emerald-700" },
  lido: { label: "Lido", cls: "bg-emerald-200 text-emerald-800" },
  falha: { label: "Falha", cls: "bg-red-100 text-red-700" },
  sucesso: { label: "Sucesso", cls: "bg-emerald-100 text-emerald-700" },
  erro: { label: "Erro", cls: "bg-red-100 text-red-700" },
};

type LogsResponse = {
  ok: boolean;
  data: BillingLog[];
  page: number;
  per_page: number;
  total: number;
  summary: { hoje: number; falhas: number; mes: number };
  error?: string;
};

const PER_PAGE = 20;

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

export function HistoricoEnvios() {
  // Escopo do histórico: unidade do topo (consolidado em "Todas as Unidades").
  const unidade = useUnidadeAtiva();
  const [status, setStatus] = useState<string>("todos");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [buscaDebounced, setBuscaDebounced] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounced(busca.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  // Trocar a unidade no topo recomeça a paginação.
  useEffect(() => setPage(1), [unidade]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["cobranca-whatsapp-logs", unidade, status, dateStart, dateEnd, buscaDebounced, page],
    queryFn: async (): Promise<LogsResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");

      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (unidade) params.set("unidade", unidade);
      if (status !== "todos") params.set("status", status);
      if (dateStart) params.set("date_start", dateStart);
      if (dateEnd) params.set("date_end", dateEnd);
      if (buscaDebounced) params.set("q", buscaDebounced);

      const resp = await fetch(`/api/cobrancas/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await resp.json()) as LogsResponse;
      if (!resp.ok || !body.ok) throw new Error(body.error ?? "Falha ao carregar os logs.");
      return body;
    },
  });

  const summary = data?.summary ?? { hoje: 0, falhas: 0, mes: 0 };
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  function resetFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Mini-cards de resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ResumoCard
          icon={<Send className="h-5 w-5 text-sky-600" />}
          label="Envios de Hoje"
          value={summary.hoje}
          tone="sky"
        />
        <ResumoCard
          icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
          label="Falhas Ativas (mês)"
          value={summary.falhas}
          tone="red"
        />
        <ResumoCard
          icon={<CalendarCheck className="h-5 w-5 text-emerald-600" />}
          label="Total do Mês"
          value={summary.mes}
          tone="emerald"
        />
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
          <Select value={status} onValueChange={(v) => resetFilter(setStatus, v)}>
            <SelectTrigger className="h-9 w-44">
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
          <label className="text-[11px] font-medium text-muted-foreground">Período (de)</label>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => {
              setDateStart(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Período (até)</label>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => {
              setDateEnd(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            Buscar por nome (responsável ou aluno)
          </label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Digite um nome…"
            className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        {(status !== "todos" || dateStart || dateEnd || busca) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("todos");
              setDateStart("");
              setDateEnd("");
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
            {error instanceof Error ? error.message : "Falha ao carregar os logs."}
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
            <p className="text-sm font-medium">Nenhum disparo registrado.</p>
            <p className="text-xs text-muted-foreground">
              Os envios de WhatsApp da régua aparecem aqui assim que registrados.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data e Hora</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status do Envio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => {
                const style = STATUS_STYLE[log.status] ?? STATUS_STYLE.pendente;
                const badge = (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}
                  >
                    {log.status === "falha" || log.status === "erro" ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {style.label}
                  </span>
                );
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDataHora(log.data_envio)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {log.responsavel_name || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{log.aluno_name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {displayPhoneBR(log.telefone) || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{log.unidade || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm">
                      {log.valor ? formatarMoeda(log.valor) : "—"}
                    </TableCell>
                    <TableCell>
                      {log.status === "falha" || log.status === "erro" ? (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">{badge}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs whitespace-pre-wrap">
                              {log.erro_mensagem || "Falha no envio (sem detalhes)."}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        badge
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Paginação */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} registro(s) · página {page} de {totalPages}
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
    </div>
  );
}

function ResumoCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "sky" | "red" | "emerald";
}) {
  const ring =
    tone === "red" ? "ring-red-100" : tone === "emerald" ? "ring-emerald-100" : "ring-sky-100";
  return (
    <div className={`rounded-xl border border-border bg-card p-4 ring-1 ${ring}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}
