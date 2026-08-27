import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Receipt, UtensilsCrossed } from "lucide-react";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { usePermissions, useSchool } from "@/lib/app-context";
import { unidadeDaSelecao } from "@/lib/esportes-unidades";
import { supabase } from "@/integrations/supabase/client";
import {
  STATUS_RECARGA_LABEL,
  formatarBRLRecarga,
  indicacaoLancamentoManual,
  type StatusRecarga,
} from "@/lib/cantina";
import {
  efetivarRecargaCantina,
  marcarRecargaLancadaNoBoleto,
} from "@/lib/cantina.functions";

export const Route = createFileRoute("/cantina")({
  component: CantinaPage,
});

interface RecargaRow {
  id: string;
  unidade: string;
  aluno_nome: string;
  aluno_turma: string;
  valor: number;
  status: StatusRecarga;
  created_at: string;
  efetivada_at: string | null;
  efetivada_por_nome: string;
  boleto_numero: string;
  boleto_vencimento: string | null;
  boleto_indisponivel: boolean;
  lancada_at: string | null;
  lancada_por_nome: string;
}

function formatarDataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatarVencimento(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// Tela interna: a equipe acompanha as solicitações feitas pelos pais no portal,
// marca a recarga física do cartão como efetivada e vê a INDICAÇÃO MANUAL do
// valor a incluir no próximo boleto (o lançamento no Sponte é feito à mão — a
// API não permite acrescentar item a boleto já emitido).
function CantinaPage() {
  const { canView, canEdit } = usePermissions();
  const { selected, schools } = useSchool();
  const queryClient = useQueryClient();
  const efetivar = useServerFn(efetivarRecargaCantina);
  const marcarLancada = useServerFn(marcarRecargaLancadaNoBoleto);

  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusRecarga>("todos");
  const [busca, setBusca] = useState("");

  const { data: recargas = [], isLoading } = useQuery({
    queryKey: ["cantina_recargas"],
    enabled: canView("cantina"),
    queryFn: async (): Promise<RecargaRow[]> => {
      const { data, error } = await supabase
        .from("cantina_recargas" as never)
        .select(
          "id, unidade, aluno_nome, aluno_turma, valor, status, created_at, efetivada_at, efetivada_por_nome, boleto_numero, boleto_vencimento, boleto_indisponivel, lancada_at, lancada_por_nome",
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as RecargaRow[];
    },
  });

  const efetivarMutation = useMutation({
    mutationFn: async (id: string) => efetivar({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.erro ?? "Não foi possível efetivar.");
        return;
      }
      toast.success(
        res.boletoIndisponivel
          ? "Recarga efetivada. Nenhum boleto em aberto encontrado — inclua o valor manualmente no próximo."
          : `Recarga efetivada. Inclua o valor no boleto ${res.boletoNumero || "—"} (venc. ${formatarVencimento(res.boletoVencimento ?? null)}).`,
      );
      queryClient.invalidateQueries({ queryKey: ["cantina_recargas"] });
      queryClient.invalidateQueries({ queryKey: ["cantina_recargas_pendentes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lancadaMutation = useMutation({
    mutationFn: async (id: string) => marcarLancada({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.erro ?? "Não foi possível registrar o lançamento.");
        return;
      }
      toast.success("Lançamento no boleto registrado.");
      queryClient.invalidateQueries({ queryKey: ["cantina_recargas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Isolamento por unidade: com uma unidade selecionada no topo só aparecem as
  // solicitações dela; em "Todas as Unidades" ficam as unidades permitidas ao
  // usuário (a lista de escolas já vem escopada pelas permissões).
  const unidadeAtiva = useMemo(() => unidadeDaSelecao(selected, schools), [selected, schools]);

  const daUnidade = useMemo(() => {
    const permitidas = new Set(schools.map((s) => s.name));
    return recargas.filter((r) =>
      unidadeAtiva ? r.unidade === unidadeAtiva : permitidas.has(r.unidade),
    );
  }, [recargas, schools, unidadeAtiva]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return daUnidade.filter((r) => {
      if (filtroStatus !== "todos" && r.status !== filtroStatus) return false;
      if (!termo) return true;
      return (
        r.aluno_nome.toLowerCase().includes(termo) || r.unidade.toLowerCase().includes(termo)
      );
    });
  }, [daUnidade, filtroStatus, busca]);

  const pendentes = daUnidade.filter((r) => r.status === "pendente");
  const aLancar = daUnidade.filter((r) => r.status === "efetivada");
  const podeEditar = canEdit("cantina");

  if (!canView("cantina")) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Cantina — Solicitações de recarga</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos feitos pelos responsáveis no portal, recarga física do cartão e valor a
            incluir no boleto.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Pendentes de recarga</p>
          <p className="text-2xl font-semibold">{pendentes.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">A lançar no boleto</p>
          <p className="text-2xl font-semibold">{aLancar.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Valor pendente de lançamento</p>
          <p className="text-2xl font-semibold">
            {formatarBRLRecarga(aLancar.reduce((s, r) => s + Number(r.valor), 0))}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          O lançamento no boleto é <strong>manual</strong>: a API do Sponte não permite
          acrescentar um item a um boleto de mensalidade já emitido. Ao efetivar a recarga, a
          tela indica em qual boleto incluir o valor.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por aluno ou unidade"
          className="max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select
          value={filtroStatus}
          onValueChange={(v) => setFiltroStatus(v as "todos" | StatusRecarga)}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="pendente">{STATUS_RECARGA_LABEL.pendente}</SelectItem>
            <SelectItem value="efetivada">{STATUS_RECARGA_LABEL.efetivada}</SelectItem>
            <SelectItem value="lancada_no_boleto">
              {STATUS_RECARGA_LABEL.lancada_no_boleto}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Boleto (lançamento manual)</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Nenhuma solicitação encontrada.
                  </TableCell>
                </TableRow>
              )}
              {filtradas.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatarDataHora(r.created_at)}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{r.aluno_nome}</p>
                    {r.aluno_turma && (
                      <p className="text-xs text-muted-foreground">{r.aluno_turma}</p>
                    )}
                  </TableCell>
                  <TableCell>{r.unidade}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatarBRLRecarga(Number(r.valor))}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{STATUS_RECARGA_LABEL[r.status]}</span>
                    {r.efetivada_at && (
                      <p className="text-xs text-muted-foreground">
                        Recarga: {formatarDataHora(r.efetivada_at)}
                        {r.efetivada_por_nome ? ` · ${r.efetivada_por_nome}` : ""}
                      </p>
                    )}
                    {r.lancada_at && (
                      <p className="text-xs text-muted-foreground">
                        Lançado: {formatarDataHora(r.lancada_at)}
                        {r.lancada_por_nome ? ` · ${r.lancada_por_nome}` : ""}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.status === "pendente" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={r.boleto_indisponivel ? "text-amber-700" : undefined}>
                        {indicacaoLancamentoManual(
                          Number(r.valor),
                          r.boleto_indisponivel || !r.boleto_vencimento
                            ? null
                            : {
                                numeroBoleto: r.boleto_numero,
                                vencimento: r.boleto_vencimento.slice(0, 10),
                              },
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {podeEditar && r.status === "pendente" && (
                      <Button
                        size="sm"
                        className="gap-2"
                        disabled={efetivarMutation.isPending}
                        onClick={() => efetivarMutation.mutate(r.id)}
                      >
                        {efetivarMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Recarga efetivada
                      </Button>
                    )}
                    {podeEditar && r.status === "efetivada" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={lancadaMutation.isPending}
                        onClick={() => lancadaMutation.mutate(r.id)}
                      >
                        <Receipt className="h-4 w-4" /> Lancei no boleto
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
