// Botão "Baixar assinado": pede ao servidor um link assinado de curta duração
// para a cópia própria do PDF assinado da ZapSign e abre em nova aba. Se o
// arquivo ainda não foi guardado, o servidor tenta guardar na hora; a falha
// aparece como aviso discreto com opção de tentar novamente.

import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { obterLinkArquivoAssinado } from "@/lib/zapsign.functions";
import type { ZapSignAmbiente } from "@/lib/zapsign.server";

export function BaixarAssinadoButton({
  documentoId,
  ambiente = "producao",
  erroGuardado,
  rotulo = "Baixar assinado",
  onAtualizado,
}: {
  documentoId: string;
  ambiente?: ZapSignAmbiente;
  /** `arquivo_assinado_erro` do documento, quando a captura automática falhou. */
  erroGuardado?: string | null;
  rotulo?: string;
  onAtualizado?: () => void;
}) {
  const obter = useServerFn(obterLinkArquivoAssinado);
  const mut = useMutation({
    mutationFn: () => obter({ data: { ambiente, id: documentoId } }),
    onSuccess: (r) => {
      window.open(r.url, "_blank", "noopener,noreferrer");
      onAtualizado?.();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Falha ao obter o PDF assinado");
      onAtualizado?.();
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mut.isPending}
        onClick={() => mut.mutate()}
        title={erroGuardado ? "Tentar guardar e baixar novamente" : "Baixar o PDF assinado"}
      >
        {mut.isPending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-1 h-4 w-4" />
        )}
        {erroGuardado ? "Tentar novamente" : rotulo}
      </Button>
      {erroGuardado && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-amber-700"
          title={erroGuardado}
        >
          <AlertTriangle className="h-3 w-3" /> PDF ainda não guardado no School Hub
        </span>
      )}
    </span>
  );
}
