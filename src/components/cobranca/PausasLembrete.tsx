// Números pausados nos lembretes preventivos (aba Lembretes Automáticos).
//
// Pausa manual, sem prazo, a pedido do responsável. Só a régua D-5/D-3/D-0
// consulta esta lista; cobrança de parcela vencida e lembrete de rematrícula
// continuam saindo normalmente para o mesmo número.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Loader2, PlayCircle, Search } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { agruparCandidatos, type Candidato, type LogBusca } from "@/lib/billing-lembrete-pausas";
import { chaveTelefone } from "@/lib/billing-recurrence";
import { displayPhoneBR } from "@/lib/phone";

export type PausaLembreteRow = {
  id: string;
  telefone: string;
  responsavel_nome: string;
  alunos_nomes: string;
  unidade: string;
  nota: string;
  created_at: string;
  created_by_nome: string;
};

const QUERY_KEY = ["lembretes-pausas-manuais"];

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function usePausasLembrete() {
  return useQuery({
    queryKey: QUERY_KEY,
    refetchInterval: 60000,
    queryFn: async (): Promise<PausaLembreteRow[]> => {
      const { data, error } = await supabase
        .from("whatsapp_lembrete_pausas" as never)
        .select(
          "id, telefone, responsavel_nome, alunos_nomes, unidade, nota, created_at, created_by_nome",
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PausaLembreteRow[];
    },
  });
}

export function PausasLembrete({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { data: pausas = [], isLoading } = usePausasLembrete();

  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [selecionado, setSelecionado] = useState<Candidato | null>(null);
  const [nota, setNota] = useState("");

  const { data: candidatos = [], isFetching: buscando } = useQuery({
    queryKey: ["lembretes-pausas-busca", termo],
    enabled: termo.trim().length >= 3,
    queryFn: async (): Promise<Candidato[]> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão inválida — faça login novamente.");
      const buscar = async (tipo: string) => {
        const params = new URLSearchParams({ q: termo.trim(), per_page: "100", tipo });
        const resp = await fetch(`/api/cobrancas/logs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await resp.json()) as { ok: boolean; data?: LogBusca[]; error?: string };
        if (!resp.ok || !body.ok) throw new Error(body.error ?? "Falha na busca.");
        return body.data ?? [];
      };
      const [lembretes, cobrancas] = await Promise.all([buscar("lembrete"), buscar("cobranca")]);
      return agruparCandidatos([...lembretes, ...cobrancas]);
    },
  });

  const chavesPausadas = new Set(pausas.map((p) => chaveTelefone(p.telefone)));
  const digitosBusca = termo.replace(/\D/g, "");
  const telefoneAvulso =
    digitosBusca.length >= 10 &&
    !candidatos.some((c) => chaveTelefone(c.telefone) === chaveTelefone(digitosBusca))
      ? digitosBusca
      : null;

  const pausar = useMutation({
    mutationFn: async (c: Candidato) => {
      const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
      const { error } = await supabase.from("whatsapp_lembrete_pausas" as never).insert({
        telefone: c.telefone,
        responsavel_nome: c.responsavel,
        alunos_nomes: c.alunos.join(", "),
        unidade: c.unidade,
        nota: nota.trim(),
        created_by: session?.user?.id ?? null,
        created_by_nome: meta?.full_name || session?.user?.email || "",
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Número pausado — não recebe mais o lembrete preventivo.");
      setSelecionado(null);
      setNota("");
      setBusca("");
      setTermo("");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao pausar."),
  });

  const reativar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("whatsapp_lembrete_pausas" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Número reativado — volta a receber o lembrete preventivo.");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao reativar."),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <h2 className="text-base font-semibold">Números pausados nos lembretes</h2>
          <p className="text-xs text-muted-foreground">
            A pedido do responsável, o número deixa de receber o aviso antecipado de vencimento
            (D-5/D-3/D-0), sem prazo, até ser reativado aqui. Vale só para esta aba: cobrança de
            parcela vencida, lembrete de rematrícula e demais mensagens continuam normalmente.
          </p>
        </div>
      </div>

      {podeEditar && (
        <div className="space-y-3 border-b border-border px-4 py-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSelecionado(null);
              setTermo(busca);
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por responsável, telefone ou aluno para pausar…"
                className="pl-8"
              />
            </div>
            <Button type="submit" variant="outline" disabled={busca.trim().length < 3}>
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
            </Button>
          </form>

          {termo.trim().length >= 3 && !buscando && (
            <div className="rounded-lg border border-border">
              {candidatos.length === 0 && !telefoneAvulso ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  Nenhum responsável com esse nome/telefone/aluno no histórico de disparos. Para
                  pausar um número que ainda não recebeu mensagem, digite o telefone completo com
                  DDD.
                </div>
              ) : (
                <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                  {telefoneAvulso && (
                    <CandidatoItem
                      c={{ telefone: telefoneAvulso, responsavel: "", alunos: [], unidade: "" }}
                      jaPausado={chavesPausadas.has(chaveTelefone(telefoneAvulso))}
                      ativo={selecionado?.telefone === telefoneAvulso}
                      onSelect={setSelecionado}
                      rotulo="Número informado (sem histórico)"
                    />
                  )}
                  {candidatos.map((c) => (
                    <CandidatoItem
                      key={c.telefone}
                      c={c}
                      jaPausado={chavesPausadas.has(chaveTelefone(c.telefone))}
                      ativo={selecionado?.telefone === c.telefone}
                      onSelect={setSelecionado}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {selecionado && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm">
                Pausar <strong>{selecionado.responsavel || "responsável sem nome"}</strong> ·{" "}
                {displayPhoneBR(selecionado.telefone)}
                {selecionado.alunos.length > 0 && (
                  <span className="text-muted-foreground"> · {selecionado.alunos.join(", ")}</span>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="nota-pausa" className="text-xs">
                  Nota (opcional)
                </Label>
                <Input
                  id="nota-pausa"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder='ex.: "solicitado pelo responsável via WhatsApp em 04/09"'
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => pausar.mutate(selecionado)}
                  disabled={pausar.isPending}
                >
                  {pausar.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BellOff className="h-4 w-4" />
                  )}
                  Pausar lembretes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelecionado(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">Carregando…</div>
      ) : pausas.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum número pausado. Todos os responsáveis com parcela a vencer recebem o lembrete.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Responsável</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Aluno(s)</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Pausado em</TableHead>
              <TableHead>Nota</TableHead>
              {podeEditar && <TableHead className="text-right">Ação</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pausas.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm font-medium">{p.responsavel_nome || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {displayPhoneBR(p.telefone)}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm" title={p.alunos_nomes}>
                  {p.alunos_nomes || "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{p.unidade || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDataHora(p.created_at)}
                  {p.created_by_nome ? ` · por ${p.created_by_nome}` : ""}
                </TableCell>
                <TableCell className="max-w-[260px] truncate text-xs" title={p.nota}>
                  {p.nota || "—"}
                </TableCell>
                {podeEditar && (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reativar.mutate(p.id)}
                      disabled={reativar.isPending}
                    >
                      <PlayCircle className="h-4 w-4" />
                      Reativar
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

function CandidatoItem({
  c,
  jaPausado,
  ativo,
  onSelect,
  rotulo,
}: {
  c: Candidato;
  jaPausado: boolean;
  ativo: boolean;
  onSelect: (c: Candidato) => void;
  rotulo?: string;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={jaPausado}
        onClick={() => onSelect(c)}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
          ativo ? "bg-amber-50" : "hover:bg-muted/50"
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <div className="min-w-0">
          <div className="truncate font-medium">{c.responsavel || rotulo || "—"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {displayPhoneBR(c.telefone)}
            {c.alunos.length > 0 ? ` · ${c.alunos.join(", ")}` : ""}
            {c.unidade ? ` · ${c.unidade}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {jaPausado ? "já pausado" : "selecionar"}
        </span>
      </button>
    </li>
  );
}
