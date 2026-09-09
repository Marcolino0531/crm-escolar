import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AjudaTooltip } from "@/components/diario/AjudaTooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { parseBRLNumber } from "@/lib/currency";
import {
  CATEGORIAS_EXTRA,
  ROTULO_CATEGORIA_EXTRA,
  anosDaTabela,
  tabelaDoAno,
  unidadeCobranca,
  type CategoriaExtra,
} from "@/lib/diario-precos";
import { listarPrecosExtras, salvarPrecoExtra } from "@/lib/diario-precos.functions";
import { formatarBRL } from "@/lib/rematricula";

type Props = { unidade: string | null; anoVigente: number | null; podeEditar: boolean };

export function TabelaPrecos({ unidade, anoVigente, podeEditar }: Props) {
  const qc = useQueryClient();
  const listar = useServerFn(listarPrecosExtras);
  const salvar = useServerFn(salvarPrecoExtra);
  const [ano, setAno] = useState("");
  const [categoria, setCategoria] = useState<CategoriaExtra>("breakfast");
  const [valor, setValor] = useState("");

  const precos = useQuery({
    queryKey: ["diario_precos_extras", unidade],
    enabled: unidade !== null,
    queryFn: async () => listar({ data: { unidade: unidade as string } }),
  });

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          unidade: unidade as string,
          categoria,
          anoLetivo: Number(ano),
          valor: parseBRLNumber(valor),
        },
      }),
    onSuccess: () => {
      toast.success("Preço salvo.");
      setValor("");
      void qc.invalidateQueries({ queryKey: ["diario_precos_extras", unidade] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  if (unidade === null) {
    return <SelecioneUnidade acao="ver a Tabela de Preços dos Extras" />;
  }

  const lista = precos.data ?? [];
  const anos = anosDaTabela(lista, anoVigente ?? new Date().getFullYear());

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5">
        <h3 className="text-base font-semibold text-foreground">Tabela de Preços · {unidade}</h3>
        <AjudaTooltip
          rotulo="Como a Tabela de Preços é usada"
          texto="Valores cobrados nos Extras do Diário, por ano letivo. Refeições fora do plano são cobradas por ocorrência (um valor por refeição). Hora Extra é o preço da hora: o tempo fora do horário contratado é convertido em fração de hora. Cada ano tem sua própria tabela — alterar um ano não muda os anteriores."
        />
      </div>

      {precos.isLoading ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ano letivo</TableHead>
                {CATEGORIAS_EXTRA.map((c) => (
                  <TableHead key={c} className="text-right">
                    {ROTULO_CATEGORIA_EXTRA[c]}
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {unidadeCobranca(c)}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {anos.map((a) => {
                const tabela = tabelaDoAno(lista, unidade, a);
                return (
                  <TableRow key={a}>
                    <TableCell className="font-medium">{a}</TableCell>
                    {CATEGORIAS_EXTRA.map((c) => {
                      const preco = tabela[c];
                      return (
                        <TableCell key={c} className="text-right">
                          <span className="inline-flex items-center gap-1">
                            {preco === undefined ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              formatarBRL(preco)
                            )}
                            {podeEditar && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                aria-label={`Editar ${ROTULO_CATEGORIA_EXTRA[c]} de ${a}`}
                                onClick={() => {
                                  setAno(String(a));
                                  setCategoria(c);
                                  setValor(
                                    preco === undefined ? "" : preco.toFixed(2).replace(".", ","),
                                  );
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Ano letivo</Label>
            <Input
              className="h-9 w-28"
              inputMode="numeric"
              placeholder={String(anoVigente ?? new Date().getFullYear())}
              value={ano}
              onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Categoria</Label>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaExtra)}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS_EXTRA.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ROTULO_CATEGORIA_EXTRA[c]} ({unidadeCobranca(c)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Valor (R$)</Label>
            <Input
              className="h-9 w-36"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <Button
            className="gap-2"
            disabled={ano.length !== 4 || !valor.trim() || gravar.isPending}
            onClick={() => gravar.mutate()}
          >
            {gravar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar preço
          </Button>
        </div>
      )}
    </div>
  );
}
