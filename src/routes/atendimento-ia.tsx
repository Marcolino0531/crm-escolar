import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Save, RotateCcw, MessageSquare } from "lucide-react";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { salvarInstrucoesIA } from "@/lib/atendimento-ia.functions";
import {
  LABEL_SITUACAO,
  PROMPT_PADRAO,
  competenciaDeIso,
  contarSugestoesDoMes,
  type SituacaoAtendimento,
} from "@/lib/atendimento-ia";

export const Route = createFileRoute("/atendimento-ia")({
  head: () => ({ meta: [{ title: "Instruções da IA — School Hub" }] }),
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
          <Sparkles className="h-6 w-6 text-primary" /> Instruções da IA de Atendimento
        </h1>
        <p className="text-sm text-muted-foreground">
          Regras gerais que a IA segue ao sugerir respostas no{" "}
          <Link to="/atendimento" className="underline underline-offset-2">
            Atendimento
          </Link>
          . Modo treinamento: a IA apenas sugere — o envio continua sendo manual, sempre.
        </p>
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-xs text-violet-900">
        <p className="font-semibold">Instruções da IA (esta tela)</p>
        <p>
          Política e tom que valem para toda sugestão: como falar, o que nunca prometer, como
          explicar o desconto de pontualidade. É a regra.
        </p>
        <p className="mt-2 font-semibold">Situação financeira (automática)</p>
        <p>
          A cada sugestão o sistema consulta as parcelas em aberto do aluno no Sponte e entrega
          esses números à IA, que está proibida de citar valor ou data que não venha dessa consulta.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">System prompt</span>
          {configQuery.data?.updated_at && (
            <span className="text-[11px] text-muted-foreground">
              Última alteração: {dataHora(configQuery.data.updated_at)}
              {configQuery.data.updated_by_nome ? ` por ${configQuery.data.updated_by_nome}` : ""}
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
              <Save className="h-4 w-4" /> {salvar.isPending ? "Salvando…" : "Salvar instruções"}
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
            {doMes} em {competencia} · {tokensMes.toLocaleString("pt-BR")} tokens no mês (API paga
            por token)
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
                        r.editado ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"
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
    </div>
  );
}
