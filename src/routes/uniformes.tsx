import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Shirt, AlertTriangle, PackageSearch, Search } from "lucide-react";
import { usePermissions } from "@/lib/app-context";
import { AccessDenied } from "@/components/AccessDenied";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR } from "@/lib/date-utils";

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
  name: string;
  category: string | null;
  active: boolean;
};

type UniformVariant = {
  id: string;
  ns_variant_id: string;
  ns_product_id: string;
  size: string;
  sku: string | null;
  stock: number;
  min_stock: number;
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

function UniformesPage() {
  const { canEdit } = usePermissions();
  const podeEditar = canEdit("uniformes");
  const [busca, setBusca] = useState("");
  const [sincronizando, setSincronizando] = useState(false);

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["uniform_products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("uniform_products" as any)
        .select("ns_product_id, name, category, active")
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
      const { data, error } = await supabase
        .from("uniform_variants" as any)
        .select("id, ns_variant_id, ns_product_id, size, sku, stock, min_stock")
        .order("size", { ascending: true });
      if (error) return [] as UniformVariant[];
      return (data ?? []) as unknown as UniformVariant[];
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
    for (const p of products) m.set(p.ns_product_id, p.name);
    return (id: string) => m.get(id) ?? "—";
  }, [products]);

  const rows = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const enriched = variants.map((v) => ({ ...v, produto: productName(v.ns_product_id) }));
    if (!termo) return enriched;
    return enriched.filter(
      (v) =>
        v.produto.toLowerCase().includes(termo) ||
        v.size.toLowerCase().includes(termo) ||
        (v.sku ?? "").toLowerCase().includes(termo),
    );
  }, [variants, busca, productName]);

  const baixoEstoque = rows.filter((v) => v.stock <= v.min_stock).length;

  async function sincronizar() {
    setSincronizando(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/nuvemshop/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Falha na sincronização");
      toast.success("Sincronização concluída.");
      await Promise.all([refetchVariants(), refetchSync()]);
    } catch {
      toast.error("Falha ao sincronizar com a Nuvemshop. Verifique as credenciais da integração.");
    } finally {
      setSincronizando(false);
    }
  }

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
        {podeEditar && (
          <Button onClick={sincronizar} disabled={sincronizando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${sincronizando ? "animate-spin" : ""}`} />
            Sincronizar com Nuvemshop
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Peças
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">{products.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Variações (tamanhos)
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">{variants.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Estoque mínimo (≤5)
          </div>
          <div
            className={`mt-1 text-2xl font-bold ${baixoEstoque > 0 ? "text-red-600" : "text-foreground"}`}
          >
            {baixoEstoque}
          </div>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por peça, tamanho ou SKU..."
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
                <th className="px-4 py-3 font-medium">Peça</th>
                <th className="px-4 py-3 font-medium">Tamanho</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 text-right font-medium">Saldo</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const critico = v.stock <= v.min_stock;
                return (
                  <tr
                    key={v.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{v.produto}</td>
                    <td className="px-4 py-3 text-foreground">{v.size || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {v.sku || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      {v.stock}
                    </td>
                    <td className="px-4 py-3">
                      {critico ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                          <AlertTriangle className="h-3 w-3" />
                          Estoque baixo
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                          OK
                        </span>
                      )}
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
    </div>
  );
}
