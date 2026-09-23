import { describe, expect, it } from "vitest";
import { IDS_VAZIOS, type IdsFinanceiros } from "./dashboard-financeiro";
import { janelaAnual, faturamentoRecebido, type ReceitaExtrato } from "./inadimplencia-faturamento";
import { faturamentoTotalAnual, retroativoParaJanela } from "./dashboard-inadimplencia-anual";

const ids: IdsFinanceiros = { ...IDS_VAZIOS, resgateInvestimento: "cat-resgate" };

type Linha = ReceitaExtrato & { date: string };
const receitas: Linha[] = [
  { date: "2026-02-10", amount: 800, description: "PIX FEV", revenue_category_id: null },
  { date: "2026-06-05", amount: 1000, description: "PIX JUN", revenue_category_id: null },
  { date: "2026-09-01", amount: 500, description: "COB COMPE", revenue_category_id: null },
  { date: "2026-09-02", amount: 3000, description: "RESGATE", revenue_category_id: "cat-resgate" },
  { date: "2026-12-20", amount: 700, description: "FUTURO", revenue_category_id: null },
  { date: "2027-01-15", amount: 900, description: "PIX JAN 27", revenue_category_id: null },
  { date: "2027-03-15", amount: 600, description: "PIX MAR 27", revenue_category_id: null },
];

const retroativos = new Map<string, number | null>([
  ["cec", 10000],
  ["baby", 5000],
  ["belv", null],
]);

// Réplica da regra inline da tela de Inadimplência (src/routes/inadimplencia.tsx).
function telaInadimplencia(ano: number, hoje: string, selected: string, schoolIds: string[]) {
  const janela = janelaAnual(ano, hoje);
  let retroativoAno = 0;
  let configurado = true;
  if (janela.usaRetroativo) {
    if (selected === "all") {
      const v = schoolIds.map((id) => retroativos.get(id)).filter((x): x is number => x != null);
      retroativoAno = v.reduce((a, b) => a + b, 0);
      configurado = v.length > 0;
    } else {
      const v = retroativos.get(selected);
      retroativoAno = v ?? 0;
      configurado = v != null;
    }
  }
  const rows = receitas.filter((r) => r.date >= janela.receitasDesdeYMD && r.date <= janela.fimYMD);
  return { configurado, total: retroativoAno + faturamentoRecebido(rows, ids) };
}

describe("card Inadimplência Anual por ano", () => {
  it("2026: retroativo Jan–Mai + receitas de 01/06 até hoje (idêntico ao cálculo antigo)", () => {
    const janela = janelaAnual(2026, "2026-09-19");
    const r = retroativoParaJanela(janela, "cec", ["cec"], retroativos);
    expect(r).toEqual({ retroativoAno: 10000, retroativoConfigurado: true });
    const total = faturamentoTotalAnual(janela, r.retroativoAno, receitas, ids);
    // antigo: retroativo + extrato >= 2026-06-01 e <= hoje, sem resgate
    const antigo =
      10000 +
      faturamentoRecebido(
        receitas.filter((x) => x.date >= "2026-06-01" && x.date <= "2026-09-19"),
        ids,
      );
    expect(total).toBe(antigo);
    expect(total).toBe(10000 + 1000 + 500);
  });

  it("2027: receitas de 01/01 até hoje, retroativo ignorado mesmo configurado", () => {
    const janela = janelaAnual(2027, "2027-03-31");
    const r = retroativoParaJanela(janela, "cec", ["cec"], retroativos);
    expect(r).toEqual({ retroativoAno: 0, retroativoConfigurado: true });
    expect(faturamentoTotalAnual(janela, 10000, receitas, ids)).toBe(900 + 600);
  });

  it("2027 com retroativo não configurado calcula normalmente, sem trava", () => {
    const janela = janelaAnual(2027, "2027-02-01");
    expect(retroativoParaJanela(janela, "belv", ["belv"], retroativos)).toEqual({
      retroativoAno: 0,
      retroativoConfigurado: true,
    });
    // Em 2026 a mesma unidade fica travada (comportamento atual preservado).
    expect(
      retroativoParaJanela(janelaAnual(2026, "2026-09-19"), "belv", ["belv"], retroativos)
        .retroativoConfigurado,
    ).toBe(false);
  });

  it("consolidado soma só as unidades com retroativo informado", () => {
    const janela = janelaAnual(2026, "2026-09-19");
    expect(retroativoParaJanela(janela, "all", ["cec", "baby", "belv"], retroativos)).toEqual({
      retroativoAno: 15000,
      retroativoConfigurado: true,
    });
  });

  it("paridade com a tela de Inadimplência em 2026 e 2027", () => {
    for (const [ano, hoje] of [
      [2026, "2026-09-19"],
      [2027, "2027-03-31"],
    ] as const) {
      for (const sel of ["cec", "belv", "all"]) {
        const janela = janelaAnual(ano, hoje);
        const r = retroativoParaJanela(janela, sel, ["cec", "baby", "belv"], retroativos);
        const esperado = telaInadimplencia(ano, hoje, sel, ["cec", "baby", "belv"]);
        expect(r.retroativoConfigurado).toBe(esperado.configurado);
        expect(faturamentoTotalAnual(janela, r.retroativoAno, receitas, ids)).toBe(esperado.total);
      }
    }
  });
});
