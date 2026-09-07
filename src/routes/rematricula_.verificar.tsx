import { createFileRoute } from "@tanstack/react-router";
import { VerificarLinkRematricula } from "@/components/rematricula/VerificarLinkRematricula";

// Rota PÚBLICA legada (emails enviados antes do ano na URL). Segmento estático,
// então tem prioridade sobre /rematricula/$ano.
export const Route = createFileRoute("/rematricula_/verificar")({
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: VerificarLinkRematricula,
});
