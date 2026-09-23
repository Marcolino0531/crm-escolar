// Denominador do card "Inadimplência Anual" do Dashboard, seguindo a mesma
// janela por ano da tela de Inadimplência (janelaAnual): em 2026 o extrato só
// existe desde junho e Jan–Mai vem de schools.faturamento_retroativo_jan_mai;
// de 2027 em diante o extrato cobre o ano inteiro e o retroativo é ignorado.

import {
  faturamentoRecebido,
  type JanelaAnual,
  type ReceitaExtrato,
} from "./inadimplencia-faturamento";
import type { IdsFinanceiros } from "./dashboard-financeiro";

export interface RetroativoAno {
  retroativoAno: number;
  /** false só quando a janela exige retroativo e a unidade não o tem informado. */
  retroativoConfigurado: boolean;
}

/** `selected === "all"` soma as unidades acessíveis; unidade sem valor não conta. */
export function retroativoParaJanela(
  janela: Pick<JanelaAnual, "usaRetroativo">,
  selected: string,
  schoolIds: readonly string[],
  retroativoPorSchool: ReadonlyMap<string, number | null>,
): RetroativoAno {
  if (!janela.usaRetroativo) return { retroativoAno: 0, retroativoConfigurado: true };
  if (selected === "all") {
    const valores = schoolIds
      .map((id) => retroativoPorSchool.get(id))
      .filter((v): v is number => v != null);
    return {
      retroativoAno: valores.reduce((a, b) => a + b, 0),
      retroativoConfigurado: valores.length > 0,
    };
  }
  const v = retroativoPorSchool.get(selected);
  return { retroativoAno: v ?? 0, retroativoConfigurado: v != null };
}

/** Linhas do extrato dentro de [receitasDesdeYMD, fimYMD], já com as exclusões operacionais. */
export function faturamentoTotalAnual(
  janela: Pick<JanelaAnual, "receitasDesdeYMD" | "fimYMD" | "usaRetroativo">,
  retroativoAno: number,
  receitas: readonly (ReceitaExtrato & { date: string })[],
  ids: IdsFinanceiros,
): number {
  const noPeriodo = receitas.filter(
    (r) => r.date >= janela.receitasDesdeYMD && r.date <= janela.fimYMD,
  );
  return (janela.usaRetroativo ? retroativoAno : 0) + faturamentoRecebido(noPeriodo, ids);
}
