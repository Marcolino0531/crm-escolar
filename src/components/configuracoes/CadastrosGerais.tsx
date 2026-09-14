import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabelaPrecos } from "@/components/diario/TabelaPrecos";
import {
  MaterialPedagogicoSeries,
  ValoresMatricula,
} from "@/components/rematricula/MaterialPedagogicoSeries";
import { ValoresColonia } from "@/components/configuracoes/ValoresColonia";
import { usePermissions, useSchool, type AppModule } from "@/lib/app-context";
import { unidadeDaSelecao } from "@/lib/esportes-unidades";
import { anosLetivosDiario } from "@/lib/rematricula.functions";

// Cadastros de valor por unidade × ano letivo. Cada sub-aba segue a permissão
// do módulo dono do dado (Matrícula, Diário financeiro, Colônia).
export function abasCadastrosGerais(canView: (m: AppModule) => boolean): string[] {
  const abas: string[] = [];
  if (canView("rematricula")) abas.push("material", "matricula");
  if (canView("diario_financeiro")) abas.push("diario");
  if (canView("colonia") || canView("colonia_financeiro")) abas.push("colonia");
  return abas;
}

export function CadastrosGerais() {
  const { canView, canEdit } = usePermissions();
  const { selected, schools } = useSchool();
  const anosFn = useServerFn(anosLetivosDiario);
  const abas = abasCadastrosGerais(canView);
  const veDiario = abas.includes("diario");

  const anos = useQuery({
    queryKey: ["diario_anos_letivos"],
    enabled: veDiario,
    queryFn: async () => anosFn({ data: undefined }),
  });

  if (abas.length === 0) return null;

  return (
    <Tabs defaultValue={abas[0]}>
      <TabsList>
        {abas.includes("material") && (
          <TabsTrigger value="material">Valor Material Pedagógico</TabsTrigger>
        )}
        {abas.includes("matricula") && <TabsTrigger value="matricula">Valor Matrícula</TabsTrigger>}
        {veDiario && <TabsTrigger value="diario">Valor Diário do Aluno</TabsTrigger>}
        {abas.includes("colonia") && (
          <TabsTrigger value="colonia">Valor Colônia de Férias</TabsTrigger>
        )}
      </TabsList>
      {abas.includes("material") && (
        <TabsContent value="material" className="mt-4">
          <MaterialPedagogicoSeries podeEditar={canEdit("rematricula")} />
        </TabsContent>
      )}
      {abas.includes("matricula") && (
        <TabsContent value="matricula" className="mt-4">
          <ValoresMatricula podeEditar={canEdit("rematricula")} />
        </TabsContent>
      )}
      {veDiario && (
        <TabsContent value="diario" className="mt-4">
          <TabelaPrecos
            unidade={unidadeDaSelecao(selected, schools)}
            anoVigente={anos.data?.anoVigente ?? null}
            podeEditar={canEdit("diario_financeiro")}
          />
        </TabsContent>
      )}
      {abas.includes("colonia") && (
        <TabsContent value="colonia" className="mt-4">
          <ValoresColonia podeEditar={canEdit("colonia_financeiro")} />
        </TabsContent>
      )}
    </Tabs>
  );
}
