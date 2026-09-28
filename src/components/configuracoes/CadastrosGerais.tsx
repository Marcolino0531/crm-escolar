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
import { usePermissions, useSchool, type AppModule } from "@/lib/app-context";
import { unidadeDaSelecao } from "@/lib/esportes-unidades";
import { anosLetivosDiario } from "@/lib/rematricula.functions";

export const TIPOS_CADASTRO = [
  { id: "material", label: "Valor Material Pedagógico" },
  { id: "matricula", label: "Valor Matrícula" },
  { id: "pacotes_extras", label: "Valor Pacotes Extras" },
  { id: "diario", label: "Valor Diário do Aluno" },
  { id: "colonia", label: "Valor Colônia de Férias" },
  { id: "biblioteca", label: "Valor Biblioteca" },
] as const;

export type TipoCadastro = (typeof TIPOS_CADASTRO)[number]["id"];

export function tipoCadastroValido(v: unknown): v is TipoCadastro {
  return TIPOS_CADASTRO.some((t) => t.id === v);
}

// Cadastros de valor por unidade × ano letivo. Cada opção segue a permissão do
// módulo dono do dado (Matrícula, Diário financeiro, Colônia, Biblioteca).
export function abasCadastrosGerais(canView: (m: AppModule) => boolean): TipoCadastro[] {
  const abas: TipoCadastro[] = [];
  if (canView("rematricula")) abas.push("material", "matricula", "pacotes_extras");
  if (canView("diario_financeiro")) abas.push("diario");
  if (canView("colonia") || canView("colonia_financeiro")) abas.push("colonia");
  if (canView("biblioteca")) abas.push("biblioteca");
  return abas;
}

export function CadastrosGerais() {
  const { canView, canEdit } = usePermissions();
  const { selected, schools } = useSchool();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cadastro?: TipoCadastro };
  const anosFn = useServerFn(anosLetivosDiario);
  const abas = abasCadastrosGerais(canView);
  const veDiario = abas.includes("diario");

  const opcoes = TIPOS_CADASTRO.filter((t) => abas.includes(t.id)).sort((a, b) =>
    a.label.localeCompare(b.label, "pt-BR"),
  );
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
      {tipo === "material" && <MaterialPedagogicoSeries podeEditar={canEdit("rematricula")} />}
      {tipo === "matricula" && <ValoresMatricula podeEditar={canEdit("rematricula")} />}
      {tipo === "pacotes_extras" && <ValorPacotesExtras podeEditar={canEdit("rematricula")} />}
      {tipo === "diario" && (
        <TabelaPrecos
          unidade={unidadeDaSelecao(selected, schools)}
          anoVigente={anos.data?.anoVigente ?? null}
          podeEditar={canEdit("diario_financeiro")}
        />
      )}
      {tipo === "colonia" && <ValoresColonia podeEditar={canEdit("colonia_financeiro")} />}
      {tipo === "biblioteca" && <ValoresBiblioteca podeEditar={canEdit("biblioteca")} />}
    </div>
  );
}
