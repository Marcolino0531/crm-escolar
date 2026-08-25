// Aba "Vendas do Ano" do módulo de Uniformes: grade peça × tamanho com a
// quantidade vendida no ano, lida da Nuvemshop (GET /orders) pela rota
// /api/uniformes/vendas. Só leitura — nada é gravado.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { FileSpreadsheet, PackageSearch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { STORES, type StoreKey } from "@/lib/nuvemshop.stores";
import { compareSize } from "@/lib/uniformes.sizes";
import type { VendaAgregada } from "@/lib/uniformes.vendas";

const STORE_LABEL: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.key, s.label]));

function anoAtualBRT(): number {
  return Number(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4),
  );
}

type Props = { allowedStoreKeys: Set<StoreKey> | null };

type Linha = {
  produto: string;
  loja: string;
  porTamanho: Map<string, number>;
  total: number;
  receita: number;
};

// Pivota as vendas: uma linha por peça (de cada loja), uma coluna por tamanho.
function pivota(vendas: VendaAgregada[]): { linhas: Linha[]; tamanhos: string[] } {
  const porPeca = new Map<string, Linha>();
  const tamanhos = new Set<string>();

  for (const v of vendas) {
    tamanhos.add(v.tamanho);
    const chave = `${v.storeKey}:${v.produto}`;
    let linha = porPeca.get(chave);
    if (!linha) {
      linha = {
        produto: v.produto,
        loja: STORE_LABEL[v.storeKey] ?? v.storeKey,
        porTamanho: new Map(),
        total: 0,
        receita: 0,
      };
      porPeca.set(chave, linha);
    }
    linha.porTamanho.set(v.tamanho, (linha.porTamanho.get(v.tamanho) ?? 0) + v.quantidade);
    linha.total += v.quantidade;
    linha.receita += v.receita;
  }

  return {
    linhas: [...porPeca.values()].sort(
      (a, b) => b.total - a.total || a.produto.localeCompare(b.produto, "pt-BR"),
    ),
    tamanhos: [...tamanhos].sort(compareSize),
  };
}

export function VendasDoAno({ allowedStoreKeys }: Props) {
  const [ano, setAno] = useState<number>(anoAtualBRT());
  const storesParam = allowedStoreKeys === null ? "all" : [...allowedStoreKeys].join(",");

  const { data, isFetching, error, refetch } = useQuery<VendaAgregada[]>({
    queryKey: ["uniformes-vendas", ano, storesParam],
    // Cada consulta varre os pedidos do ano na Nuvemshop: não vale refazer a
    // chamada a cada foco de aba.
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/uniformes/vendas?ano=${ano}&stores=${encodeURIComponent(storesParam)}`,
        {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        vendas?: VendaAgregada[];
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Falha ao consultar as vendas.");
      return body.vendas ?? [];
    },
  });

  const { linhas, tamanhos } = useMemo(() => pivota(data ?? []), [data]);
  const totalPecas = linhas.reduce((s, l) => s + l.total, 0);
  const totalReceita = linhas.reduce((s, l) => s + l.receita, 0);
  const multiLoja = new Set(linhas.map((l) => l.loja)).size > 1;

  const anos = useMemo(() => {
    const atual = anoAtualBRT();
    return [atual + 1, atual, atual - 1, atual - 2];
  }, []);

  function exportar() {
    if (linhas.length === 0) {
      toast.error("Nenhuma venda para exportar.");
      return;
    }
    const cabecalho = ["Peça", ...(multiLoja ? ["Unidade / Loja"] : []), ...tamanhos, "Total"];
    const corpo = linhas.map((l) => [
      l.produto,
      ...(multiLoja ? [l.loja] : []),
      ...tamanhos.map((t) => l.porTamanho.get(t) ?? 0),
      l.total,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...corpo]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Vendas ${ano}`);
    XLSX.writeFile(wb, `vendas-uniformes-${ano}.xlsx`);
    toast.success("Planilha baixada.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="vendas-ano">
            Ano
          </label>
          <select
            id="vendas-ano"
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {anos.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pedidos pagos, pela data de pagamento, sem cancelados. A receita soma só as peças
            (sem frete nem descontos).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" onClick={exportar} disabled={isFetching || linhas.length === 0}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Exportar .xlsx
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Peças vendidas em {ano}
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">{totalPecas}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Modelos com venda
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">{linhas.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Receita das peças
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">
            {totalReceita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        {isFetching ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <p className="text-sm font-medium text-foreground">Não foi possível ler as vendas.</p>
            <p className="max-w-lg text-xs text-muted-foreground">
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        ) : linhas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <PackageSearch className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">
              Nenhuma venda paga encontrada em {ano}.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Peça</th>
                {multiLoja && <th className="px-4 py-3 font-medium">Unidade / Loja</th>}
                {tamanhos.map((t) => (
                  <th key={t} className="px-3 py-3 text-right font-medium">
                    {t}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr
                  key={`${l.loja}:${l.produto}`}
                  className="border-b border-border last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{l.produto}</td>
                  {multiLoja && <td className="px-4 py-3 text-muted-foreground">{l.loja}</td>}
                  {tamanhos.map((t) => {
                    const q = l.porTamanho.get(t);
                    return (
                      <td
                        key={t}
                        className={`px-3 py-3 text-right tabular-nums ${
                          q ? "text-foreground" : "text-muted-foreground/40"
                        }`}
                      >
                        {q ?? "—"}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                    {l.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
