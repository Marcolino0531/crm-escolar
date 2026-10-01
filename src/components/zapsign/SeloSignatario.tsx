import { Badge } from "@/components/ui/badge";

const SELO_SIGNATARIO: Record<string, { rotulo: string; classe: string }> = {
  new: { rotulo: "Aguardando", classe: "bg-amber-100 text-amber-900" },
  link_opened: { rotulo: "Abriu o link", classe: "bg-amber-100 text-amber-900" },
  signed: { rotulo: "Assinou", classe: "bg-emerald-100 text-emerald-800" },
  refused: { rotulo: "Recusou", classe: "bg-red-100 text-red-800" },
};

const SELO_DESCONHECIDO = "bg-slate-100 text-slate-700";

// Selo de status de um signatário da ZapSign, igual em Contratos e em Documentos › ZapSign.
export function SeloSignatario({ status }: { status: string }) {
  const selo = SELO_SIGNATARIO[status];
  return (
    <Badge className={`justify-center whitespace-nowrap ${selo?.classe ?? SELO_DESCONHECIDO}`}>
      {selo?.rotulo ?? status}
    </Badge>
  );
}
