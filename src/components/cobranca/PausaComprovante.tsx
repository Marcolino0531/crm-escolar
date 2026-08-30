// Pausa de 24h por comprovante recebido — ação no Atendimento e painel de
// visibilidade nas Mensagens Automáticas.
//
// A pausa vale para os DOIS disparos automáticos (cobrança de inadimplência e
// lembrete de vencimento) e expira sozinha: a régua volta a valer 24h depois do
// clique, sem nada para religar. Se a baixa entrou no Sponte antes disso, não há
// mais parcela em aberto e nada é disparado.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { chaveTelefone } from "@/lib/billing-recurrence";
import {
  expiracaoPausa,
  HORAS_PAUSA_COMPROVANTE,
  rotuloRestante,
  type PausaComprovante,
} from "@/lib/billing-pauses";
import { displayPhoneBR } from "@/lib/phone";

export type PausaRow = {
  id: string;
  telefone: string;
  aluno_id: string | null;
  aluno_nome: string;
  responsavel_nome: string;
  unidade: string;
  created_at: string;
  expira_em: string;
  created_by_nome: string;
};

const QUERY_KEY = ["cobranca-pausas-comprovante"];

function comoPausa(row: PausaRow): PausaComprovante {
  return { telefone: row.telefone, alunoId: row.aluno_id, expiraEm: row.expira_em };
}

function usePausas() {
  return useQuery({
    queryKey: QUERY_KEY,
    refetchInterval: 60000,
    queryFn: async (): Promise<PausaRow[]> => {
      const { data, error } = await supabase
        .from("whatsapp_billing_pauses" as never)
        .select(
          "id, telefone, aluno_id, aluno_nome, responsavel_nome, unidade, created_at, expira_em, created_by_nome",
        )
        .gt("expira_em", new Date().toISOString())
        .order("expira_em", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PausaRow[];
    },
  });
}

function useCancelarPausa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("whatsapp_billing_pauses" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Pausa cancelada — a cobrança automática volta a valer.");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cancelar a pausa."),
  });
}

function formatExpiracao(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escopoLabel(row: PausaRow): string {
  return row.aluno_id
    ? `somente ${row.aluno_nome || `AlunoID ${row.aluno_id}`}`
    : "todos os filhos do responsável";
}

export interface ConversaPausavel {
  id: string;
  wa_phone: string;
  aluno_id: string | null;
  aluno_name: string;
  responsavel_name: string;
  contact_name: string;
  unidade: string;
}

// Ação rápida na conversa do Atendimento. O escopo é sempre explícito: quando a
// conversa está vinculada a um aluno, a pausa nasce restrita a ele (o irmão em
// aberto continua sendo cobrado) e o atendente pode ampliar para o responsável
// inteiro com um clique.
export function AcaoPausarCobranca({
  conversa,
  podeEditar,
}: {
  conversa: ConversaPausavel;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { data: pausas = [] } = usePausas();
  const cancelar = useCancelarPausa();

  const chave = chaveTelefone(conversa.wa_phone);
  const daConversa = pausas.filter((p) => chaveTelefone(p.telefone) === chave);

  const pausar = useMutation({
    mutationFn: async (escopoAluno: boolean) => {
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error } = await supabase.from("whatsapp_billing_pauses" as never).insert({
        telefone: conversa.wa_phone,
        aluno_id: escopoAluno ? conversa.aluno_id : null,
        aluno_nome: escopoAluno ? conversa.aluno_name : "",
        responsavel_nome: conversa.responsavel_name || conversa.contact_name || "",
        unidade: conversa.unidade || "",
        conversation_id: conversa.id,
        expira_em: expiracaoPausa(new Date()),
        created_by: session?.user?.id ?? null,
        created_by_nome: meta?.full_name || session?.user?.email || "",
      } as never);
      if (error) throw new Error(error.message);
      return escopoAluno;
    },
    onSuccess: (escopoAluno) => {
      toast.success(
        escopoAluno
          ? `Cobrança automática pausada por ${HORAS_PAUSA_COMPROVANTE}h para ${conversa.aluno_name}.`
          : `Cobrança automática pausada por ${HORAS_PAUSA_COMPROVANTE}h para o responsável.`,
      );
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao pausar a cobrança."),
  });

  if (!podeEditar) return null;

  const agora = new Date();
  const pausado = daConversa.length > 0;
  const escopoNovo = conversa.aluno_id
    ? `somente ${conversa.aluno_name || `AlunoID ${conversa.aluno_id}`}`
    : "todos os filhos deste responsável";

  const explicacao = pausado
    ? `Cobrança e lembrete automáticos pausados — ${daConversa
        .map(
          (p) =>
            `escopo: ${escopoLabel(p)}, até ${formatExpiracao(p.expira_em)} (${rotuloRestante(comoPausa(p), agora)})`,
        )
        .join("; ")}. Abra para cancelar a pausa.`
    : `Comprovante recebido — pausar cobrança de inadimplência e lembrete de vencimento por ${HORAS_PAUSA_COMPROVANTE}h. Escopo: ${escopoNovo}.`;

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className={`h-10 w-10 shrink-0 ${pausado ? "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100" : ""}`}
                disabled={pausar.isPending || cancelar.isPending}
                aria-label={explicacao}
                title={explicacao}
              >
                {pausado ? (
                  <PauseCircle className="h-4 w-4" />
                ) : (
                  <ClipboardCheck className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">{explicacao}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent align="start" className="max-w-xs">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {explicacao}
        </DropdownMenuLabel>
        {pausado ? (
          <>
            {daConversa.map((p) => (
              <DropdownMenuItem
                key={p.id}
                disabled={cancelar.isPending}
                onClick={() => cancelar.mutate(p.id)}
              >
                <PlayCircle className="mr-2 h-3.5 w-3.5" /> Cancelar pausa ({escopoLabel(p)})
              </DropdownMenuItem>
            ))}
            {conversa.aluno_id && daConversa.every((p) => p.aluno_id) && (
              <DropdownMenuItem disabled={pausar.isPending} onClick={() => pausar.mutate(false)}>
                <PauseCircle className="mr-2 h-3.5 w-3.5" /> Ampliar para todos os filhos do
                responsável
              </DropdownMenuItem>
            )}
          </>
        ) : (
          <>
            <DropdownMenuItem
              disabled={pausar.isPending}
              onClick={() => pausar.mutate(Boolean(conversa.aluno_id))}
            >
              <ClipboardCheck className="mr-2 h-3.5 w-3.5" /> Pausar {HORAS_PAUSA_COMPROVANTE}h (
              {escopoNovo})
            </DropdownMenuItem>
            {conversa.aluno_id && (
              <DropdownMenuItem disabled={pausar.isPending} onClick={() => pausar.mutate(false)}>
                <PauseCircle className="mr-2 h-3.5 w-3.5" /> Pausar o responsável inteiro
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Painel de visibilidade nas Mensagens Automáticas: quem está pausado e até
// quando, com cancelamento manual.
export function PausasPorComprovante({ podeEditar }: { podeEditar: boolean }) {
  const { data: pausas = [], isError, error } = usePausas();
  const cancelar = useCancelarPausa();
  const agora = new Date();

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck className="h-4 w-4 text-primary" /> Pausas por Comprovante (24h)
        </h2>
        <span className="text-xs text-muted-foreground">
          {pausas.length} responsável(is) com disparo suspenso agora
        </span>
      </div>

      <p className="border-b border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        Criadas no Atendimento quando o responsável envia o comprovante e a baixa ainda não entrou
        no Sponte. Valem para a cobrança de inadimplência <strong>e</strong> para o lembrete de
        vencimento, expiram sozinhas em {HORAS_PAUSA_COMPROVANTE}h e podem ser canceladas aqui. Se a
        parcela já estiver quitada quando a pausa expirar, nada é disparado.
      </p>

      {isError ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4" />
          {error instanceof Error ? error.message : "Falha ao carregar as pausas."}
        </div>
      ) : pausas.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhuma cobrança pausada por comprovante neste momento.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {pausas.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {p.responsavel_nome || displayPhoneBR(p.telefone) || p.telefone}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {displayPhoneBR(p.telefone)}
                    {p.unidade ? ` · ${p.unidade}` : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Escopo: {escopoLabel(p)} · até {formatExpiracao(p.expira_em)} (
                  {rotuloRestante(comoPausa(p), agora)})
                  {p.created_by_nome ? ` · por ${p.created_by_nome}` : ""}
                </div>
              </div>
              {podeEditar && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={cancelar.isPending}
                  onClick={() => cancelar.mutate(p.id)}
                >
                  <PlayCircle className="h-3.5 w-3.5" /> Cancelar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
