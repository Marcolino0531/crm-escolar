import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  MessageSquare,
  Send,
  Search,
  Inbox,
  User,
  Check,
  CheckCheck,
  AlertTriangle,
  Bot,
} from "lucide-react";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { enviarMensagemChat } from "@/lib/atendimento.functions";
import { displayPhoneBR } from "@/lib/phone";

export const Route = createFileRoute("/atendimento")({
  head: () => ({ meta: [{ title: "Atendimento — School Hub" }] }),
  component: AtendimentoGate,
});

function AtendimentoGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro") || !canView("financeiro_atendimento"))
    return <AccessDenied message="Você não tem permissão para acessar o Atendimento." />;
  return <AtendimentoPage />;
}

type Conversation = {
  id: string;
  wa_phone: string;
  contact_name: string;
  aluno_id: string | null;
  aluno_name: string;
  responsavel_name: string;
  unidade: string;
  last_message_at: string | null;
  last_message_preview: string;
  last_message_direction: "in" | "out";
  unread_count: number;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  wa_message_id: string | null;
  direction: "in" | "out";
  body: string;
  status: "recebido" | "enviado" | "entregue" | "lido" | "falha";
  erro_mensagem: string | null;
  wa_timestamp: string | null;
  origem: "chat" | "cobranca";
  created_at: string;
};

// Rótulo primário da conversa: o responsável (quem escreve pelo WhatsApp).
function nomeResponsavel(c: Conversation): string {
  return c.responsavel_name || c.contact_name || displayPhoneBR(c.wa_phone) || c.wa_phone;
}

function horaCurta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dataHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AtendimentoPage() {
  const { canEdit } = usePermissions();
  const podeResponder = canEdit("financeiro_atendimento");
  const queryClient = useQueryClient();
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const conversasQuery = useQuery({
    queryKey: ["atendimento-conversas"],
    refetchInterval: 15000,
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase
        .from("whatsapp_conversations" as never)
        .select(
          "id, wa_phone, contact_name, aluno_id, aluno_name, responsavel_name, unidade, last_message_at, last_message_preview, last_message_direction, unread_count",
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Conversation[];
    },
  });

  // Realtime: novas mensagens/conversas atualizam a tela sem recarregar.
  useEffect(() => {
    const channel = supabase
      .channel("atendimento-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["atendimento-conversas"] });
        queryClient.invalidateQueries({ queryKey: ["atendimento-mensagens"] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => queryClient.invalidateQueries({ queryKey: ["atendimento-conversas"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const conversas = useMemo(() => conversasQuery.data ?? [], [conversasQuery.data]);
  const conversasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversas;
    return conversas.filter((c) =>
      [c.aluno_name, c.contact_name, c.responsavel_name, c.wa_phone, c.aluno_id ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [conversas, busca]);

  const selecionada = conversas.find((c) => c.id === selecionadaId) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageSquare className="h-6 w-6 text-primary" /> Atendimento
        </h1>
        <p className="text-sm text-muted-foreground">
          Respostas dos responsáveis às cobranças de WhatsApp, em tempo real. Selecione uma conversa
          para ver o histórico e responder.
        </p>
      </div>

      <div className="grid h-[calc(100vh-220px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[320px_1fr]">
        {/* Lista de conversas */}
        <div
          className={`flex min-h-0 flex-col border-border md:border-r ${
            selecionada ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por aluno, telefone…"
                className="h-9 pl-8"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversasQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : conversasFiltradas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Nenhuma conversa ainda.</p>
                <p className="text-xs text-muted-foreground">
                  As respostas dos responsáveis aparecerão aqui automaticamente.
                </p>
              </div>
            ) : (
              conversasFiltradas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelecionadaId(c.id)}
                  className={`flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted/50 ${
                    c.id === selecionadaId ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {nomeResponsavel(c)}
                        {c.aluno_name && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {" "}
                            (aluno: {c.aluno_name})
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {horaCurta(c.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {c.last_message_direction === "out" ? "Você: " : ""}
                        {c.last_message_preview || "—"}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={`flex min-h-0 flex-col ${selecionada ? "flex" : "hidden md:flex"}`}>
          {selecionada ? (
            <ThreadConversa
              conversa={selecionada}
              podeResponder={podeResponder}
              onVoltar={() => setSelecionadaId(null)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm">Selecione uma conversa para ver as mensagens.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadConversa({
  conversa,
  podeResponder,
  onVoltar,
}: {
  conversa: Conversation;
  podeResponder: boolean;
  onVoltar: () => void;
}) {
  const queryClient = useQueryClient();
  const enviarFn = useServerFn(enviarMensagemChat);
  const [texto, setTexto] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  const mensagensQuery = useQuery({
    queryKey: ["atendimento-mensagens", conversa.id],
    refetchInterval: 10000,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from("whatsapp_messages" as never)
        .select(
          "id, conversation_id, wa_message_id, direction, body, status, erro_mensagem, wa_timestamp, origem, created_at",
        )
        .eq("conversation_id", conversa.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ChatMessage[];
    },
  });

  const mensagens = useMemo(() => mensagensQuery.data ?? [], [mensagensQuery.data]);

  // Marca como lida ao abrir a conversa (zera o contador de não-lidas).
  useEffect(() => {
    if (conversa.unread_count > 0) {
      void supabase
        .from("whatsapp_conversations" as never)
        .update({ unread_count: 0 } as never)
        .eq("id", conversa.id)
        .then(() => queryClient.invalidateQueries({ queryKey: ["atendimento-conversas"] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversa.id]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length]);

  const enviar = useMutation({
    mutationFn: (body: string) => enviarFn({ data: { conversationId: conversa.id, body } }),
    onSuccess: (res) => {
      if (res.ok) {
        setTexto("");
        queryClient.invalidateQueries({ queryKey: ["atendimento-mensagens", conversa.id] });
        queryClient.invalidateQueries({ queryKey: ["atendimento-conversas"] });
      } else {
        toast.error(res.error ?? "Falha ao enviar a mensagem.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao enviar a mensagem."),
  });

  const handleEnviar = () => {
    const body = texto.trim();
    if (!body) return;
    enviar.mutate(body);
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onVoltar}>
          ←
        </Button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {nomeResponsavel(conversa)}
            {conversa.aluno_name && (
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                (aluno: {conversa.aluno_name})
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {displayPhoneBR(conversa.wa_phone) || conversa.wa_phone}
            {conversa.aluno_id ? ` · AlunoID ${conversa.aluno_id}` : ""}
            {conversa.unidade ? ` · ${conversa.unidade}` : ""}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
        {mensagensQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-2/3" />
            ))}
          </div>
        ) : mensagens.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhuma mensagem nesta conversa.
          </div>
        ) : (
          mensagens.map((m) => <Bolha key={m.id} msg={m} />)
        )}
        <div ref={fimRef} />
      </div>

      {podeResponder ? (
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleEnviar();
                }
              }}
              placeholder="Digite sua resposta…"
              rows={1}
              className="max-h-32 min-h-[40px] resize-none"
            />
            <Button
              className="h-10 gap-1"
              disabled={!texto.trim() || enviar.isPending}
              onClick={handleEnviar}
            >
              <Send className="h-4 w-4" /> {enviar.isPending ? "Enviando…" : "Enviar"}
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Respostas de texto livre só são entregues dentro da janela de 24h após a última mensagem
            do responsável (regra da Meta).
          </p>
        </div>
      ) : (
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Você não tem permissão para responder nesta conversa.
        </div>
      )}
    </>
  );
}

const STATUS_MSG: Record<ChatMessage["status"], { label: string; icon: typeof Check | null }> = {
  recebido: { label: "", icon: null },
  enviado: { label: "Enviada", icon: Check },
  entregue: { label: "Entregue", icon: CheckCheck },
  lido: { label: "Lida", icon: CheckCheck },
  falha: { label: "Falha", icon: AlertTriangle },
};

function Bolha({ msg }: { msg: ChatMessage }) {
  const out = msg.direction === "out";
  const automatica = msg.origem === "cobranca";
  const st = STATUS_MSG[msg.status];
  const Icon = st.icon;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          out
            ? msg.status === "falha"
              ? "bg-red-100 text-red-800"
              : automatica
                ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200"
                : "bg-emerald-100 text-emerald-950"
            : "bg-card text-foreground"
        }`}
      >
        {automatica && (
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            <Bot className="h-3 w-3" /> Cobrança automática
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            out ? "text-emerald-700/70" : "text-muted-foreground"
          }`}
        >
          <span>{dataHora(msg.wa_timestamp ?? msg.created_at)}</span>
          {out && Icon && (
            <span
              className={`inline-flex items-center gap-0.5 ${
                msg.status === "lido"
                  ? "text-sky-600"
                  : msg.status === "falha"
                    ? "text-red-600"
                    : ""
              }`}
              title={st.label}
            >
              <Icon className="h-3 w-3" />
            </span>
          )}
        </div>
        {msg.status === "falha" && msg.erro_mensagem && (
          <div className="mt-1 text-[10px] text-red-600">{msg.erro_mensagem}</div>
        )}
      </div>
    </div>
  );
}
