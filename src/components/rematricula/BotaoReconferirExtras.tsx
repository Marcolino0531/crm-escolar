import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { mensagemReconferencia } from "@/lib/rematricula-extras";
import {
  reconferirExtrasAluno,
  type ResultadoReconferencia,
} from "@/lib/rematricula-extras.functions";

/** Relê Sponte + Diário agora e regrava só as divergências do aluno/ano. */
export function BotaoReconferirExtras({
  unidade,
  alunoId,
  anoLetivo,
  onResultado,
  size = "sm",
}: {
  unidade: string;
  alunoId: string;
  anoLetivo: number;
  onResultado?: (r: ResultadoReconferencia) => void;
  size?: "sm" | "xs";
}) {
  const qc = useQueryClient();
  const reconferir = useServerFn(reconferirExtrasAluno);
  const m = useMutation({
    mutationFn: async () => reconferir({ data: { unidade, alunoId, anoLetivo } }),
    onSuccess: (r) => {
      const msg = mensagemReconferencia(r);
      if (r.divergencias.length === 0) toast.success(msg);
      else toast.warning(msg, { duration: 8000 });
      void qc.invalidateQueries({ queryKey: ["rematricula_acompanhamento"] });
      void qc.invalidateQueries({ queryKey: ["rematricula_extras_divergencias", unidade] });
      onResultado?.(r);
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível conferir novamente."),
  });

  return (
    <Button
      type="button"
      variant="outline"
      size={size === "xs" ? "sm" : size}
      className={size === "xs" ? "h-7 px-2 text-xs" : undefined}
      disabled={m.isPending}
      onClick={() => m.mutate()}
      title="Relê o Sponte e o Diário do Aluno agora e atualiza as pendências"
    >
      {m.isPending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
      )}
      Conferir novamente
    </Button>
  );
}
