import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  Shirt,
  AlertTriangle,
  PackageSearch,
  Search,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { usePermissions, useSchool } from "@/lib/app-context";
import {
  storeKeyForUnitName,
  abaixoDoEstoqueMinimo,
  motivoForaDaReposicao,
  notificaEstoqueBaixo,
  type StoreKey,
} from "@/lib/nuvemshop.stores";
import { AccessDenied } from "@/components/AccessDenied";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { selectAll } from "@/lib/supabase-paginate";
import { formatDateBR } from "@/lib/date-utils";
import { compareSize } from "@/lib/uniformes.sizes";
import {
  DIAS_PEDIDO_EM_ATRASO,
  diasDesdePedido,
  pedidoEmAtraso,
  pedidoFoiAtendido,
} from "@/lib/uniformes-pedido";
import { VendasDoAno } from "@/components/uniformes/VendasDoAno";

export const Route = createFileRoute("/uniformes")({
  head: () => ({ meta: [{ title: "Uniformes — School Hub" }] }),
  component: UniformesGate,
});

function UniformesGate() {
  const { canView, loading } = usePermissions();
  if (loading) return null;
  if (!canView("uniformes"))
    return <AccessDenied message="Você não tem permissão para visualizar os Uniformes." />;
  return <UniformesPage />;
}

type UniformProduct = {
  ns_product_id: string;
  store_key: StoreKey;
  name: string;
  category: string | null;
  active: boolean;
};

type UniformVariant = {
  id: string;
  ns_variant_id: string;
  ns_product_id: string;
  store_key: StoreKey;
  size: string;
  sku: string | null;
  stock: number;
  min_stock: number;
  price: number | null;
  // Momento em que a peça foi marcada como "Pedido realizado" (null = sem pedido).
  order_placed_at: string | null;
};

type SyncLog = {
  id: string;
  source: string;
  status: string;
  variants_synced: number;
  discrepancies: number;
  started_at: string;
  finished_at: string | null;
};

type SortColumn = "produto" | "size";
type SortDir = "asc" | "desc";
type Aba = "estoque" | "vendas";

function UniformesPage() {
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("uniformes");
  const { selected, schools, schoolFilterIds } = useSchool();
  const [busca, setBusca] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [gerandoPlanilha, setGerandoPlanilha] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("produto");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [aba, setAba] = useState<Aba>("estoque");

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
  }

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["uniform_products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("uniform_products" as any)
        .select("ns_product_id, store_key, name, category, active")
        .order("name", { ascending: true });
      if (error) return [] as UniformProduct[];
      return (data ?? []) as unknown as UniformProduct[];
    },
  });

  const {
    data: variants = [],
    isLoading: loadingVariants,
    refetch: refetchVariants,
  } = useQuery({
    queryKey: ["uniform_variants"],
    queryFn: async () => {
      return selectAll<UniformVariant>(() =>
        supabase
          .from("uniform_variants" as never)
          .select(
            "id, ns_variant_id, ns_product_id, store_key, size, sku, stock, min_stock, price, order_placed_at",
          )
          .order("size", { ascending: true })
          .order("id", { ascending: true }),
      );
    },
  });

  const { data: lastSync, refetch: refetchSync } = useQuery({
    queryKey: ["uniform_last_sync"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("uniform_sync_log" as any)
        .select("id, source, status, variants_synced, discrepancies, started_at, finished_at")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as unknown as SyncLog | null;
    },
  });

  const productName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(`${p.store_key}:${p.ns_product_id}`, p.name);
    return (storeKey: StoreKey, id: string) => m.get(`${storeKey}:${id}`) ?? "—";
  }, [products]);

  // Lojas (store_key) visíveis para a unidade selecionada no header. `null` =
  // sem filtro (usuário global em "Todas as Unidades" → todas as lojas).
  const allowedStoreKeys = useMemo<Set<StoreKey> | null>(() => {
    const idToName = new Map(schools.map((s) => [s.id, s.name]));
    const ids = selected !== "all" ? [selected] : schoolFilterIds;
    if (ids === null) return null;
    const keys = new Set<StoreKey>();
    for (const id of ids) {
      const key = storeKeyForUnitName(idToName.get(id));
      if (key) keys.add(key);
    }
    return keys;
  }, [selected, schools, schoolFilterIds]);

  const unitFiltered = useMemo(() => {
    if (!allowedStoreKeys) return variants;
    return variants.filter((v) => allowedStoreKeys.has(v.store_key));
  }, [variants, allowedStoreKeys]);

  const visibleProducts = useMemo(() => {
    const ids = new Set(unitFiltered.map((v) => `${v.store_key}:${v.ns_product_id}`));
    return products.filter((p) => ids.has(`${p.store_key}:${p.ns_product_id}`));
  }, [products, unitFiltered]);

  const rows = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const enriched = unitFiltered.map((v) => ({
      ...v,
      produto: productName(v.store_key, v.ns_product_id),
    }));
    if (!termo) return enriched;
    return enriched.filter(
      (v) => v.produto.toLowerCase().includes(termo) || v.size.toLowerCase().includes(termo),
    );
  }, [unitFiltered, busca, productName]);

  const sortedRows = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortColumn === "produto") {
        const byName = a.produto.localeCompare(b.produto, "pt-BR");
        // Agrupa o mesmo modelo e, dentro dele, ordena por tamanho.
        return factor * (byName !== 0 ? byName : compareSize(a.size, b.size));
      }
      const bySize = compareSize(a.size, b.size);
      return factor * (bySize !== 0 ? bySize : a.produto.localeCompare(b.produto, "pt-BR"));
    });
  }, [rows, sortColumn, sortDir]);

  // Só conta como estoque baixo a peça que ainda é reposta junto à fábrica:
  // ficam de fora as de algodão (sob encomenda), o uniforme antigo do CEC/CEC
  // Baby (sem "/ Azul") e o Vale do Sereno, em descontinuação.
  const baixoEstoque = rows.filter((v) =>
    notificaEstoqueBaixo({
      storeKey: v.store_key,
      produto: v.produto,
      stock: v.stock,
      minStock: v.min_stock,
    }),
  ).length;

  // Patrimônio em estoque: soma de (preço de venda × saldo) de cada variação da
  // unidade selecionada (não depende da busca). Preço vem sincronizado da Nuvemshop.
  const valorEstoque = useMemo(
    () => unitFiltered.reduce((sum, v) => sum + Number(v.price ?? 0) * (v.stock ?? 0), 0),
    [unitFiltered],
  );

  async function sincronizar() {
    setSincronizando(true);
    try {
      type SyncResponse = { ok?: boolean; error?: string; code?: string };
      const postSync = async (token?: string) => {
        const res = await fetch("/api/nuvemshop/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const body = (await res.json().catch(() => ({}))) as SyncResponse;
        return { res, body };
      };

      const {
        data: { session },
      } = await supabase.auth.getSession();
      let { res, body } = await postSync(session?.access_token);

      // O access_token do Supabase pode ter expirado com a aba aberta por muito
      // tempo. Nesse caso renova a sessão e tenta 1x antes de pedir novo login.
      if (res.status === 401 && body.code === "unauthenticated") {
        const { data } = await supabase.auth.refreshSession();
        if (data.session?.access_token) {
          ({ res, body } = await postSync(data.session.access_token));
        }
      }

      if (!res.ok || !body.ok) {
        if (body.code === "unauthenticated") {
          toast.error("Sua sessão do School Hub expirou. Faça login novamente.");
        } else {
          // Falha na integração com a Nuvemshop (token/erro do servidor): nunca
          // pede novo login do School Hub.
          toast.error(body.error ?? "Falha ao sincronizar com a Nuvemshop.");
        }
        return;
      }
      toast.success("Sincronização concluída.");
      await Promise.all([refetchVariants(), refetchSync()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao sincronizar com a Nuvemshop.";
      toast.error(msg);
    } finally {
      setSincronizando(false);
    }
  }

  async function gerarPlanilha() {
    setGerandoPlanilha(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      // Respeita a unidade do header: null => todas as lojas; set => lojas da
      // unidade selecionada (set vazio => nenhuma loja correspondente).
      const storesParam =
        allowedStoreKeys === null ? "all" : Array.from(allowedStoreKeys).join(",");
      const res = await fetch(
        `/api/uniformes/export-order?stores=${encodeURIComponent(storesParam)}`,
        {
          method: "GET",
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao gerar a planilha.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `pedido-uniformes-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Planilha de pedidos gerada.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar a planilha.";
      toast.error(msg);
    } finally {
      setGerandoPlanilha(false);
    }
  }

  // ─── "Pedido realizado" ────────────────────────────────────────────────────
  // A marcação vive em uniform_variants.order_placed_at e o histórico (com a
  // data de cada pedido) em uniform_order_marks.
  const [salvandoPedido, setSalvandoPedido] = useState<string | null>(null);

  async function encerrarPedidoDB(v: UniformVariant, reason: "reabastecido" | "manual") {
    const { error } = await supabase
      .from("uniform_variants" as any)
      .update({ order_placed_at: null, order_placed_by: null } as any)
      .eq("id", v.id);
    if (error) throw error;
    await supabase
      .from("uniform_order_marks" as any)
      .update({ cleared_at: new Date().toISOString(), cleared_reason: reason } as any)
      .eq("store_key", v.store_key)
      .eq("ns_variant_id", v.ns_variant_id)
      .is("cleared_at", null);
  }

  async function marcarPedidoDB(v: UniformVariant) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const agora = new Date().toISOString();
    const { error } = await supabase
      .from("uniform_variants" as any)
      .update({ order_placed_at: agora, order_placed_by: user?.id ?? null } as any)
      .eq("id", v.id);
    if (error) throw error;
    await supabase.from("uniform_order_marks" as any).insert({
      store_key: v.store_key,
      ns_variant_id: v.ns_variant_id,
      marked_at: agora,
      marked_by: user?.id ?? null,
      stock_at_mark: v.stock,
    } as any);
  }

  async function togglePedido(v: UniformVariant) {
    if (!podeEditar) return;
    setSalvandoPedido(v.id);
    try {
      if (v.order_placed_at) await encerrarPedidoDB(v, "manual");
      else await marcarPedidoDB(v);
      await refetchVariants();
    } catch {
      toast.error("Não foi possível salvar o pedido realizado.");
    } finally {
      setSalvandoPedido(null);
    }
  }

  // Pedido atendido (saldo voltou ao mínimo) encerra o ciclo sozinho. A
  // sincronização com a Nuvemshop já faz isso no servidor; aqui cobre o caso de
  // o saldo ter subido por outro caminho antes da próxima sincronização.
  const pedidosAtendidos = useMemo(
    () =>
      variants.filter((v) =>
        pedidoFoiAtendido({
          orderPlacedAt: v.order_placed_at,
          stock: v.stock,
          minStock: v.min_stock,
        }),
      ),
    [variants],
  );

  useEffect(() => {
    if (!podeEditar || pedidosAtendidos.length === 0) return;
    let cancelado = false;
    void (async () => {
      for (const v of pedidosAtendidos) {
        try {
          await encerrarPedidoDB(v, "reabastecido");
        } catch {
          return;
        }
      }
      if (!cancelado) await refetchVariants();
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidosAtendidos, podeEditar]);

  const isLoading = loadingProducts || loadingVariants;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Shirt className="h-6 w-6 text-indigo-600" />
            Uniformes
          </h1>
          <p className="text-sm text-muted-foreground">
            Controle de estoque das peças, sincronizado com a Nuvemshop.
          </p>
        </div>
        {aba === "estoque" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={gerarPlanilha}
              disabled={gerandoPlanilha || isLoading}
            >
              <FileSpreadsheet
                className={`mr-2 h-4 w-4 ${gerandoPlanilha ? "animate-pulse" : ""}`}
              />
              Gerar Planilha de Pedidos
            </Button>
            {podeEditar && (
              <Button onClick={sincronizar} disabled={sincronizando}>
                <RefreshCw className={`mr-2 h-4 w-4 ${sincronizando ? "animate-spin" : ""}`} />
                Sincronizar com Nuvemshop
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            ["estoque", "Estoque"],
            ["vendas", "Vendas do Ano"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAba(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              aba === key
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {aba === "vendas" ? (
        <VendasDoAno allowedStoreKeys={allowedStoreKeys} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Peças
              </div>
              <div className="mt-1 text-2xl font-bold text-foreground">
                {visibleProducts.length}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Variações (tamanhos)
              </div>
              <div className="mt-1 text-2xl font-bold text-foreground">{unitFiltered.length}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Estoque mínimo (&lt;5)
              </div>
              <div
                className={`mt-1 text-2xl font-bold ${baixoEstoque > 0 ? "text-red-600" : "text-foreground"}`}
              >
                {baixoEstoque}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Valor em estoque
              </div>
              <div className="mt-1 text-2xl font-bold text-foreground">
                {valorEstoque.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </div>
            </div>
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por peça ou tamanho..."
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
                <PackageSearch className="h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground">
                  Nenhum item de estoque encontrado.
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {variants.length === 0
                    ? "Sincronize com a Nuvemshop para importar o catálogo de uniformes."
                    : "Ajuste a busca para encontrar a peça desejada."}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">
                      <SortHeader
                        label="Peça"
                        active={sortColumn === "produto"}
                        dir={sortDir}
                        onClick={() => toggleSort("produto")}
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <SortHeader
                        label="Tamanho"
                        active={sortColumn === "size"}
                        dir={sortDir}
                        onClick={() => toggleSort("size")}
                      />
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Saldo</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Pedido realizado</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((v) => {
                    const abaixoDoMinimo = abaixoDoEstoqueMinimo(v.stock, v.min_stock);
                    const motivo = motivoForaDaReposicao(v.store_key, v.produto);
                    const critico = abaixoDoMinimo && motivo === null;
                    const pedido = v.order_placed_at;
                    const emAtraso = pedidoEmAtraso(
                      {
                        orderPlacedAt: v.order_placed_at,
                        stock: v.stock,
                        minStock: v.min_stock,
                      },
                      new Date(),
                    );
                    const dias = diasDesdePedido(v.order_placed_at, new Date());
                    return (
                      <tr
                        key={v.id}
                        className={`border-b border-border last:border-b-0 ${
                          pedido ? "bg-amber-50/70 hover:bg-amber-100/70" : "hover:bg-muted/30"
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">{v.produto}</td>
                        <td className="px-4 py-3 text-foreground">{v.size || "—"}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                          {v.stock}
                        </td>
                        <td className="px-4 py-3">
                          {critico ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                              <AlertTriangle className="h-3 w-3" />
                              Estoque baixo
                            </span>
                          ) : abaixoDoMinimo && motivo !== null ? (
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                              {motivo === "algodao" ? "Sob encomenda" : "Descontinuado"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                              OK
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={!podeEditar || salvandoPedido === v.id}
                              onClick={() => togglePedido(v)}
                              aria-pressed={Boolean(pedido)}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
                                pedido
                                  ? "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {pedido ? "Pedido realizado" : "Marcar pedido"}
                            </button>
                            {pedido && (
                              <span className="text-xs text-muted-foreground">
                                {formatDateBR(pedido)}
                              </span>
                            )}
                            {emAtraso && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700"
                                title={`Pedido feito há ${dias} dias e a peça continua em falta (limite de ${DIAS_PEDIDO_EM_ATRASO} dias).`}
                              >
                                <Clock className="h-3 w-3" />
                                Não atendido
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {lastSync && (
            <p className="text-xs text-muted-foreground">
              Última sincronização: {formatDateBR(lastSync.started_at)} · origem {lastSync.source} ·{" "}
              {lastSync.variants_synced} variações
              {lastSync.discrepancies > 0
                ? ` · ${lastSync.discrepancies} divergência(s) corrigida(s)`
                : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground ${
        active ? "text-foreground" : ""
      }`}
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}
