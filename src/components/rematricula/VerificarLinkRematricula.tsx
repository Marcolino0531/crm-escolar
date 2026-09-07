import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { GraduationCap, Loader2, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MENSAGEM_LINK_INVALIDO } from "@/lib/rematricula";
import { CHAVE_SESSAO_REMATRICULA } from "@/lib/rematricula-sessao";
import { validarLinkRematricula } from "@/lib/rematricula.functions";

// Verificação do link mágico: usada em /rematricula/{ano}/verificar (links
// novos) e em /rematricula/verificar (links já enviados antes do ano na URL).
export function VerificarLinkRematricula({ anoDaUrl }: { anoDaUrl?: string } = {}) {
  const search = useSearch({ strict: false }) as { token?: string };
  const token = typeof search.token === "string" ? search.token : "";
  const navigate = useNavigate();
  const validar = useServerFn(validarLinkRematricula);
  const [erro, setErro] = useState("");
  // O link é de uso único: uma montagem só pode gastá-lo uma vez (o StrictMode
  // do React monta o efeito duas vezes em desenvolvimento).
  const jaTentou = useRef(false);

  useEffect(() => {
    if (jaTentou.current) return;
    jaTentou.current = true;
    if (token.length < 16) {
      setErro(MENSAGEM_LINK_INVALIDO);
      return;
    }
    void (async () => {
      try {
        const res = await validar({ data: { token } });
        if (!res.ok || !res.token || !res.anoLetivo) {
          setErro(res.erro ?? MENSAGEM_LINK_INVALIDO);
          return;
        }
        sessionStorage.setItem(CHAVE_SESSAO_REMATRICULA, res.token);
        // O ano é o gravado no link (não o da URL): um link antigo de 2027
        // continua abrindo a rematrícula de 2027. replace: a URL com o token
        // sai do histórico do navegador.
        void navigate({
          to: "/rematricula/$ano",
          params: { ano: String(res.anoLetivo) },
          replace: true,
        });
      } catch {
        setErro("Não foi possível validar o link agora. Tente novamente.");
      }
    })();
  }, [navigate, token, validar]);

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold">Rematrícula</h1>
        </div>

        {erro ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <MailX className="mt-0.5 h-4 w-4 shrink-0" />
              {erro}
            </p>
            <Button
              className="w-full"
              onClick={() =>
                void (anoDaUrl
                  ? navigate({
                      to: "/rematricula/$ano",
                      params: { ano: anoDaUrl },
                      replace: true,
                    })
                  : navigate({ to: "/rematricula", replace: true }))
              }
            >
              Solicitar um novo link
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validando seu link de acesso…
          </p>
        )}
      </div>
    </div>
  );
}
