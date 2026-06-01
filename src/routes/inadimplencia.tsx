import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";

export const Route = createFileRoute("/inadimplencia")({
  head: () => ({ meta: [{ title: "Inadimplência (Sponte) — Schooler Hub" }] }),
  component: InadimplenciaPage,
});

// Phase 6 of the Option C migration: the Sponte inadimplência view (currently
// served by api/sponte-batch.ts on the CRA app) is being ported into this
// sub-tab as a TanStack server route. The querying/grouping/segmentation logic
// (Query Inversion, boleto grouping, BolsaAssociada discount, CEC vs CEC Baby)
// is already implemented in api/sponte-batch.ts and will be reused.
function InadimplenciaPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 rounded-full bg-amber-100 p-5">
        <AlertCircle className="h-8 w-8 text-amber-600" />
      </div>
      <h2 className="text-xl font-bold text-foreground">Inadimplência (Sponte)</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Sub-aba em migração para o novo stack (Fase 6). A integração SOAP do Sponte — busca
        invertida de parcelas, agrupamento por boleto, desconto de bolsa e segmentação CEC × CEC
        Baby — será reaproveitada como rota de servidor.
      </p>
    </div>
  );
}
