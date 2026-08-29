import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, Database, Loader2, Send } from "lucide-react";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { dividirResposta } from "@/lib/financeiro-ia";
import { perguntarAnaliseFinanceira, type AnaliseResult } from "@/lib/financeiro-ia.functions";

export const Route = createFileRoute("/analises-ia")({
  head: () => ({ meta: [{ title: "Análises com IA — School Hub" }] }),
  component: AnalisesIaGate,
});

function AnalisesIaGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("financeiro"))
    return (
      <AccessDenied message="Você não tem permissão para acessar as Análises com IA do Financeiro." />
    );
  return <AnalisesIaPage />;
}

const EXEMPLOS = [
  "Por que o saldo projetado de agosto ficou negativo?",
  "Quais despesas aparecem todo mês mas não estão cadastradas como recorrentes?",
  "Faça um resumo do fechamento de agosto da unidade CEC.",
  "Como está a inadimplência do último trimestre por unidade?",
  "Quantos alunos já confirmaram a rematrícula e qual parcelamento escolheram?",
  "Quanto foi repassado aos parceiros dos esportes nos últimos três meses?",
  "Quais peças de uniforme estão abaixo do estoque mínimo?",
];

function Resposta({ texto }: { texto: string }) {
  return (
    <div className="space-y-4">
      {dividirResposta(texto).map((bloco, i) =>
        bloco.tipo === "texto" ? (
          <p key={i} className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
            {bloco.texto}
          </p>
        ) : (
          <div key={i} className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {bloco.cabecalho.map((c, j) => (
                    <th key={j} className="px-3 py-2 text-left font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bloco.linhas.map((linha, j) => (
                  <tr key={j} className="border-t">
                    {linha.map((celula, k) => (
                      <td key={k} className="px-3 py-2">
                        {celula}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
}

function Fontes({ ferramentas }: { ferramentas: AnaliseResult["ferramentas"] }) {
  if (ferramentas.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Database className="h-3.5 w-3.5" />
        Consultas executadas nesta resposta
      </p>
      <ul className="space-y-2">
        {ferramentas.map((f, i) => (
          <li key={i} className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{f.nome}</span>
            {f.erro ? (
              <span className="text-destructive"> — {f.erro}</span>
            ) : (
              <>
                {" — "}
                {f.fonte}
                {Object.keys(f.filtros).length > 0 && (
                  <span className="block">
                    {Object.entries(f.filtros)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalisesIaPage() {
  const [pergunta, setPergunta] = useState("");
  const [resultado, setResultado] = useState<AnaliseResult | null>(null);
  const perguntarFn = useServerFn(perguntarAnaliseFinanceira);

  const analise = useMutation({
    mutationFn: (texto: string) => perguntarFn({ data: { pergunta: texto } }),
    onSuccess: (r) => setResultado(r),
    onError: (e: unknown) =>
      setResultado({
        ok: false,
        resposta: "",
        ferramentas: [],
        erro: e instanceof Error ? e.message : "Falha ao consultar a análise.",
      }),
  });

  const podeEnviar = pergunta.trim().length >= 5 && !analise.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <BrainCircuit className="h-6 w-6 text-primary" />
          Análises com IA
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pergunte em português sobre despesas, receitas, recorrências, inadimplência e saldo
          projetado. A resposta é montada a partir de consultas reais ao Fluxo Futuro e ao Sponte —
          nunca de conhecimento genérico — e não tem acesso a dados cadastrais de alunos ou
          responsáveis.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <Textarea
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Ex.: por que o saldo projetado de agosto ficou negativo?"
          rows={3}
          disabled={analise.isPending}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {EXEMPLOS.map((exemplo) => (
              <button
                key={exemplo}
                type="button"
                onClick={() => setPergunta(exemplo)}
                disabled={analise.isPending}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {exemplo}
              </button>
            ))}
          </div>
          <Button
            onClick={() => analise.mutate(pergunta.trim())}
            disabled={!podeEnviar}
            className="gap-2"
          >
            {analise.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {analise.isPending ? "Consultando…" : "Analisar"}
          </Button>
        </div>
      </div>

      {analise.isPending && (
        <p className="text-sm text-muted-foreground">
          Executando as consultas no Fluxo Futuro e no Sponte… as consultas ao Sponte podem levar
          alguns segundos.
        </p>
      )}

      {resultado && !analise.isPending && (
        <div className="space-y-4">
          {resultado.erro && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {resultado.erro}
            </div>
          )}
          {resultado.ok && (
            <div className="rounded-lg border p-4">
              <Resposta texto={resultado.resposta} />
            </div>
          )}
          <Fontes ferramentas={resultado.ferramentas} />
        </div>
      )}
    </div>
  );
}
