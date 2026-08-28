import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { UNIDADES } from "@/lib/colegios";
import { parseBRLNumber } from "@/lib/currency";
import { formatarBRL, opcoesParcelamentoMaterial, rotuloParcelamento } from "@/lib/rematricula";
import {
  excluirMaterialSerie,
  listarMaterialSeries,
  salvarMaterialSerie,
  type MaterialSerieRegistro,
} from "@/lib/rematricula.functions";

// Valor anual do material pedagógico por unidade + série. É o valor que o portal
// público de Rematrícula oferece ao responsável para parcelar em até 8x — cada
// unidade tem o seu, mesmo para a mesma série.
export function MaterialPedagogicoSeries({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const listar = useServerFn(listarMaterialSeries);
  const salvar = useServerFn(salvarMaterialSerie);
  const excluir = useServerFn(excluirMaterialSerie);

  const [editando, setEditando] = useState<MaterialSerieRegistro | null>(null);
  const [unidade, setUnidade] = useState<string>(UNIDADES[0]);
  const [serie, setSerie] = useState("");
  const [valor, setValor] = useState("");

  const registros = useQuery({
    queryKey: ["material_pedagogico_series"],
    queryFn: async () => listar({ data: undefined }),
  });

  function limpar() {
    setEditando(null);
    setSerie("");
    setValor("");
  }

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          id: editando?.id ?? null,
          unidade,
          serie: serie.trim(),
          valorAnual: parseBRLNumber(valor),
        },
      }),
    onSuccess: () => {
      toast.success("Valor do material salvo.");
      limpar();
      void qc.invalidateQueries({ queryKey: ["material_pedagogico_series"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Valor removido.");
      void qc.invalidateQueries({ queryKey: ["material_pedagogico_series"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  const valorNumero = parseBRLNumber(valor);
  const formOk = serie.trim().length > 0 && valorNumero > 0;
  const previa = formOk ? opcoesParcelamentoMaterial(valorNumero) : [];

  return (
    <div className="space-y-6">
      {podeEditar && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editando ? "Editar valor do material" : "Novo valor do material"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Unidade</Label>
              <Select value={unidade} onValueChange={setUnidade}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Série</Label>
              <Input
                placeholder="Ex.: 1º Ano"
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Valor anual</Label>
              <Input
                inputMode="decimal"
                placeholder="R$ 0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
          </div>

          {previa.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Parcelamento oferecido ao responsável: {previa.map(rotuloParcelamento).join(" · ")}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Button disabled={!formOk || gravar.isPending} onClick={() => gravar.mutate()}>
              {gravar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {editando ? "Salvar alterações" : "Adicionar"}
            </Button>
            {editando && (
              <Button variant="ghost" onClick={limpar}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {registros.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidade</TableHead>
              <TableHead>Série</TableHead>
              <TableHead className="text-right">Valor anual</TableHead>
              <TableHead>Atualizado por</TableHead>
              {podeEditar && <TableHead className="w-24 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(registros.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={podeEditar ? 5 : 4} className="text-sm text-muted-foreground">
                  Nenhum valor cadastrado. Sem cadastro, o portal de Rematrícula não oferece o
                  material para a série.
                </TableCell>
              </TableRow>
            )}
            {(registros.data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.unidade}</TableCell>
                <TableCell>{r.serie}</TableCell>
                <TableCell className="text-right">{formatarBRL(r.valorAnual)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.atualizadoPor}</TableCell>
                {podeEditar && (
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditando(r);
                        setUnidade(r.unidade);
                        setSerie(r.serie);
                        setValor(r.valorAnual.toFixed(2).replace(".", ","));
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={remover.isPending}
                      onClick={() => remover.mutate(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
