import { createFileRoute } from "@tanstack/react-router";
import { VerificarLinkRematricula } from "@/components/rematricula/VerificarLinkRematricula";

// Rota PÚBLICA de verificação do link mágico: /rematricula/{ano}/verificar?token=
export const Route = createFileRoute("/rematricula_/$ano_/verificar")({
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: VerificarLinkAnoPage,
});

function VerificarLinkAnoPage() {
  const { ano } = Route.useParams();
  return <VerificarLinkRematricula anoDaUrl={ano} />;
}
