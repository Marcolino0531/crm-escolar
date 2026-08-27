import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  Info,
  Loader2,
  Receipt,
  RefreshCw,
  UtensilsCrossed,
} from "lucide-react";
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
import { STATUS_RECARGA_LABEL, formatarBRLRecarga, type StatusRecarga } from "@/lib/cantina";
import {
  efetivarRecargaCantina,
  lancarRecargaNoSponte,
  marcarRecargaLancadaNoBoleto,
  obterJanelaPortalCantina,
  salvarJanelaPortalCantina,
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
  sponte_conta_receber_id: string;
  sponte_vencimento: string | null;
  sponte_erro: string;
  lancada_automatica: boolean;
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

function mmddParaBR(mmdd: string): string {
  const [mes, dia] = mmdd.split("-");
  return `${dia}/${mes}`;
}

function brParaMmdd(br: string): string {
  const [dia, mes] = br.split("/");
  if (!dia || !mes) return "";
  return `${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

// Período do ano em que o portal dos pais aceita pedidos (dia/mês, sem ano:
// vale automaticamente todo ano). A tela da equipe NUNCA é bloqueada por ele.
function JanelaPortalCard({ podeEditar }: { podeEditar: boolean }) {
  const obterJanela = useServerFn(obterJanelaPortalCantina);
  const salvarJanela = useServerFn(salvarJanelaPortalCantina);
  const queryClient = useQueryClient();
  const [abertura, setAbertura] = useState("");
  const [fechamento, setFechamento] = useState("");

  const { data } = useQuery({
    queryKey: ["cantina_portal_janela"],
    queryFn: async () => obterJanela(),
  });

  const salvarMutation = useMutation({
    mutationFn: async () =>
      salvarJanela({
        data: { abertura: brParaMmdd(abertura), fechamento: brParaMmdd(fechamento) },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.erro ?? "Não foi possível salvar o período.");
        return;
      }
      toast.success("Período do portal atualizado.");
      setAbertura("");
      setFechamento("");
      queryClient.invalidateQueries({ queryKey: ["cantina_portal_janela"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;
  const aberturaBR = mmddParaBR(data.janela.abertura);
  const fechamentoBR = mmddParaBR(data.janela.fechamento);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <CalendarOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">
              Portal dos pais: {aberturaBR} a {fechamentoBR}
            </p>
            <p className="text-muted-foreground">
              {data.aberto
                ? "Aberto hoje. Fora desse período o portal mostra aviso de indisponibilidade — esta tela continua liberada."
                : "Fechado hoje (fora do período). Esta tela e o histórico seguem liberados."}
            </p>
          </div>
        </div>
        {podeEditar && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-28"
              placeholder={aberturaBR}
              value={abertura}
              onChange={(e) => setAbertura(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">a</span>
            <Input
              className="w-28"
              placeholder={fechamentoBR}
              value={fechamento}
              onChange={(e) => setFechamento(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!abertura || !fechamento || salvarMutation.isPending}
              onClick={() => salvarMutation.mutate()}
            >
              {salvarMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar período
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Tela interna: a equipe acompanha as solicitações feitas pelos pais no portal
// e marca a recarga física do cartão como efetivada — momento em que o sistema
// cria a cobrança no Sponte (categoria "Cantina", 1 parcela) no vencimento da
// cobrança mensal do aluno no mês seguinte. A cobrança é um TÍTULO PRÓPRIO: a API do Sponte
// não permite acrescentar item a um boleto de mensalidade já emitido.
function CantinaPage() {
  const { canView, canEdit } = usePermissions();
  const { selected, schools } = useSchool();
  const queryClient = useQueryClient();
  const efetivar = useServerFn(efetivarRecargaCantina);
  const lancarSponte = useServerFn(lancarRecargaNoSponte);
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
          "id, unidade, aluno_nome, aluno_turma, valor, status, created_at, efetivada_at, efetivada_por_nome, sponte_conta_receber_id, sponte_vencimento, sponte_erro, lancada_automatica, lancada_at, lancada_por_nome",
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as RecargaRow[];
    },
  });

  // A recarga do cartão é registrada mesmo quando o Sponte falha — o aviso
  // separa os dois fatos, para ninguém achar que a cobrança foi criada.
  const avisarResultado = (res: {
    lancadaNoSponte?: boolean;
    sponteVencimento?: string;
    sponteErro?: string;
  }) => {
    if (res.lancadaNoSponte) {
      toast.success(
        `Recarga efetivada e cobrança criada no Sponte (venc. ${formatarVencimento(res.sponteVencimento ?? null)}).`,
      );
    } else {
      toast.error(
        `Recarga efetivada, mas a cobrança NÃO foi criada no Sponte: ${res.sponteErro ?? "falha desconhecida"}`,
        { duration: 12000 },
      );
    }
    queryClient.invalidateQueries({ queryKey: ["cantina_recargas"] });
    queryClient.invalidateQueries({ queryKey: ["cantina_recargas_pendentes"] });
  };

  const efetivarMutation = useMutation({
    mutationFn: async (id: string) => efetivar({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.erro ?? "Não foi possível efetivar.");
        return;
      }
      avisarResultado(res);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lancarMutation = useMutation({
    mutationFn: async (id: string) => lancarSponte({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.erro ?? "Não foi possível lançar no Sponte.");
        queryClient.invalidateQueries({ queryKey: ["cantina_recargas"] });
        return;
      }
      avisarResultado(res);
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
      toast.success("Lançamento manual registrado.");
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
      return r.aluno_nome.toLowerCase().includes(termo) || r.unidade.toLowerCase().includes(termo);
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
            Pedidos feitos pelos responsáveis no portal, recarga física do cartão e cobrança
            automática no Sponte.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Pendentes de recarga</p>
          <p className="text-2xl font-semibold">{pendentes.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Sem cobrança no Sponte</p>
          <p className="text-2xl font-semibold">{aLancar.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Valor sem cobrança lançada</p>
          <p className="text-2xl font-semibold">
            {formatarBRLRecarga(aLancar.reduce((s, r) => s + Number(r.valor), 0))}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Ao marcar “Recarga efetivada”, o sistema cria a cobrança no Sponte (categoria{" "}
          <strong>Cantina</strong>, 1 parcela) no mesmo vencimento da cobrança mensal do aluno no
          mês seguinte — o dia dele no Sponte (5, 10, 12…), não um dia fixo. É um{" "}
          <strong>boleto próprio</strong> da recarga: a API do Sponte não acrescenta itens a um
          boleto de mensalidade já emitido.
        </span>
      </div>

      <JanelaPortalCard podeEditar={podeEditar} />

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
                <TableHead>Cobrança no Sponte</TableHead>
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
                        {r.lancada_automatica ? "" : " · manual"}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.status === "lancada_no_boleto" && r.lancada_automatica ? (
                      <span>
                        Conta a receber {r.sponte_conta_receber_id || "sem número"} · venc.{" "}
                        {formatarVencimento(r.sponte_vencimento)}
                      </span>
                    ) : r.status === "lancada_no_boleto" ? (
                      <span className="text-muted-foreground">Lançada à mão pela equipe.</span>
                    ) : r.sponte_erro ? (
                      <span className="flex items-start gap-1 text-amber-700">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {r.sponte_erro}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
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
                    {/* Só aparece quando a criação automática falhou: repetir ou,
                        se o Sponte estiver recusando, registrar o lançamento manual. */}
                    {podeEditar && r.status === "efetivada" && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          className="gap-2"
                          disabled={lancarMutation.isPending}
                          onClick={() => lancarMutation.mutate(r.id)}
                        >
                          {lancarMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Lançar no Sponte
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          disabled={lancadaMutation.isPending}
                          onClick={() => lancadaMutation.mutate(r.id)}
                        >
                          <Receipt className="h-4 w-4" /> Lancei à mão
                        </Button>
                      </div>
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
