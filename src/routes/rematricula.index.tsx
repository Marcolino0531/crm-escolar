import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GraduationCap, Loader2 } from "lucide-react";
import { campanhaPublicaRematricula } from "@/lib/rematricula.functions";

// URL antiga, sem ano (/rematricula). Só redireciona quando há exatamente uma
// campanha aberta; com zero ou mais de uma, não há como adivinhar o ano e o
// responsável precisa usar o link enviado pela escola.
export const Route = createFileRoute("/rematricula/")({
  component: RematriculaSemAnoPage,
});

function RematriculaSemAnoPage() {
  const navigate = useNavigate();
  const consultar = useServerFn(campanhaPublicaRematricula);
  const campanha = useQuery({
    queryKey: ["rematricula_campanha_publica", null],
    queryFn: async () => consultar({ data: {} }),
  });
  const anosAbertos = campanha.data?.anosAbertos ?? [];

  useEffect(() => {
    if (anosAbertos.length === 1) {
      void navigate({
        to: "/rematricula/$ano",
        params: { ano: String(anosAbertos[0]) },
        replace: true,
      });
    }
  }, [anosAbertos, navigate]);

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold">Rematrícula</h1>
        </div>
        {campanha.isLoading || anosAbertos.length === 1 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </p>
        ) : anosAbertos.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nenhuma campanha de rematrícula está aberta no momento. Fale com a secretaria.
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Há mais de uma rematrícula aberta ({anosAbertos.join(" e ")}). Use o link enviado pela
            escola, que já indica o ano.
          </p>
        )}
      </div>
    </div>
  );
}
