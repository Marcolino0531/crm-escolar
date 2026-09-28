import { useState, type ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/lib/app-context";
import { abasVisiveis, noPorChave, type Aba, type ChavePermissao } from "@/lib/permissoes-arvore";

/**
 * Abas de uma página lidas da árvore única de permissões: nome, ordem e
 * visibilidade vêm de src/lib/permissoes-arvore.ts. O `value` de cada aba é o
 * último segmento da chave (ex.: "diario.registro" → "registro").
 * Nós com `acessoEspecial`: "admin" só para o Administrador; "professor" é
 * liberado pelo vínculo de professor (a própria tela já faz esse gate).
 */
export function useAbasArvore(chavePai: ChavePermissao): { abas: Aba[]; inicial: string | null } {
  const { canView, isAdmin } = usePermissions();
  const abas = abasVisiveis(chavePai, (c) => {
    const especial = noPorChave(c)?.acessoEspecial;
    if (especial === "admin") return isAdmin;
    if (especial === "professor") return true;
    return canView(c);
  });
  return { abas, inicial: abas[0]?.id ?? null };
}

/**
 * Aba ativa controlada: a escolha do usuário só vale se a aba estiver visível;
 * caso contrário cai na primeira aba visível (nunca numa aba sem permissão).
 */
export function useAbaAtiva(chavePai: ChavePermissao): [string, (v: string) => void, Aba[]] {
  const { abas, inicial } = useAbasArvore(chavePai);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const ativa = (abas.some((a) => a.id === escolhida) ? escolhida : inicial) ?? "";
  return [ativa, setEscolhida, abas];
}

export function AbasArvore({
  chavePai,
  className,
  triggerClassName,
  antes,
  depois,
  ocultar,
}: {
  chavePai: ChavePermissao;
  className?: string;
  triggerClassName?: string;
  /** Conteúdo antes do nome (ícone), por id da aba. */
  antes?: Partial<Record<string, ReactNode>>;
  /** Conteúdo depois do nome (contador, selo), por id da aba. */
  depois?: Partial<Record<string, ReactNode>>;
  /** Abas a esconder por regra própria da tela (ex.: sem unidade selecionada). */
  ocultar?: readonly string[];
}) {
  const { abas } = useAbasArvore(chavePai);
  return (
    <TabsList className={className}>
      {abas
        .filter((a) => !ocultar?.includes(a.id))
        .map((a) => (
          <TabsTrigger key={a.chave} value={a.id} className={triggerClassName} data-chave={a.chave}>
            {antes?.[a.id]}
            {a.nome}
            {depois?.[a.id]}
          </TabsTrigger>
        ))}
    </TabsList>
  );
}
