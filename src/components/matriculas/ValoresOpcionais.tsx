// Configuração mínima do faturamento da matrícula: alimentação e hora extra.
// Matrícula, mensalidade e material já têm fonte própria (plano do Sponte e
// "Material Pedagógico por Série"), então só estes dois valores ficam aqui.
// A unidade vem do seletor global do topo — sem seletor concorrente na tela.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Utensils } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SelecioneUnidade } from "@/components/SelecioneUnidade";
import { formatBRLInput, parseBRLNumber } from "@/lib/currency";
import { obterValoresOpcionais, salvarValoresOpcionais } from "@/lib/matriculas.functions";

export function ValoresOpcionais({
  unidade,
  podeEditar,
}: {
  unidade: string | null;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const obter = useServerFn(obterValoresOpcionais);
  const salvar = useServerFn(salvarValoresOpcionais);
  const [refeicao, setRefeicao] = useState("");
  const [horaExtra, setHoraExtra] = useState("");

  const config = useQuery({
    queryKey: ["matricula_valores_opcionais", unidade],
    queryFn: async () => obter({ data: { unidade: unidade ?? "" } }),
    enabled: unidade !== null,
  });

  useEffect(() => {
    if (!config.data) return;
    setRefeicao(config.data.valorRefeicao > 0 ? formatBRLInput(config.data.valorRefeicao) : "");
    setHoraExtra(config.data.valorHoraExtra > 0 ? formatBRLInput(config.data.valorHoraExtra) : "");
  }, [config.data]);

  const gravar = useMutation({
    mutationFn: async () =>
      salvar({
        data: {
          unidade: unidade ?? "",
          valorRefeicao: parseBRLNumber(refeicao || "0"),
          valorHoraExtra: parseBRLNumber(horaExtra || "0"),
        },
      }),
    onSuccess: () => {
      toast.success("Valores atualizados.");
      void qc.invalidateQueries({ queryKey: ["matricula_valores_opcionais"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Utensils className="h-4 w-4 text-primary" /> Alimentação e hora extra
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Usados no faturamento automático da matrícula quando a rotina escolar tem refeições ou
        horário estendido. Sem valor configurado, esses itens viram pendência da secretaria em vez
        de cobrança.
      </p>

      {unidade === null ? (
        <div className="mt-3">
          <SelecioneUnidade acao="Configurar alimentação e hora extra" />
        </div>
      ) : config.isLoading ? (
        <Skeleton className="mt-3 h-9 w-full" />
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Valor por refeição</Label>
            <Input
              className="h-9 w-32"
              inputMode="decimal"
              placeholder="0,00"
              value={refeicao}
              disabled={!podeEditar}
              onChange={(e) => setRefeicao(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Hora extra (mensal)</Label>
            <Input
              className="h-9 w-32"
              inputMode="decimal"
              placeholder="0,00"
              value={horaExtra}
              disabled={!podeEditar}
              onChange={(e) => setHoraExtra(e.target.value)}
            />
          </div>
          {podeEditar && (
            <Button size="sm" onClick={() => gravar.mutate()} disabled={gravar.isPending}>
              {gravar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          )}
          {config.data?.atualizadoEm && (
            <span className="text-[11px] text-muted-foreground">
              Última alteração: {new Date(config.data.atualizadoEm).toLocaleDateString("pt-BR")}
              {config.data.atualizadoPor ? ` · ${config.data.atualizadoPor}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
