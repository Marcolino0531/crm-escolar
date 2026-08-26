import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot,
  Send,
  FlaskConical,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Handshake,
  Inbox,
  FileText,
  Loader2,
  Search,
  Trash2,
  X,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Timer,
  User,
} from "lucide-react";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarAlunosSponte,
  enviarCobrancaTeste,
  type AlunoBuscaSponte,
} from "@/lib/sponte.functions";
import { isDiaUtil } from "@/lib/billing-schedule";
import { alertaExecucaoCron } from "@/lib/billing-cron-runs";
import { rotuloMesReferencia } from "@/lib/billing-exceptions";
import { useAuth } from "@/lib/app-context";
import { PausasPorComprovante } from "@/components/cobranca/PausaComprovante";
import { displayPhoneBR } from "@/lib/phone";

export const Route = createFileRoute("/cobranca-automatica")({
  head: () => ({ meta: [{ title: "Mensagens Automáticas — School Hub" }] }),
  component: MensagensAutomaticasGate,
});

// O módulo passou a ser Operacional, mas a permissão continua a mesma
// (`financeiro_cobranca`): quem já tinha acesso à Cobrança Automática não precisa
// ser reconfigurado. A macro Financeiro deixou de ser exigida.
function MensagensAutomaticasGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro_cobranca"))
    return <AccessDenied message="Você não tem permissão para acessar as Mensagens Automáticas." />;
  return <MensagensAutomaticasPage />;
}

// Duas réguas de WhatsApp no mesmo módulo, cada uma em sua aba:
//   • Cobranças Automáticas — após o vencimento (recorrente até a quitação);
//   • Lembretes Automáticos — antes do vencimento (D-5, D-3 e D-0).
function MensagensAutomaticasPage() {
  const [tab, setTab] = useState("cobrancas");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot className="h-6 w-6 text-primary" /> Mensagens Automáticas
        </h1>
        <p className="text-sm text-muted-foreground">
          Disparos automáticos via WhatsApp (Cloud API da Meta): cobrança do que já venceu e
          lembrete preventivo antes do vencimento, com histórico e rastreamento de status.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="cobrancas">Cobranças Automáticas</TabsTrigger>
          <TabsTrigger value="lembretes">Lembretes Automáticos</TabsTrigger>
        </TabsList>
        <TabsContent value="cobrancas" className="pt-4">
          <CobrancasAutomaticasTab />
        </TabsContent>
        <TabsContent value="lembretes" className="pt-4">
          <LembretesAutomaticosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const UNIDADES_SPONTE = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

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
  message_body: string | null;
  prazo_lembrete?: string | null;
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

const STATUS_STYLE: Record<BillingStatus, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-slate-100 text-slate-600" },
  enviado: { label: "Enviada", cls: "bg-sky-100 text-sky-700" },
  entregue: { label: "Entregue", cls: "bg-emerald-100 text-emerald-700" },
  lido: { label: "Lida", cls: "bg-emerald-200 text-emerald-800" },
  falha: { label: "Falha", cls: "bg-red-100 text-red-700" },
  sucesso: { label: "Enviada", cls: "bg-emerald-100 text-emerald-700" },
  erro: { label: "Falha", cls: "bg-red-100 text-red-700" },
};

const PER_PAGE = 20;

function formatBRL(n: number): string {
  return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

function CobrancasAutomaticasTab() {
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("financeiro_cobranca");
  const [page, setPage] = useState(1);
  const [selecionado, setSelecionado] = useState<BillingLog | null>(null);

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["cobranca-automatica-logs", page],
    refetchInterval: 60000,
    queryFn: async (): Promise<LogsResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        tipo: "cobranca",
      });
      const resp = await fetch(`/api/cobrancas/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await resp.json()) as LogsResponse;
      if (!resp.ok || !body.ok) throw new Error(body.error ?? "Falha ao carregar os logs.");
      return body;
    },
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-6">
      <KillSwitch podeEditar={podeEditar} />

      <ExecucoesDoCron />

      {podeEditar && <AmbienteDeTeste onEnviado={() => refetch()} />}

      <PausasPorComprovante podeEditar={podeEditar} />

      <AlunosComAcordo podeEditar={podeEditar} />

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Histórico de Disparos</h2>
          <span className="text-xs text-muted-foreground">
            {total} registro(s) · clique em uma linha para ver o conteúdo enviado
          </span>
        </div>
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
              Use o Ambiente de Teste acima ou aguarde o cron diário de cobrança.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data e Hora</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => {
                const style = STATUS_STYLE[log.status] ?? STATUS_STYLE.pendente;
                const falhou = log.status === "falha" || log.status === "erro";
                return (
                  <TableRow
                    key={log.id}
                    onClick={() => setSelecionado(log)}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDataHora(log.data_envio)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{log.aluno_name || "—"}</TableCell>
                    <TableCell className="text-sm">{log.responsavel_name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {displayPhoneBR(log.telefone) || "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}
                      >
                        {falhou ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {style.label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              Página {page} de {totalPages}
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

      <DetalheDisparo log={selecionado} onClose={() => setSelecionado(null)} />
    </div>
  );
}

const PRAZO_STYLE: Record<string, { label: string; cls: string }> = {
  "D-5": { label: "D-5 · 5 dias antes", cls: "bg-sky-100 text-sky-700" },
  "D-3": { label: "D-3 · 3 dias antes", cls: "bg-indigo-100 text-indigo-700" },
  "D-0": { label: "D-0 · vence hoje", cls: "bg-amber-100 text-amber-800" },
};

// Régua PREVENTIVA: o lembrete sai antes do vencimento (D-5, D-3 e D-0) e para
// de sair no momento em que a parcela é quitada. Não há ambiente de teste próprio
// nem kill switch próprio: a pausa do dia e o calendário de dias úteis são os
// mesmos da aba de Cobranças.
function LembretesAutomaticosTab() {
  const [page, setPage] = useState(1);
  const [selecionado, setSelecionado] = useState<BillingLog | null>(null);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["lembretes-automaticos-logs", page],
    refetchInterval: 60000,
    queryFn: async (): Promise<LogsResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        tipo: "lembrete",
      });
      const resp = await fetch(`/api/cobrancas/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await resp.json()) as LogsResponse;
      if (!resp.ok || !body.ok) throw new Error(body.error ?? "Falha ao carregar os logs.");
      return body;
    },
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <CalendarClock className="mt-0.5 h-6 w-6 shrink-0 text-sky-600" />
        <div className="text-sm">
          <div className="font-semibold text-sky-900">Lembrete preventivo do boleto</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cada parcela em aberto no Sponte gera lembrete <strong>5 dias antes</strong>,{" "}
            <strong>3 dias antes</strong> e <strong>no dia do vencimento</strong>, pelo vencimento
            real da própria parcela, com valor e linha digitável do boleto. Parcela quitada antes do
            prazo não gera o lembrete daquele prazo. Quando o responsável tem cobrança de parcela
            vencida no mesmo dia, o lembrete é pulado — a cobrança tem prioridade. Vale a mesma
            pausa de fim de semana, feriado e kill switch da aba de Cobranças.
          </p>
        </div>
      </div>

      <ExecucoesDoCron
        tipo="lembrete"
        legenda="Tentativas diárias às 10h e 16h (BRT) · um lembrete por responsável por dia"
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Histórico de Disparos</h2>
          <span className="text-xs text-muted-foreground">
            {total} registro(s) · clique em uma linha para ver o conteúdo enviado
          </span>
        </div>
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
            <p className="text-sm font-medium">Nenhum lembrete disparado.</p>
            <p className="text-xs text-muted-foreground">
              Os lembretes saem automaticamente quando há parcela vencendo em 5 dias, 3 dias ou
              hoje.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data e Hora</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => {
                const style = STATUS_STYLE[log.status] ?? STATUS_STYLE.pendente;
                const prazo = log.prazo_lembrete ? PRAZO_STYLE[log.prazo_lembrete] : null;
                const falhou = log.status === "falha" || log.status === "erro";
                return (
                  <TableRow
                    key={log.id}
                    onClick={() => setSelecionado(log)}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDataHora(log.data_envio)}
                    </TableCell>
                    <TableCell>
                      {prazo ? (
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${prazo.cls}`}
                        >
                          {prazo.label}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{log.aluno_name || "—"}</TableCell>
                    <TableCell className="text-sm">{log.responsavel_name || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {log.vencimento ? formatDiaBR(log.vencimento) : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {log.valor ? formatBRL(log.valor) : "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}
                      >
                        {falhou ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {style.label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              Página {page} de {totalPages}
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

      <DetalheDisparo log={selecionado} onClose={() => setSelecionado(null)} />
    </div>
  );
}

type CronRun = {
  id: string;
  data_ref: string;
  slot: string;
  iniciado_em: string;
  finalizado_em: string | null;
  status: "em_andamento" | "ok" | "sem_envio" | "nao_util" | "pausado" | "erro";
  responsaveis: number;
  enviados: number;
  falhas: number;
  pulados: number;
  motivo: string | null;
  erro: string | null;
  duracao_ms: number | null;
};

const RUN_STATUS_STYLE: Record<CronRun["status"], { label: string; cls: string }> = {
  em_andamento: { label: "Em andamento", cls: "bg-slate-100 text-slate-600" },
  ok: { label: "Disparou", cls: "bg-emerald-100 text-emerald-700" },
  sem_envio: { label: "Sem envio", cls: "bg-sky-100 text-sky-700" },
  nao_util: { label: "Dia não útil", cls: "bg-slate-100 text-slate-600" },
  pausado: { label: "Pausado", cls: "bg-amber-100 text-amber-700" },
  erro: { label: "Erro", cls: "bg-red-100 text-red-700" },
};

// Execuções do cron — inclusive as que não enviaram nada. É aqui que um disparo
// perdido (deploy na hora do agendamento, timeout, erro do Sponte) fica visível.
function ExecucoesDoCron({
  tipo = "cobranca",
  legenda = "Tentativas diárias às 09h, 12h, 15h e 18h · quem já foi cobrado no dia não recebe de novo",
}: {
  tipo?: "cobranca" | "lembrete";
  legenda?: string;
}) {
  const { data: runs = [], isError } = useQuery({
    queryKey: ["cobranca-cron-runs", tipo],
    refetchInterval: 60000,
    queryFn: async (): Promise<CronRun[]> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");
      const resp = await fetch(`/api/cobrancas/cron-runs?limit=12&tipo=${tipo}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await resp.json()) as { ok: boolean; data?: CronRun[]; error?: string };
      if (!resp.ok || !body.ok) throw new Error(body.error ?? "Falha ao carregar as execuções.");
      return body.data ?? [];
    },
  });

  const hoje = hojeSaoPauloYMD();
  const horaBRT = Number(
    new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }),
  );
  // O alerta de execução perdida vale só para a cobrança: os horários de referência
  // (09h em diante) são os dela.
  const alerta =
    tipo === "cobranca" ? alertaExecucaoCron(runs, hoje, horaBRT, isDiaUtil(hoje)) : null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Timer className="h-4 w-4 text-primary" /> Execuções da Automação
        </h2>
        <span className="text-xs text-muted-foreground">{legenda}</span>
      </div>

      {alerta && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {alerta} ({formatDiaBR(hoje)}) — a próxima tentativa do dia cobre o disparo.
          </span>
        </div>
      )}

      {isError ? (
        <div className="px-4 py-4 text-sm text-red-600">Falha ao carregar as execuções.</div>
      ) : runs.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Nenhuma execução registrada ainda.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead>Tentativa</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Detalhe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => {
              const style = RUN_STATUS_STYLE[r.status] ?? RUN_STATUS_STYLE.em_andamento;
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDiaBR(r.data_ref)}
                  </TableCell>
                  <TableCell className="text-sm">{r.slot}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDataHora(r.iniciado_em)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}
                    >
                      {style.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.erro
                      ? r.erro
                      : r.status === "ok"
                        ? `${r.enviados} enviada(s), ${r.falhas} falha(s), ${r.pulados} já cobrado(s)`
                        : (r.motivo ?? "—")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// Data de hoje (YYYY-MM-DD) no horário de Brasília — mesma referência do cron.
function hojeSaoPauloYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatDiaBR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

// Kill switch: pausa o disparo automático do dia (contingência para quando o
// arquivo retorno do banco não pôde ser baixado a tempo). A trava vale só para
// hoje; no dia seguinte a automação volta a rodar sozinha.
function KillSwitch({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const hoje = hojeSaoPauloYMD();

  const { data: pausadoHoje = false } = useQuery({
    queryKey: ["cobranca-pause", hoje],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_billing_pause" as never)
        .select("paused_date")
        .eq("id", "singleton")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const pd = (data as unknown as { paused_date: string | null } | null)?.paused_date ?? null;
      return pd === hoje;
    },
  });

  const toggle = useMutation({
    mutationFn: async (pausar: boolean) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("whatsapp_billing_pause" as never)
        .update({
          paused_date: pausar ? hoje : null,
          updated_at: new Date().toISOString(),
          updated_by: u.user?.id ?? null,
        } as never)
        .eq("id", "singleton");
      if (error) throw new Error(error.message);
      return pausar;
    },
    onSuccess: (pausar) => {
      toast.success(
        pausar ? "Envios automáticos pausados para hoje." : "Envios automáticos reativados.",
      );
      qc.invalidateQueries({ queryKey: ["cobranca-pause"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao alterar a pausa."),
  });

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
        pausadoHoje ? "border-red-300 bg-red-50" : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div className="flex items-start gap-3">
        {pausadoHoje ? (
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
        )}
        <div>
          <div
            className={`text-sm font-semibold ${pausadoHoje ? "text-red-700" : "text-emerald-800"}`}
          >
            {pausadoHoje
              ? `Envios automáticos PAUSADOS para hoje (${formatDiaBR(hoje)})`
              : "Envios automáticos ativos"}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pausadoHoje
              ? "Nenhuma cobrança será disparada hoje. A automação volta a rodar amanhã automaticamente."
              : "O disparo diário roda às 09:00 (horário de Brasília). Use a pausa se o arquivo retorno do banco não puder ser baixado a tempo."}
          </p>
        </div>
      </div>
      {podeEditar && (
        <Button
          variant={pausadoHoje ? "default" : "destructive"}
          className="gap-1.5"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!pausadoHoje)}
        >
          {pausadoHoje ? (
            <>
              <PlayCircle className="h-4 w-4" /> Reativar Envios
            </>
          ) : (
            <>
              <PauseCircle className="h-4 w-4" /> Pausar Envios
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function AmbienteDeTeste({ onEnviado }: { onEnviado: () => void }) {
  const enviarFn = useServerFn(enviarCobrancaTeste);
  const [unidade, setUnidade] = useState<string>("");
  const [alunoId, setAlunoId] = useState<string>("");

  const enviar = useMutation({
    mutationFn: () => enviarFn({ data: { unidade, alunoId: alunoId.trim() } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Cobrança de teste enviada para ${res.responsavel || "responsável"}.`);
      } else {
        toast.error(res.error ?? "Falha ao enviar a cobrança de teste.");
      }
      onEnviado();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao enviar a cobrança."),
  });

  const res = enviar.data;
  const valid = !!unidade && !!alunoId.trim();

  return (
    <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="h-4 w-4 text-primary" /> Ambiente de Teste
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Dispara o fluxo de cobrança para um AlunoID específico do Sponte, validando a integração
        ponta a ponta antes de habilitar o cron em lote. O disparo é registrado no histórico abaixo.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Unidade</Label>
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Selecione a unidade" />
            </SelectTrigger>
            <SelectContent>
              {UNIDADES_SPONTE.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="teste-aluno" className="text-[11px] text-muted-foreground">
            ID do Aluno (Sponte)
          </Label>
          <Input
            id="teste-aluno"
            value={alunoId}
            onChange={(e) => setAlunoId(e.target.value)}
            placeholder="ex.: 399"
            className="h-9 w-40"
          />
        </div>
        <Button
          className="h-9 gap-1"
          disabled={!valid || enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          <Send className="h-4 w-4" /> {enviar.isPending ? "Enviando…" : "Disparar teste"}
        </Button>
      </div>

      {res && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            res.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {res.ok ? (
            <>
              <div className="font-semibold">
                Enviada para {res.responsavel || "—"} · {displayPhoneBR(res.telefone ?? "") || "—"}
              </div>
              {res.mensagem && <div className="mt-1 whitespace-pre-wrap">{res.mensagem}</div>}
            </>
          ) : (
            <div className="font-medium">{res.error ?? "Falha no disparo."}</div>
          )}
        </div>
      )}
    </div>
  );
}

type ExcecaoAcordo = {
  id: string;
  aluno_id: string;
  aluno_nome: string;
  unidade: string;
  mes_referencia: string;
  created_at: string;
  created_by_nome: string;
};

// Alunos com acordo de parcelamento: a automação para de insistir nas parcelas
// vencidas até o mês do acordo e segue cobrando as posteriores. É um filtro do
// disparo — nada é escrito no Sponte nem nos débitos do School Hub.
function AlunosComAcordo({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const buscar = useServerFn(buscarAlunosSponte);

  const [unidade, setUnidade] = useState<string>("");
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<AlunoBuscaSponte[] | null>(null);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<AlunoBuscaSponte | null>(null);
  const [inicioMes, setInicioMes] = useState<string>(() => `${hojeSaoPauloYMD().slice(0, 7)}-01`);

  const { data: excecoes = [], isError } = useQuery({
    queryKey: ["cobranca-excecoes"],
    queryFn: async (): Promise<ExcecaoAcordo[]> => {
      const { data, error } = await supabase
        .from("whatsapp_billing_exceptions" as never)
        .select("id, aluno_id, aluno_nome, unidade, mes_referencia, created_at, created_by_nome")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ExcecaoAcordo[];
    },
  });

  const buscarAlunos = useMutation({
    mutationFn: async () => {
      const r = await buscar({ data: { nome: termo.trim(), unidade } });
      if (r.error) throw new Error(r.error);
      if (r.indisponivel) throw new Error(`Integração Sponte indisponível para "${unidade}".`);
      return r.alunos;
    },
    onSuccess: (alunos) => {
      setErroBusca(null);
      setResultados(alunos);
      setSelecionado(alunos.length === 1 ? alunos[0] : null);
    },
    onError: (e) => {
      setResultados(null);
      setErroBusca(e instanceof Error ? e.message : "Falha na busca.");
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!selecionado) throw new Error("Selecione um aluno.");
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error } = await supabase.from("whatsapp_billing_exceptions" as never).upsert(
        {
          aluno_id: selecionado.alunoId,
          aluno_nome: selecionado.nome,
          unidade,
          mes_referencia: inicioMes.slice(0, 7),
          created_at: new Date().toISOString(),
          created_by: session?.user?.id ?? null,
          created_by_nome: meta?.full_name || session?.user?.email || "",
        } as never,
        { onConflict: "aluno_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Aluno excluído da cobrança automática para o período do acordo.");
      setResultados(null);
      setSelecionado(null);
      setTermo("");
      qc.invalidateQueries({ queryKey: ["cobranca-excecoes"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar a exceção."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("whatsapp_billing_exceptions" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(
        "Exceção removida — a cobrança automática volta a valer para todas as parcelas.",
      );
      qc.invalidateQueries({ queryKey: ["cobranca-excecoes"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover a exceção."),
  });

  // Nome precisa de 3 letras; AlunoID (só dígitos) vale a partir de 1 caractere.
  const t = termo.trim();
  const termoValido = /^\d+$/.test(t) ? t.length >= 1 : t.length >= 3;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Handshake className="h-4 w-4 text-primary" /> Alunos com Acordo
        </h2>
        <span className="text-xs text-muted-foreground">
          {excecoes.length} aluno(s) com cobrança automática suspensa
        </span>
      </div>

      <p className="border-b border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        A exceção afeta <strong>apenas o disparo automático de cobrança via WhatsApp</strong>:
        parcelas vencidas até o mês do acordo (inclusive) deixam de ser cobradas, e as que vencerem
        depois continuam sendo cobradas normalmente. Nada é alterado no Sponte nem no cadastro
        financeiro do School Hub — os débitos continuam existindo e visíveis em Inadimplência, Fluxo
        Futuro e nas demais telas.
      </p>

      {podeEditar && (
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">Unidade</Label>
              <Select
                value={unidade}
                onValueChange={(v) => {
                  setUnidade(v);
                  setResultados(null);
                  setSelecionado(null);
                }}
              >
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="Selecione a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES_SPONTE.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="acordo-busca" className="text-[11px] text-muted-foreground">
                Aluno (nome ou AlunoID do Sponte)
              </Label>
              <Input
                id="acordo-busca"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && unidade && termoValido) buscarAlunos.mutate();
                }}
                placeholder="ex.: Giovanna ou 554"
                className="h-9 w-64"
              />
            </div>
            <Button
              variant="outline"
              className="h-9 gap-1"
              disabled={!unidade || !termoValido || buscarAlunos.isPending}
              onClick={() => buscarAlunos.mutate()}
            >
              {buscarAlunos.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar no Sponte
            </Button>
          </div>

          {erroBusca && <div className="text-xs text-red-600">{erroBusca}</div>}

          {resultados && resultados.length === 0 && (
            <div className="text-xs text-muted-foreground">
              Nenhum aluno encontrado para “{termo.trim()}” em {unidade}.
            </div>
          )}

          {resultados && resultados.length > 0 && (
            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {resultados.map((a) => (
                <button
                  key={a.alunoId}
                  type="button"
                  onClick={() => setSelecionado(a)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                    selecionado?.alunoId === a.alunoId ? "bg-primary/10" : ""
                  }`}
                >
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    AlunoID {a.alunoId}
                    {a.turma ? ` · ${a.turma}` : ""}
                    {a.situacao ? ` · ${a.situacao}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selecionado && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="text-sm">
                <div className="font-semibold">{selecionado.nome}</div>
                <div className="text-xs text-muted-foreground">
                  AlunoID {selecionado.alunoId} · {unidade}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">
                  Mês de referência do acordo
                </div>
                <MonthYearPicker startDate={inicioMes} onChange={(start) => setInicioMes(start)} />
              </div>
              <Button
                className="h-9 gap-1"
                disabled={salvar.isPending}
                onClick={() => salvar.mutate()}
              >
                <Handshake className="h-4 w-4" />
                {salvar.isPending ? "Salvando…" : "Suspender cobrança"}
              </Button>
            </div>
          )}
        </div>
      )}

      {isError ? (
        <div className="px-4 py-4 text-sm text-red-600">Falha ao carregar as exceções.</div>
      ) : excecoes.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum aluno com acordo cadastrado — a cobrança automática vale para todos.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aluno</TableHead>
              <TableHead>AlunoID</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Acordo até</TableHead>
              <TableHead>Cadastrado por</TableHead>
              {podeEditar && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {excecoes.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-sm font-medium">{e.aluno_nome || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{e.aluno_id}</TableCell>
                <TableCell className="text-sm">{e.unidade}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {rotuloMesReferencia(e.mes_referencia)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {e.created_by_nome || "—"} · {formatDataHora(e.created_at)}
                </TableCell>
                {podeEditar && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                      title="Remover exceção (volta a cobrar todas as parcelas)"
                      disabled={remover.isPending}
                      onClick={() => remover.mutate(e.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function DetalheDisparo({ log, onClose }: { log: BillingLog | null; onClose: () => void }) {
  const style = log ? (STATUS_STYLE[log.status] ?? STATUS_STYLE.pendente) : null;
  return (
    <Dialog open={!!log} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Detalhe do Disparo
          </DialogTitle>
        </DialogHeader>
        {log && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Campo label="Data e Hora" valor={formatDataHora(log.data_envio)} />
              <Campo
                label="Status"
                valor={
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style?.cls ?? ""}`}
                  >
                    {style?.label}
                  </span>
                }
              />
              <Campo label="Aluno" valor={log.aluno_name || "—"} />
              <Campo label="Responsável" valor={log.responsavel_name || "—"} />
              <Campo label="Telefone" valor={displayPhoneBR(log.telefone) || "—"} />
              <Campo label="Unidade" valor={log.unidade || "—"} />
              <Campo label="Valor" valor={log.valor ? formatBRL(log.valor) : "—"} />
              <Campo label="AlunoID (Sponte)" valor={log.fatura_id || "—"} />
              {log.prazo_lembrete && (
                <Campo
                  label="Prazo do lembrete"
                  valor={
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        PRAZO_STYLE[log.prazo_lembrete]?.cls ?? ""
                      }`}
                    >
                      {PRAZO_STYLE[log.prazo_lembrete]?.label ?? log.prazo_lembrete}
                    </span>
                  }
                />
              )}
            </dl>

            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Conteúdo enviado (prova de cobrança)
              </div>
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">
                {log.message_body || "Conteúdo não registrado para este disparo."}
              </div>
            </div>

            {log.erro_mensagem && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="whitespace-pre-wrap">{log.erro_mensagem}</span>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="gap-1" onClick={onClose}>
                <X className="h-4 w-4" /> Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Campo({ label, valor }: { label: string; valor: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{valor}</dd>
    </div>
  );
}
