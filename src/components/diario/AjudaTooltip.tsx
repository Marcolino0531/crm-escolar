import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AjudaTooltip({ texto, rotulo }: { texto: string; rotulo?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={rotulo ?? "Ajuda"}
            className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-sm">{texto}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
