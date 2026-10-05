import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avisoDesfazerExclusao,
  chaveColaborador,
  semDescartados,
  totaisDasEmpresas,
} from "./folha-pagamento";

// Dados fictícios.
type Reg = {
  tipo: "empregado" | "contribuinte";
  codigo: string;
  proventos: number;
  descontos: number;
  liquido: number;
};

const reg = (codigo: string, proventos: number, descontos: number): Reg => ({
  tipo: "empregado",
  codigo,
  proventos,
  descontos,
  liquido: Math.round((proventos - descontos) * 100) / 100,
});

// Centavos "quebrados" de propósito: a soma em ponto flutuante erraria.
const FOLHA: Reg[] = [
  reg("1", 1518.1, 121.45),
  reg("2", 2405.47, 250.53),
  reg("3", 3333.33, 0.01),
  reg("4", 0.1, 0.2),
  reg("5", 1999.99, 433.07),
  { ...reg("6", 712.35, 0), tipo: "contribuinte" },
];

const centavos = (t: { proventos: number; descontos: number; liquido: number }) => ({
  proventos: Math.round(t.proventos * 100),
  descontos: Math.round(t.descontos * 100),
  liquido: Math.round(t.liquido * 100),
});

describe("totais da competência ao excluir e desfazer", () => {
  const original = totaisDasEmpresas(FOLHA);
  const alvo = FOLHA[1];

  it("excluir diminui exatamente o valor do colaborador", () => {
    const sem = totaisDasEmpresas(semDescartados(FOLHA, [chaveColaborador(alvo)]));
    expect(centavos(original).proventos - centavos(sem).proventos).toBe(240547);
    expect(centavos(original).descontos - centavos(sem).descontos).toBe(25053);
    expect(centavos(original).liquido - centavos(sem).liquido).toBe(215494);
    expect(sem.colaboradores).toBe(FOLHA.length - 1);
  });

  it("desfazer volta exatamente aos totais originais, centavo por centavo", () => {
    const sem = semDescartados(FOLHA, [chaveColaborador(alvo)]);
    const restaurada = totaisDasEmpresas([...sem, alvo]);
    expect(restaurada).toEqual(original);
    expect(centavos(restaurada)).toEqual(centavos(original));
  });

  it("excluir e desfazer cada um, um de cada vez, sempre volta ao original", () => {
    for (const r of FOLHA) {
      const sem = semDescartados(FOLHA, [chaveColaborador(r)]);
      expect(totaisDasEmpresas([...sem, r])).toEqual(original);
    }
  });

  it("contribuinte e empregado com o mesmo código são registros diferentes", () => {
    const folha = [...FOLHA, reg("6", 100, 10)];
    const sem = totaisDasEmpresas(semDescartados(folha, ["contribuinte:6"]));
    expect(sem.proventos).toBe(totaisDasEmpresas(folha).proventos - 712.35);
  });
});

describe("Belvedere 09/2026: totais após devolver o registro excluído por engano", () => {
  // Folha atual (sem os 7 excluídos e sem o registro desfeito) e o registro
  // devolvido. Só totais: nenhum dado pessoal.
  const atual = { proventos: 98338.89, descontos: 20374.36, liquido: 77964.53 };
  const devolvido = { proventos: 2405.47, descontos: 250.53, liquido: 2154.94 };

  it("proventos R$ 100.744,36, descontos R$ 20.624,89, líquido R$ 80.119,47", () => {
    expect(totaisDasEmpresas([atual, devolvido])).toEqual({
      proventos: 100744.36,
      descontos: 20624.89,
      liquido: 80119.47,
      colaboradores: 2,
    });
  });
});

describe("desfazer exclusão sem cópia guardada (anterior ao retrato)", () => {
  const sql = readFileSync(
    "supabase/migrations/20261128090000_rh_folha_exclusao_retrato.sql",
    "utf8",
  );
  const desfazer = sql.slice(sql.indexOf("FUNCTION public.rh_folha_desfazer_exclusao"));

  it("não recusa: apaga a exclusão e devolve restaurado false", () => {
    expect(desfazer).not.toMatch(/RAISE EXCEPTION '[^']*não guardou/);
    expect(desfazer).toMatch(
      /IF v_col_id IS NULL AND jsonb_typeof\(v_exc\.retrato->'colaborador'\) IS DISTINCT FROM 'object' THEN\s+v_sem_copia := true;/,
    );
    expect(desfazer).toContain("DELETE FROM public.rh_folha_exclusoes WHERE id = v_exc.id;");
    expect(desfazer).toContain("'restaurado', NOT v_sem_copia");
    expect(desfazer).toContain(
      "RETURN jsonb_build_object('restaurado', NOT v_sem_copia, 'sem_copia', v_sem_copia);",
    );
  });

  it("os totais não mudam até a reimportação do PDF", () => {
    const alvo = FOLHA[1];
    const excluida = totaisDasEmpresas(semDescartados(FOLHA, [chaveColaborador(alvo)]));
    const aposDesfazer = totaisDasEmpresas(semDescartados(FOLHA, [chaveColaborador(alvo)]));
    expect(aposDesfazer).toEqual(excluida);
    const reimportada = totaisDasEmpresas(FOLHA);
    expect(centavos(reimportada).liquido - centavos(aposDesfazer).liquido).toBe(215494);
  });

  it("aviso da tela", () => {
    expect(avisoDesfazerExclusao({ restaurado: false, semCopia: true })).toBe(
      "Exclusão desfeita. Este registro não tinha cópia guardada: importe de novo o PDF deste mês para ele voltar à folha.",
    );
    expect(avisoDesfazerExclusao({ restaurado: true, semCopia: false })).toBe(
      "Exclusão desfeita: o registro voltou para a folha.",
    );
    expect(avisoDesfazerExclusao({ restaurado: false, semCopia: false })).toBe(
      "Exclusão desfeita.",
    );
  });
});
