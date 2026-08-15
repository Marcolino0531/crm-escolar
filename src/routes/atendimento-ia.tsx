import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Save, RotateCcw, MessageSquare, BookMarked, Trash2, Power } from "lucide-react";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { salvarInstrucoesIA } from "@/lib/atendimento-ia.functions";
import {
  atualizarExemploTreinamento,
  removerExemploTreinamento,
} from "@/lib/atendimento-ia-exemplos.functions";
import { MAX_EXEMPLOS_CONTEXTO } from "@/lib/atendimento-ia-exemplos";
import {
  LABEL_SITUACAO,
  PROMPT_PADRAO,
  competenciaDeIso,
  contarSugestoesDoMes,
  type SituacaoAtendimento,
} from "@/lib/atendimento-ia";

export const Route = createFileRoute("/atendimento-ia")({
  head: () => ({ meta: [{ title: "Assistente de IA — School Hub" }] }),
  component: InstrucoesIaGate,
});

function InstrucoesIaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro_atendimento_ia"))
    return (
      <AccessDenied message="Você não tem permissão para acessar o assistente de IA do Atendimento." />
    );
  return <InstrucoesIaPage />;
}

type SugestaoRegistro = {
  id: string;
  gerado_em: string;
  situacao: string;
  sensivel: boolean;
  sugestao: string;
  contexto_resumo: string;
  enviado_body: string | null;
  editado: boolean;
  tokens_entrada: number;
  tokens_saida: number;
};

function dataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function rotuloSituacao(valor: string): string {
  return LABEL_SITUACAO[valor as SituacaoAtendimento] ?? valor;
}

function InstrucoesIaPage() {
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("financeiro_atendimento_ia");
  const queryClient = useQueryClient();
  const salvarFn = useServerFn(salvarInstrucoesIA);
  const [prompt, setPrompt] = useState("");
  const [carregado, setCarregado] = useState(false);

  const configQuery = useQuery({
    queryKey: ["atendimento-ia-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_atendimento_settings" as never)
        .select("system_prompt, updated_at, updated_by_nome")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as {
        system_prompt: string;
        updated_at: string;
        updated_by_nome: string;
      } | null;
    },
  });

  // Carrega o texto salvo uma vez; edições posteriores do usuário não são
  // sobrescritas pelos refetches.
  useEffect(() => {
    if (carregado || configQuery.isLoading) return;
    setPrompt(configQuery.data?.system_prompt?.trim() || PROMPT_PADRAO);
    setCarregado(true);
  }, [carregado, configQuery.isLoading, configQuery.data]);

  const sugestoesQuery = useQuery({
    queryKey: ["atendimento-ia-registros"],
    queryFn: async (): Promise<SugestaoRegistro[]> => {
      const { data, error } = await supabase
        .from("ai_suggestions" as never)
        .select(
          "id, gerado_em, situacao, sensivel, sugestao, contexto_resumo, enviado_body, editado, tokens_entrada, tokens_saida",
        )
        .order("gerado_em", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SugestaoRegistro[];
    },
  });

  const salvar = useMutation({
    mutationFn: (systemPrompt: string) => salvarFn({ data: { systemPrompt } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Instruções da IA salvas. Valem a partir da próxima sugestão.");
        void queryClient.invalidateQueries({ queryKey: ["atendimento-ia-config"] });
      } else {
        toast.error(res.error ?? "Falha ao salvar as instruções.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar as instruções."),
  });

  const registros = sugestoesQuery.data ?? [];
  const competencia = competenciaDeIso(new Date().toISOString());
  const doMes = contarSugestoesDoMes(registros, competencia);
  const tokensMes = registros
    .filter((r) => competenciaDeIso(r.gerado_em) === competencia)
    .reduce((s, r) => s + (r.tokens_entrada ?? 0) + (r.tokens_saida ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-primary" /> Assistente de IA do Atendimento
        </h1>
        <p className="text-sm text-muted-foreground">
          Como a IA se comporta ao sugerir respostas no{" "}
          <Link to="/atendimento" className="underline underline-offset-2">
            Atendimento
          </Link>
          . Modo treinamento: a IA apenas sugere — o envio continua sendo manual, sempre.
        </p>
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-xs text-violet-900">
        <p className="font-semibold">Instruções da IA — a regra</p>
        <p>
          Política e tom que valem para toda sugestão: como falar, o que nunca prometer, como
          explicar o desconto de pontualidade.
        </p>
        <p className="mt-2 font-semibold">Exemplos de Treinamento — o exemplo prático</p>
        <p>
          Casos reais que você salvou: o que a IA sugeriu e o que a escola de fato enviou. Em cada
          nova sugestão, até {MAX_EXEMPLOS_CONTEXTO} exemplos parecidos com a situação entram no
          contexto como referência de estilo — nunca como fonte de valores.
        </p>
        <p className="mt-2 font-semibold">Situação financeira — automática</p>
        <p>
          A cada sugestão o sistema consulta as parcelas em aberto do aluno no Sponte e entrega
          esses números à IA, que está proibida de citar valor ou data que não venha dessa consulta.
        </p>
      </div>

      <Tabs defaultValue="instrucoes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="instrucoes" className="gap-1.5">
            <Sparkles className="h-4 w-4" /> Instruções da IA
          </TabsTrigger>
          <TabsTrigger value="exemplos" className="gap-1.5">
            <BookMarked className="h-4 w-4" /> Exemplos de Treinamento
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instrucoes" className="space-y-6">
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">System prompt</span>
              {configQuery.data?.updated_at && (
                <span className="text-[11px] text-muted-foreground">
                  Última alteração: {dataHora(configQuery.data.updated_at)}
                  {configQuery.data.updated_by_nome
                    ? ` por ${configQuery.data.updated_by_nome}`
                    : ""}
                </span>
              )}
            </div>
            {configQuery.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={!podeEditar}
                rows={18}
                className="font-mono text-xs"
              />
            )}
            {podeEditar ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="gap-1"
                  disabled={salvar.isPending || prompt.trim().length < 20}
                  onClick={() => salvar.mutate(prompt.trim())}
                >
                  <Save className="h-4 w-4" />{" "}
                  {salvar.isPending ? "Salvando…" : "Salvar instruções"}
                </Button>
                <Button
                  variant="outline"
                  className="gap-1"
                  disabled={salvar.isPending}
                  onClick={() => setPrompt(PROMPT_PADRAO)}
                >
                  <RotateCcw className="h-4 w-4" /> Restaurar texto padrão
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Alterações valem da próxima sugestão em diante; sugestões já geradas não mudam.
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Você tem acesso de leitura: só quem tem permissão de edição no assistente de IA pode
                alterar as instruções.
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-muted-foreground" /> Sugestões geradas
              </span>
              <span className="text-[11px] text-muted-foreground">
                {doMes} em {competencia} · {tokensMes.toLocaleString("pt-BR")} tokens no mês (API
                paga por token)
              </span>
            </div>

            {sugestoesQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : registros.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma sugestão gerada ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {registros.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border/70 p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{dataHora(r.gerado_em)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {rotuloSituacao(r.situacao)}
                      </span>
                      {r.sensivel && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                          assunto sensível
                        </span>
                      )}
                      {r.enviado_body ? (
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            r.editado
                              ? "bg-sky-100 text-sky-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {r.editado ? "enviada com edição" : "enviada como sugerida"}
                        </span>
                      ) : (
                        <span className="rounded bg-muted px-1.5 py-0.5">não enviada</span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{r.contexto_resumo}</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          Sugestão da IA
                        </p>
                        <p className="whitespace-pre-wrap rounded bg-muted/50 p-2">{r.sugestao}</p>
                      </div>
                      {r.enviado_body && (
                        <div>
                          <p className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            Versão enviada
                          </p>
                          <p className="whitespace-pre-wrap rounded bg-emerald-50 p-2">
                            {r.enviado_body}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="exemplos">
          <AbaExemplos podeEditar={podeEditar} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ExemploRegistro = {
  id: string;
  criado_em: string;
  criado_por_nome: string;
  situacao: string;
  contexto: string;
  sugestao_original: string;
  resposta_final: string;
  ativo: boolean;
};

// Biblioteca few-shot: casos reais salvos no Atendimento. Editar aqui muda o que
// a IA vê como referência na próxima sugestão; desativar preserva o histórico sem
// alimentar mais o prompt.
function AbaExemplos({ podeEditar }: { podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const atualizarFn = useServerFn(atualizarExemploTreinamento);
  const removerFn = useServerFn(removerExemploTreinamento);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  const exemplosQuery = useQuery({
    queryKey: ["atendimento-ia-exemplos"],
    queryFn: async (): Promise<ExemploRegistro[]> => {
      const { data, error } = await supabase
        .from("ai_training_examples" as never)
        .select(
          "id, criado_em, criado_por_nome, situacao, contexto, sugestao_original, resposta_final, ativo",
        )
        .order("criado_em", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ExemploRegistro[];
    },
  });

  const invalidar = () =>
    void queryClient.invalidateQueries({ queryKey: ["atendimento-ia-exemplos"] });

  const atualizar = useMutation({
    mutationFn: (input: { id: string; respostaFinal?: string; ativo?: boolean }) =>
      atualizarFn({ data: input }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao atualizar o exemplo.");
        return;
      }
      toast.success("Exemplo atualizado.");
      setEditandoId(null);
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar o exemplo."),
  });

  const remover = useMutation({
    mutationFn: (id: string) => removerFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao remover o exemplo.");
        return;
      }
      toast.success("Exemplo removido.");
      invalidar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover o exemplo."),
  });

  const exemplos = exemplosQuery.data ?? [];
  const ativos = exemplos.filter((e) => e.ativo).length;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BookMarked className="h-4 w-4 text-muted-foreground" /> Exemplos de Treinamento
        </span>
        <span className="text-[11px] text-muted-foreground">
          {ativos} ativo(s) de {exemplos.length} · até {MAX_EXEMPLOS_CONTEXTO} por sugestão
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Salvos por você no Atendimento, depois de reescrever uma sugestão. A escolha dos exemplos de
        cada sugestão é por situação parecida, palavras em comum e, no empate, o mais recente.
      </p>

      {exemplosQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : exemplos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum exemplo salvo ainda. Depois de editar bastante uma sugestão e enviar, o Atendimento
          oferece o botão &quot;Salvar como exemplo de treinamento&quot;.
        </p>
      ) : (
        <div className="space-y-2">
          {exemplos.map((e) => (
            <div
              key={e.id}
              className={`rounded-lg border p-3 text-xs ${
                e.ativo ? "border-border/70" : "border-dashed border-border bg-muted/30 opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{dataHora(e.criado_em)}</span>
                <span className="rounded bg-muted px-1.5 py-0.5">{rotuloSituacao(e.situacao)}</span>
                {!e.ativo && (
                  <span className="rounded bg-muted px-1.5 py-0.5">inativo (fora do prompt)</span>
                )}
                {e.sugestao_original === "" && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">
                    resposta escrita do zero
                  </span>
                )}
                {e.criado_por_nome && <span>por {e.criado_por_nome}</span>}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{e.contexto}</p>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {e.sugestao_original && (
                  <div>
                    <p className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      Sugestão original da IA
                    </p>
                    <p className="whitespace-pre-wrap rounded bg-muted/50 p-2">
                      {e.sugestao_original}
                    </p>
                  </div>
                )}
                <div>
                  <p className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    Resposta enviada (é esta que a IA imita)
                  </p>
                  {editandoId === e.id ? (
                    <Textarea
                      value={rascunho}
                      onChange={(ev) => setRascunho(ev.target.value)}
                      rows={5}
                      className="text-xs"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap rounded bg-emerald-50 p-2">
                      {e.resposta_final}
                    </p>
                  )}
                </div>
              </div>

              {podeEditar && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {editandoId === e.id ? (
                    <>
                      <Button
                        size="sm"
                        className="h-7 gap-1"
                        disabled={atualizar.isPending || rascunho.trim().length === 0}
                        onClick={() =>
                          atualizar.mutate({ id: e.id, respostaFinal: rascunho.trim() })
                        }
                      >
                        <Save className="h-3.5 w-3.5" /> Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => setEditandoId(null)}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => {
                          setEditandoId(e.id);
                          setRascunho(e.resposta_final);
                        }}
                      >
                        Editar resposta
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1"
                        disabled={atualizar.isPending}
                        onClick={() => atualizar.mutate({ id: e.id, ativo: !e.ativo })}
                      >
                        <Power className="h-3.5 w-3.5" /> {e.ativo ? "Desativar" : "Reativar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-destructive hover:text-destructive"
                        disabled={remover.isPending}
                        onClick={() => {
                          if (confirm("Remover este exemplo de treinamento definitivamente?"))
                            remover.mutate(e.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remover
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
