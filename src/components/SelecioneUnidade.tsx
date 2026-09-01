import { useSchool } from "@/lib/app-context";
import { unidadeAtiva } from "@/lib/unidade-global";
import { Building2 } from "lucide-react";

// Unidade ativa (nome) do seletor global; `null` em "Todas as Unidades".
export function useUnidadeAtiva(): string | null {
  const { selected, schools } = useSchool();
  return unidadeAtiva(selected, schools);
}

// Estado vazio das telas que só operam em uma unidade específica: em vez de um
// segundo seletor interno, pede a escolha no seletor do topo.
export function SelecioneUnidade({ acao }: { acao: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <Building2 className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">Selecione uma unidade específica no seletor do topo</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {acao} depende de uma única unidade. Troque de &quot;Todas as Unidades&quot; para o colégio
        desejado no topo da tela.
      </p>
    </div>
  );
}
