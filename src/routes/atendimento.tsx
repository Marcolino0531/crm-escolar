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
  Archive,
  ArchiveRestore,
  CheckSquare,
  X,
  ImageOff,
  FileText,
  FileX,
  Download,
  MicOff,
  Sparkles,
  ShieldAlert,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { enviarMensagemChat, arquivarConversas } from "@/lib/atendimento.functions";
import { gerarSugestaoResposta, registrarEnvioDaSugestao } from "@/lib/atendimento-ia.functions";
import { competenciaDeIso, contarSugestoesDoMes } from "@/lib/atendimento-ia";
import { displayPhoneBR } from "@/lib/phone";
import { separarPorAba, type AbaAtendimento } from "@/lib/atendimento-archive";
import { agruparPorDia } from "@/lib/atendimento-dias";

export const Route = createFileRoute("/atendimento")({
  head: () => ({ meta: [{ title: "Atendimento — School Hub" }] }),
  component: AtendimentoGate,
});

function AtendimentoGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro_atendimento"))
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
  archived: boolean;
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
  message_type: "text" | "image" | "document" | "audio" | "system";
  media_path: string | null;
  media_mime: string | null;
  media_filename: string | null;
};

// Sugestão de IA viva na tela (nada é enviado sem clique humano).
type Sugestao = {
  id: string | null;
  texto: string;
  sensivel: boolean;
  motivoSensivel: string;
  baseFinanceira: string;
  tokens: number;
};

const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

// Uso do mês do assistente (a API da Anthropic cobra por token processado).
function useUsoIaDoMes(ativo: boolean) {
  return useQuery({
    queryKey: ["atendimento-ia-uso"],
    enabled: ativo,
    queryFn: async () => {
      const desde = new Date(Date.now() - 62 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ai_suggestions" as never)
        .select("gerado_em, tokens_entrada, tokens_saida")
        .gte("gerado_em", desde)
        .limit(2000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as {
        gerado_em: string;
        tokens_entrada: number;
        tokens_saida: number;
      }[];
      const competencia = competenciaDeIso(new Date().toISOString());
      const doMes = rows.filter((r) => competenciaDeIso(r.gerado_em) === competencia);
      return {
        competencia,
        total: contarSugestoesDoMes(rows, competencia),
        tokens: doMes.reduce((s, r) => s + (r.tokens_entrada ?? 0) + (r.tokens_saida ?? 0), 0),
      };
    },
  });
}

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

function AtendimentoPage() {
  const { canEdit } = usePermissions();
  const podeResponder = canEdit("financeiro_atendimento");
  const podeUsarIa = canEdit("financeiro_atendimento_ia");
  const queryClient = useQueryClient();
  const arquivarFn = useServerFn(arquivarConversas);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<AbaAtendimento>("ativas");
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const arquivarMut = useMutation({
    mutationFn: (v: { ids: string[]; archived: boolean }) =>
      arquivarFn({ data: { conversationIds: v.ids, archived: v.archived } }),
    onSuccess: (res, v) => {
      if (res.ok) {
        setSelecionados(new Set());
        setModoSelecao(false);
        void queryClient.invalidateQueries({ queryKey: ["atendimento-conversas"] });
        toast.success(
          v.archived
            ? `${res.count} conversa(s) arquivada(s).`
            : `${res.count} conversa(s) desarquivada(s).`,
        );
      } else {
        toast.error(res.error ?? "Falha ao atualizar as conversas.");
      }
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar as conversas."),
  });

  const alternarArquivo = (ids: string[], archived: boolean) => {
    if (ids.length === 0) return;
    arquivarMut.mutate({ ids, archived });
  };

  const conversasQuery = useQuery({
    queryKey: ["atendimento-conversas"],
    refetchInterval: 15000,
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase
        .from("whatsapp_conversations" as never)
        .select(
          "id, wa_phone, contact_name, aluno_id, aluno_name, responsavel_name, unidade, last_message_at, last_message_preview, last_message_direction, unread_count, archived",
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
  const { ativas, arquivadas } = useMemo(() => separarPorAba(conversas), [conversas]);
  const listaDaAba = aba === "arquivadas" ? arquivadas : ativas;

  const conversasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return listaDaAba;
    return listaDaAba.filter((c) =>
      [c.aluno_name, c.contact_name, c.responsavel_name, c.wa_phone, c.aluno_id ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [listaDaAba, busca]);

  const selecionada = conversas.find((c) => c.id === selecionadaId) ?? null;

  const trocarAba = (nova: AbaAtendimento) => {
    setAba(nova);
    setModoSelecao(false);
    setSelecionados(new Set());
  };

  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
          <div className="space-y-2 border-b border-border p-3">
            {/* Abas Gerais / Arquivadas */}
            <div className="flex rounded-lg bg-muted p-0.5 text-sm">
              <button
                onClick={() => trocarAba("ativas")}
                className={`flex-1 rounded-md px-2 py-1 font-medium transition-colors ${
                  aba === "ativas"
                    ? "bg-card shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Gerais{ativas.length > 0 ? ` (${ativas.length})` : ""}
              </button>
              <button
                onClick={() => trocarAba("arquivadas")}
                className={`flex-1 rounded-md px-2 py-1 font-medium transition-colors ${
                  aba === "arquivadas"
                    ? "bg-card shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Arquivadas{arquivadas.length > 0 ? ` (${arquivadas.length})` : ""}
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por aluno, telefone…"
                className="h-9 pl-8"
              />
            </div>

            {podeResponder &&
              (modoSelecao ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 flex-1 gap-1"
                    disabled={selecionados.size === 0 || arquivarMut.isPending}
                    onClick={() => alternarArquivo(Array.from(selecionados), aba !== "arquivadas")}
                  >
                    {aba === "arquivadas" ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                    {aba === "arquivadas" ? "Desarquivar" : "Arquivar"}
                    {selecionados.size > 0 ? ` (${selecionados.size})` : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1"
                    onClick={() => {
                      setModoSelecao(false);
                      setSelecionados(new Set());
                    }}
                  >
                    <X className="h-4 w-4" /> Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full gap-1"
                  disabled={conversasFiltradas.length === 0}
                  onClick={() => setModoSelecao(true)}
                >
                  <CheckSquare className="h-4 w-4" /> Selecionar
                </Button>
              ))}
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
                <p className="text-sm font-medium">
                  {aba === "arquivadas" ? "Nenhuma conversa arquivada." : "Nenhuma conversa ainda."}
                </p>
                <p className="text-xs text-muted-foreground">
                  {aba === "arquivadas"
                    ? "Conversas arquivadas aparecem aqui e voltam para Gerais ao receber nova mensagem."
                    : "As respostas dos responsáveis aparecerão aqui automaticamente."}
                </p>
              </div>
            ) : (
              conversasFiltradas.map((c) => {
                const marcada = selecionados.has(c.id);
                const handleClick = () => {
                  if (modoSelecao) toggleSelecionado(c.id);
                  else setSelecionadaId(c.id);
                };
                return (
                  <div
                    key={c.id}
                    className={`group flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 transition-colors hover:bg-muted/50 ${
                      c.id === selecionadaId && !modoSelecao ? "bg-muted" : ""
                    } ${marcada ? "bg-primary/5" : ""}`}
                  >
                    {modoSelecao && (
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => toggleSelecionado(c.id)}
                        className="mt-3 h-4 w-4 shrink-0 accent-primary"
                        aria-label="Selecionar conversa"
                      />
                    )}
                    <button
                      onClick={handleClick}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
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
                    {podeResponder && !modoSelecao && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          alternarArquivo([c.id], aba !== "arquivadas");
                        }}
                        disabled={arquivarMut.isPending}
                        title={aba === "arquivadas" ? "Desarquivar" : "Arquivar"}
                        className="mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                      >
                        {aba === "arquivadas" ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={`flex min-h-0 flex-col ${selecionada ? "flex" : "hidden md:flex"}`}>
          {selecionada ? (
            <ThreadConversa
              conversa={selecionada}
              podeResponder={podeResponder}
              podeUsarIa={podeUsarIa}
              onVoltar={() => setSelecionadaId(null)}
              onArquivar={() => alternarArquivo([selecionada.id], !selecionada.archived)}
              arquivando={arquivarMut.isPending}
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
  podeUsarIa,
  onVoltar,
  onArquivar,
  arquivando,
}: {
  conversa: Conversation;
  podeResponder: boolean;
  podeUsarIa: boolean;
  onVoltar: () => void;
  onArquivar: () => void;
  arquivando: boolean;
}) {
  const queryClient = useQueryClient();
  const enviarFn = useServerFn(enviarMensagemChat);
  const registrarEnvioFn = useServerFn(registrarEnvioDaSugestao);
  const [texto, setTexto] = useState("");
  // Sugestão viva na tela e o texto exato que a IA propôs, para saber depois se
  // foi enviada como está ou editada à mão.
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const sugestaoUsadaRef = useRef<{ id: string; texto: string } | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  const mensagensQuery = useQuery({
    queryKey: ["atendimento-mensagens", conversa.id],
    refetchInterval: 10000,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from("whatsapp_messages" as never)
        .select(
          "id, conversation_id, wa_message_id, direction, body, status, erro_mensagem, wa_timestamp, origem, created_at, message_type, media_path, media_mime, media_filename",
        )
        .eq("conversation_id", conversa.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ChatMessage[];
    },
  });

  const mensagens = useMemo(() => mensagensQuery.data ?? [], [mensagensQuery.data]);
  const itens = useMemo(() => agruparPorDia(mensagens, new Date()), [mensagens]);

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

  // Sugestão viva pertence à conversa aberta: trocar de conversa limpa o card.
  useEffect(() => {
    setSugestao(null);
    sugestaoUsadaRef.current = null;
  }, [conversa.id]);

  const enviar = useMutation({
    mutationFn: (body: string) => enviarFn({ data: { conversationId: conversa.id, body } }),
    onSuccess: (res, body) => {
      if (res.ok) {
        // Fecha o par sugestão/versão-final quando o texto enviado veio de uma
        // sugestão (igual ou editado). Falha aqui não invalida o envio.
        const usada = sugestaoUsadaRef.current;
        if (usada) {
          void registrarEnvioFn({ data: { suggestionId: usada.id, enviado: body } }).catch(
            () => {},
          );
          sugestaoUsadaRef.current = null;
        }
        setSugestao(null);
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
        <div className="min-w-0 flex-1">
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
        {podeResponder && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1"
            disabled={arquivando}
            onClick={onArquivar}
            title={conversa.archived ? "Desarquivar conversa" : "Arquivar conversa"}
          >
            {conversa.archived ? (
              <ArchiveRestore className="h-4 w-4" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {conversa.archived ? "Desarquivar" : "Arquivar"}
            </span>
          </Button>
        )}
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
          itens.map((item) =>
            item.tipo === "divisor" ? (
              <DivisorData key={`dia-${item.dia}`} label={item.label} />
            ) : (
              <Bolha key={item.msg.id} msg={item.msg} />
            ),
          )
        )}
        <div ref={fimRef} />
      </div>

      {podeResponder ? (
        <div className="border-t border-border p-3">
          {podeUsarIa && (
            <CardSugestaoIa
              conversaId={conversa.id}
              sugestao={sugestao}
              onSugestao={setSugestao}
              onUsar={(s) => {
                setTexto(s.texto);
                sugestaoUsadaRef.current = s.id ? { id: s.id, texto: s.texto } : null;
              }}
            />
          )}
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

// Card "Sugestão de resposta (IA)" — modo treinamento: gera um rascunho a partir
// do histórico da conversa e da situação financeira consultada no Sponte na hora,
// e só coloca o texto na caixa de envio quando o operador clica em "Usar esta
// resposta". A IA nunca envia nada por conta própria.
function CardSugestaoIa({
  conversaId,
  sugestao,
  onSugestao,
  onUsar,
}: {
  conversaId: string;
  sugestao: Sugestao | null;
  onSugestao: (s: Sugestao | null) => void;
  onUsar: (s: Sugestao) => void;
}) {
  const queryClient = useQueryClient();
  const gerarFn = useServerFn(gerarSugestaoResposta);
  const uso = useUsoIaDoMes(true);

  const gerar = useMutation({
    mutationFn: () => gerarFn({ data: { conversationId: conversaId } }),
    onSuccess: (res) => {
      if (!res.ok || !res.sugestao) {
        toast.error(res.error ?? "Não foi possível gerar a sugestão.");
        return;
      }
      onSugestao({
        id: res.suggestionId ?? null,
        texto: res.sugestao,
        sensivel: res.sensivel === true,
        motivoSensivel: res.motivoSensivel ?? "",
        baseFinanceira: res.baseFinanceira ?? "",
        tokens: (res.tokens?.entrada ?? 0) + (res.tokens?.saida ?? 0),
      });
      void queryClient.invalidateQueries({ queryKey: ["atendimento-ia-uso"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar a sugestão."),
  });

  return (
    <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700">
          <Sparkles className="h-3.5 w-3.5" /> Sugestão de resposta (IA)
        </span>
        <div className="flex items-center gap-2">
          <Link
            to="/atendimento-ia"
            className="text-[11px] text-violet-700 underline-offset-2 hover:underline"
          >
            Instruções da IA
          </Link>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-violet-300 text-violet-800 hover:bg-violet-100"
            disabled={gerar.isPending}
            onClick={() => gerar.mutate()}
          >
            {gerar.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {gerar.isPending ? "Gerando…" : sugestao ? "Gerar outra" : "Gerar sugestão"}
          </Button>
        </div>
      </div>

      {sugestao ? (
        sugestao.sensivel ? (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <ShieldAlert className="h-4 w-4" /> Assunto sensível, recomendo responder
              pessoalmente.
            </div>
            <p className="mt-1 text-xs text-amber-900">
              Motivo: {sugestao.motivoSensivel}. Nenhum texto foi gerado para este caso.
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="whitespace-pre-wrap rounded-md border border-violet-200 bg-card p-2.5 text-sm">
              {sugestao.texto}
            </div>
            {sugestao.baseFinanceira && (
              <p className="text-[11px] text-muted-foreground">
                Base usada: {sugestao.baseFinanceira}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 gap-1"
                onClick={() => {
                  onUsar(sugestao);
                  toast.success(
                    "Sugestão copiada para o campo de resposta. Revise antes de enviar.",
                  );
                }}
              >
                <ClipboardCheck className="h-3.5 w-3.5" /> Usar esta resposta
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-muted-foreground"
                onClick={() => onSugestao(null)}
              >
                <X className="h-3.5 w-3.5" /> Descartar
              </Button>
            </div>
          </div>
        )
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          A IA lê o histórico desta conversa e consulta as parcelas em aberto no Sponte na hora de
          sugerir. Ela nunca envia nada: o texto só vai para o campo de resposta se você clicar em
          &quot;Usar esta resposta&quot;.
        </p>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">
        Uso pago por token na API da Anthropic — cada geração tem custo, que cresce com o tamanho do
        histórico.
        {uso.data
          ? ` ${uso.data.total} sugestão(ões) em ${uso.data.competencia} · ${uso.data.tokens.toLocaleString("pt-BR")} tokens.`
          : ""}
      </p>
    </div>
  );
}

const STATUS_MSG: Record<ChatMessage["status"], { label: string; icon: typeof Check | null }> = {
  recebido: { label: "", icon: null },
  enviado: { label: "Enviada", icon: Check },
  entregue: { label: "Entregue", icon: CheckCheck },
  lido: { label: "Lida", icon: CheckCheck },
  falha: { label: "Falha", icon: AlertTriangle },
};

// Miniatura de imagem recebida: gera uma signed URL a partir do caminho no
// storage privado (o mesmo mecanismo usado nos anexos de RH) e abre em tamanho
// grande ao clicar. Falha de carregamento cai numa mensagem de erro clara.
function ImagemMensagem({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    void supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error || !data?.signedUrl) setErro(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      ativo = false;
    };
  }, [path]);

  if (erro) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-3 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4" /> Não foi possível carregar esta imagem
      </div>
    );
  }
  if (!url) {
    return <Skeleton className="h-40 w-56 rounded-lg" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={url}
        alt="Imagem recebida"
        loading="lazy"
        onError={() => setErro(true)}
        className="max-h-64 max-w-full cursor-zoom-in rounded-lg object-cover"
      />
    </a>
  );
}

// Card de documento recebido (PDF e genéricos): gera uma signed URL a partir do
// caminho no storage privado e abre/baixa o arquivo ao clicar. Falha de acesso
// cai numa mensagem de erro clara.
function DocumentoMensagem({ path, filename }: { path: string; filename: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    void supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error || !data?.signedUrl) setErro(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      ativo = false;
    };
  }, [path]);

  const nome = filename ?? "Documento";

  if (erro) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-3 text-xs text-muted-foreground">
        <FileX className="h-4 w-4" /> Não foi possível carregar este documento
      </div>
    );
  }
  if (!url) {
    return <Skeleton className="h-14 w-56 rounded-lg" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 hover:bg-muted"
    >
      <FileText className="h-8 w-8 shrink-0 text-red-500" />
      <span className="min-w-0 break-words text-sm font-medium underline-offset-2 hover:underline">
        {nome}
      </span>
    </a>
  );
}

// O navegador reproduz este mime? Sem mime conhecido, tenta tocar de qualquer
// forma (o `onError` do player cobre a recusa).
function navegadorTocaAudio(mime: string | null): boolean {
  const tipo = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (!tipo || typeof document === "undefined") return true;
  const el = document.createElement("audio");
  if (typeof el.canPlayType !== "function") return true;
  // ogg/opus é o formato das mensagens de voz do WhatsApp; o codec precisa entrar
  // na consulta, senão navegadores que só tocam Vorbis respondem "maybe".
  const consulta = tipo === "audio/ogg" ? 'audio/ogg; codecs="opus"' : tipo;
  return el.canPlayType(consulta) !== "";
}

// Player de áudio recebido (mensagem de voz do responsável): gera uma signed URL
// a partir do caminho no storage privado e toca direto no balão, sem download.
// O WhatsApp manda ogg/opus, que Chrome, Firefox e Edge reproduzem nativamente;
// se o navegador não der conta do formato (Safari antigo), o player dá lugar a um
// link de download, em vez de um controle mudo.
function AudioMensagem({ path, mime }: { path: string; mime: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  // Formato recusado pelo navegador: checado no mime antes de montar o player e
  // também no erro de decodificação (o mime da Meta nem sempre é preciso).
  const [semSuporte, setSemSuporte] = useState(() => !navegadorTocaAudio(mime));

  useEffect(() => {
    let ativo = true;
    void supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error || !data?.signedUrl) setErro(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      ativo = false;
    };
  }, [path]);

  if (erro) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-3 text-xs text-muted-foreground">
        <MicOff className="h-4 w-4" /> Não foi possível carregar este áudio
      </div>
    );
  }
  if (!url) {
    return <Skeleton className="h-12 w-56 rounded-lg" />;
  }
  if (semSuporte) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm hover:bg-muted"
      >
        <Download className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="underline-offset-2 hover:underline">
          Baixar áudio (formato não suportado neste navegador)
        </span>
      </a>
    );
  }
  return (
    <audio
      controls
      preload="metadata"
      src={url}
      onError={() => setSemSuporte(true)}
      className="h-11 w-64 max-w-full"
    />
  );
}

// Divisor de data centralizado entre os dias da conversa (estilo WhatsApp).
function DivisorData({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1">
      <div className="rounded-md bg-background px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm">
        {label}
      </div>
    </div>
  );
}

function Bolha({ msg }: { msg: ChatMessage }) {
  // Nota interna de evento administrativo (ex.: troca de número): centralizada e
  // discreta, sem balão de conversa.
  if (msg.message_type === "system") {
    return (
      <div className="flex justify-center">
        <div className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {msg.body} · {horaCurta(msg.wa_timestamp ?? msg.created_at)}
        </div>
      </div>
    );
  }

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
        {msg.message_type === "image" && msg.media_path ? (
          <div className="space-y-1">
            <ImagemMensagem path={msg.media_path} />
            {msg.body && <div className="whitespace-pre-wrap break-words">{msg.body}</div>}
          </div>
        ) : msg.message_type === "image" ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ImageOff className="h-4 w-4" /> {msg.body}
          </div>
        ) : msg.message_type === "document" && msg.media_path ? (
          <div className="space-y-1">
            <DocumentoMensagem path={msg.media_path} filename={msg.media_filename} />
            {msg.body && <div className="whitespace-pre-wrap break-words">{msg.body}</div>}
          </div>
        ) : msg.message_type === "document" ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileX className="h-4 w-4" /> {msg.body}
          </div>
        ) : msg.message_type === "audio" && msg.media_path ? (
          <AudioMensagem path={msg.media_path} mime={msg.media_mime} />
        ) : msg.message_type === "audio" ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MicOff className="h-4 w-4" /> {msg.body}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">{msg.body}</div>
        )}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            out ? "text-emerald-700/70" : "text-muted-foreground"
          }`}
        >
          <span>{horaCurta(msg.wa_timestamp ?? msg.created_at)}</span>
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
