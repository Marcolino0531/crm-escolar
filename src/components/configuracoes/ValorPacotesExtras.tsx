import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
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
import { parseBRLNumber } from "@/lib/currency";
import {
  CATEGORIA_SPONTE_POR_ITEM,
  ITENS_PACOTE_EXTRAS,
  pacotesVazios,
  type ItemPacoteExtras,
  type PacotesExtras,
} from "@/lib/pacotes-extras";
import { formatarBRL } from "@/lib/rematricula";
import {
  listarPacotesExtras,
  salvarPacotesExtras,
  type PacotesExtrasRegistro,
} from "@/lib/rematricula.functions";

type Campos = Record<ItemPacoteExtras, string>;

function camposVazios(): Campos {
  return { lanche_manha: "", almoco: "", lanche_tarde: "", jantar: "", hora_extra: "" };
}

function camposDe(p: PacotesExtras): Campos {
  const c = camposVazios();
  for (const item of ITENS_PACOTE_EXTRAS) c[item] = p[item].toFixed(2).replace(".", ",");
  return c;
}

// Pacote MENSAL (5 dias por semana) de cada refeição e da hora extra, por
// colégio × ano letivo. Segue o seletor global: com "Todas as Unidades" só lista.
export function ValorPacotesExtras({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const unidade = useUnidadeAtiva();
  const listar = useServerFn(listarPacotesExtras);
  const salvar = useServerFn(salvarPacotesExtras);
  const [ano, setAno] = useState(String(new Date().getFullYear() + 1));
  const [campos, setCampos] = useState<Campos>(camposVazios());

  const registros = useQuery({
    queryKey: ["pacotes_extras_valores", unidade],
    queryFn: async () => listar({ data: { unidade } }),
  });

  const atual: PacotesExtrasRegistro | undefined = registros.data?.find(
    (r) => r.unidade === unidade && r.anoLetivo === Number(ano),
  );

  useEffect(() => {
    setCampos(atual ? camposDe(atual.pacotes) : camposVazios());
  }, [atual]);

  const gravar = useMutation({
    mutationFn: async () => {
      if (!unidade) throw new Error("Selecione um colégio no topo da tela.");
      const pacotes = pacotesVazios();
      for (const item of ITENS_PACOTE_EXTRAS) {
        pacotes[item] = campos[item].trim() ? parseBRLNumber(campos[item]) : 0;
      }
      return salvar({ data: { unidade, anoLetivo: Number(ano), pacotes } });
    },
    onSuccess: () => {
      toast.success(`Valores dos pacotes extras salvos para ${unidade}.`);
      void qc.invalidateQueries({ queryKey: ["pacotes_extras_valores"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  const podeAlterar = podeEditar && unidade !== null;

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Valor Pacotes Extras por ano letivo</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Refeições: valor do pacote mensal para 5 dias por semana; na matrícula, cada refeição é
        cobrada proporcionalmente aos dias marcados na rotina (pacote ÷ 5 × dias). Hora Extra: valor
        mensal de 1 hora extra por dia, 5 dias por semana.
      </p>
      {registros.isLoading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : (
        <div className="mt-3 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {!unidade && <TableHead>Colégio</TableHead>}
                <TableHead>Ano letivo</TableHead>
                {ITENS_PACOTE_EXTRAS.map((item) => (
                  <TableHead key={item} className="text-right">
                    {CATEGORIA_SPONTE_POR_ITEM[item]}
                  </TableHead>
                ))}
                <TableHead>Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(registros.data ?? []).map((r) => (
                <TableRow key={`${r.unidade}-${r.anoLetivo}`}>
                  {!unidade && <TableCell>{r.unidade}</TableCell>}
                  <TableCell>{r.anoLetivo}</TableCell>
                  {ITENS_PACOTE_EXTRAS.map((item) => (
                    <TableCell key={item} className="text-right">
                      {formatarBRL(r.pacotes[item])}
                    </TableCell>
                  ))}
                  <TableCell className="text-xs text-muted-foreground">
                    {r.atualizadoEm ? new Date(r.atualizadoEm).toLocaleDateString("pt-BR") : ""}
                    {r.atualizadoPor ? ` · ${r.atualizadoPor}` : ""}
                  </TableCell>
                </TableRow>
              ))}
              {registros.data?.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={(unidade ? 2 : 3) + ITENS_PACOTE_EXTRAS.length}
                    className="text-center text-muted-foreground"
                  >
                    Nenhum pacote cadastrado{unidade ? ` para ${unidade}` : ""}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {podeEditar && !unidade && (
        <div className="mt-3">
          <SelecioneUnidade acao="O cadastro do Valor Pacotes Extras" />
        </div>
      )}
      {podeAlterar && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Ano letivo</Label>
            <Input
              className="h-9 w-28"
              inputMode="numeric"
              value={ano}
              onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          {ITENS_PACOTE_EXTRAS.map((item) => (
            <div key={item} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {CATEGORIA_SPONTE_POR_ITEM[item]} (R$/mês)
              </Label>
              <Input
                className="h-9 w-32"
                inputMode="decimal"
                placeholder="0,00"
                value={campos[item]}
                onChange={(e) => setCampos((c) => ({ ...c, [item]: e.target.value }))}
              />
            </div>
          ))}
          <Button
            className="gap-2"
            disabled={ano.length !== 4 || gravar.isPending}
            onClick={() => gravar.mutate()}
          >
            {gravar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar em {unidade}
          </Button>
        </div>
      )}
    </div>
  );
}
