import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabelaPrecos } from "@/components/diario/TabelaPrecos";
import {
  MaterialPedagogicoSeries,
  ValoresMatricula,
} from "@/components/rematricula/MaterialPedagogicoSeries";
import { ValoresBiblioteca } from "@/components/configuracoes/ValoresBiblioteca";
import { ValoresColonia } from "@/components/configuracoes/ValoresColonia";
import { ValorPacotesExtras } from "@/components/configuracoes/ValorPacotesExtras";
import { usePermissions, useSchool } from "@/lib/app-context";
import { abasDe, noPorChave, type ChavePermissao } from "@/lib/permissoes-arvore";
import { unidadeDaSelecao } from "@/lib/esportes-unidades";
import { anosLetivosDiario } from "@/lib/rematricula.functions";

// Os tipos de cadastro são as sub-páginas de Configurações > Cadastros Gerais na
// árvore única de permissões: nome, ordem e visibilidade vêm de lá.
const CHAVE_POR_TIPO = {
  material: "configuracoes.cadastros.valor_material",
  matricula: "configuracoes.cadastros.valor_matricula",
  pacotes_extras: "configuracoes.cadastros.valor_pacotes",
  diario: "configuracoes.cadastros.valor_diario",
  colonia: "configuracoes.cadastros.valor_colonia",
  biblioteca: "configuracoes.cadastros.valor_biblioteca",
} as const satisfies Record<string, ChavePermissao>;

export type TipoCadastro = keyof typeof CHAVE_POR_TIPO;

export const TIPOS_CADASTRO = (Object.keys(CHAVE_POR_TIPO) as TipoCadastro[]).map((id) => ({
  id,
  label: noPorChave(CHAVE_POR_TIPO[id])!.nome,
}));

export function tipoCadastroValido(v: unknown): v is TipoCadastro {
  return typeof v === "string" && v in CHAVE_POR_TIPO;
}

export function chaveCadastro(tipo: TipoCadastro): ChavePermissao {
  return CHAVE_POR_TIPO[tipo];
}

// Cadastros de valor por unidade × ano letivo visíveis para o usuário, na ordem da árvore.
export function abasCadastrosGerais(canView: (c: ChavePermissao) => boolean): TipoCadastro[] {
  const porChave = new Map<string, TipoCadastro>(
    (Object.keys(CHAVE_POR_TIPO) as TipoCadastro[]).map((id) => [CHAVE_POR_TIPO[id], id]),
  );
  return abasDe("configuracoes.cadastros")
    .filter((a) => canView(a.chave))
    .map((a) => porChave.get(a.chave))
    .filter((t): t is TipoCadastro => t !== undefined);
}

export function CadastrosGerais() {
  const { canView, canEdit } = usePermissions();
  const { selected, schools } = useSchool();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cadastro?: TipoCadastro };
  const anosFn = useServerFn(anosLetivosDiario);
  const abas = abasCadastrosGerais(canView);
  const veDiario = abas.includes("diario");

  const opcoes = abas.map((id) => TIPOS_CADASTRO.find((t) => t.id === id)!);
  const tipo: TipoCadastro | "" =
    search.cadastro && abas.includes(search.cadastro) ? search.cadastro : "";

  const anos = useQuery({
    queryKey: ["diario_anos_letivos"],
    enabled: veDiario,
    queryFn: async () => anosFn({ data: undefined }),
  });

  if (abas.length === 0) return null;

  const escolher = (v: string) => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        cadastro: tipoCadastroValido(v) ? v : undefined,
      }),
      replace: true,
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">Tipo de cadastro</Label>
          <Select value={tipo} onValueChange={escolher}>
            <SelectTrigger className="h-9 w-80">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {tipo === "" && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <ClipboardList className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Selecione um tipo de cadastro acima</p>
          <p className="max-w-md text-xs text-muted-foreground">
            O cadastro aparece depois da escolha do tipo.
          </p>
        </div>
      )}
      {tipo === "material" && (
        <MaterialPedagogicoSeries podeEditar={canEdit(chaveCadastro("material"))} />
      )}
      {tipo === "matricula" && (
        <ValoresMatricula podeEditar={canEdit(chaveCadastro("matricula"))} />
      )}
      {tipo === "pacotes_extras" && (
        <ValorPacotesExtras podeEditar={canEdit(chaveCadastro("pacotes_extras"))} />
      )}
      {tipo === "diario" && (
        <TabelaPrecos
          unidade={unidadeDaSelecao(selected, schools)}
          anoVigente={anos.data?.anoVigente ?? null}
          podeEditar={canEdit(chaveCadastro("diario"))}
        />
      )}
      {tipo === "colonia" && <ValoresColonia podeEditar={canEdit(chaveCadastro("colonia"))} />}
      {tipo === "biblioteca" && (
        <ValoresBiblioteca podeEditar={canEdit(chaveCadastro("biblioteca"))} />
      )}
    </div>
  );
}
