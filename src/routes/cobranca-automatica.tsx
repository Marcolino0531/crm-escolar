import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot,
  Send,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  FileText,
  X,
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
import { supabase } from "@/integrations/supabase/client";
import { enviarCobrancaTeste } from "@/lib/sponte.functions";
import { displayPhoneBR } from "@/lib/phone";

export const Route = createFileRoute("/cobranca-automatica")({
  head: () => ({ meta: [{ title: "Cobrança Automática — School Hub" }] }),
  component: CobrancaAutomaticaGate,
});

// Mesma cadeia da Cobrança: macro Financeiro E o submódulo financeiro_cobranca.
function CobrancaAutomaticaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro") || !canView("financeiro_cobranca"))
    return <AccessDenied message="Você não tem permissão para acessar a Cobrança Automática." />;
  return <CobrancaAutomaticaPage />;
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

function CobrancaAutomaticaPage() {
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
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot className="h-6 w-6 text-primary" /> Cobrança Automática
        </h1>
        <p className="text-sm text-muted-foreground">
          Auditoria dos disparos de cobrança via WhatsApp (Cloud API da Meta): teste manual,
          histórico completo e rastreamento de status (enviada → entregue → lida).
        </p>
      </div>

      {podeEditar && <AmbienteDeTeste onEnviado={() => refetch()} />}

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
