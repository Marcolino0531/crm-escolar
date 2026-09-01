import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelecioneUnidade, useUnidadeAtiva } from "@/components/SelecioneUnidade";
import { filtrarPorUnidade } from "@/lib/unidade-global";
import { parseBRLNumber } from "@/lib/currency";
import { formatarBRL, opcoesParcelamentoMaterial, rotuloParcelamento } from "@/lib/rematricula";
import {
  excluirMaterialSerie,
  listarMaterialSeries,
  obterAnoLetivoRematricula,
  salvarAnoLetivoRematricula,
  salvarMaterialSerie,
  type MaterialSerieRegistro,
} from "@/lib/rematricula.functions";

// Ano letivo para o qual o formulário de rematrícula ativo aponta (em 2026 a
// escola configura 2027). É esse ano que define qual mensalidade em aberto do
// aluno ancora o vencimento da 1ª parcela do material no lançamento.
function AnoLetivoReferencia({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const obter = useServerFn(obterAnoLetivoRematricula);
  const salvar = useServerFn(salvarAnoLetivoRematricula);
  const [ano, setAno] = useState("");

  const config = useQuery({
    queryKey: ["rematricula_ano_letivo"],
    queryFn: async () => obter({ data: undefined }),
  });

  const gravar = useMutation({
    mutationFn: async () => salvar({ data: { anoLetivo: Number(ano) } }),
    onSuccess: () => {
      toast.success("Ano letivo de referência atualizado.");
      setAno("");
      void qc.invalidateQueries({ queryKey: ["rematricula_ano_letivo"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const atual = config.data?.anoLetivo ?? null;

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Ano Letivo de Referência</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {atual
          ? `A rematrícula em andamento é para ${atual}. A 1ª parcela do material vence junto da primeira mensalidade em aberto de ${atual}.`
          : "Ainda não configurado. Sem ele a secretaria não consegue lançar o material no Sponte."}
        {config.data?.atualizadoEm
          ? ` Última alteração: ${new Date(config.data.atualizadoEm).toLocaleDateString("pt-BR")}${
              config.data.atualizadoPor ? ` · ${config.data.atualizadoPor}` : ""
            }.`
          : ""}
      </p>
      {podeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Ano</Label>
            <Input
              className="h-9 w-28"
              inputMode="numeric"
              placeholder={String(new Date().getFullYear() + 1)}
              value={ano}
              onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <Button
            className="gap-2"
            disabled={ano.length !== 4 || gravar.isPending}
            onClick={() => gravar.mutate()}
          >
            {gravar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar ano letivo
          </Button>
        </div>
      )}
    </div>
  );
}

// Valor anual do material pedagógico por unidade + série. É o valor que o portal
// público de Rematrícula oferece ao responsável para parcelar em até 8x — cada
// unidade tem o seu, mesmo para a mesma série.
export function MaterialPedagogicoSeries({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const listar = useServerFn(listarMaterialSeries);
  const salvar = useServerFn(salvarMaterialSerie);
  const excluir = useServerFn(excluirMaterialSerie);

  const [editando, setEditando] = useState<MaterialSerieRegistro | null>(null);
  // Unidade do seletor global do topo: a tela não tem seletor próprio, e o
  // cadastro grava sempre na unidade que está no topo.
  const unidade = useUnidadeAtiva();
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

  // Trocar a unidade no topo cancela a edição de um registro da unidade anterior.
  useEffect(() => {
    setEditando(null);
    setSerie("");
    setValor("");
  }, [unidade]);

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          id: editando?.id ?? null,
          unidade: unidade ?? "",
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
  const formOk = !!unidade && serie.trim().length > 0 && valorNumero > 0;
  const previa = formOk ? opcoesParcelamentoMaterial(valorNumero) : [];
  const linhas = filtrarPorUnidade(registros.data ?? [], unidade, (r) => r.unidade);

  return (
    <div className="space-y-6">
      <AnoLetivoReferencia podeEditar={podeEditar} />
      {podeEditar && !unidade && <SelecioneUnidade acao="O cadastro do material pedagógico" />}
      {podeEditar && unidade && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editando ? "Editar valor do material" : "Novo valor do material"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Unidade</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {unidade}
              </div>
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
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={podeEditar ? 5 : 4} className="text-sm text-muted-foreground">
                  Nenhum valor cadastrado. Sem cadastro, o portal de Rematrícula não oferece o
                  material para a série.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((r) => (
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
