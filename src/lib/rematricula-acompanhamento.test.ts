import { describe, expect, it } from "vitest";
import {
  contadoresAcompanhamento,
  filtrarAcompanhamento,
  filtrarPorStatus,
  montarLinhasAcompanhamento,
  ordenarAcompanhamento,
  type AcessoAcompanhamento,
  type AlunoAtivoAcompanhamento,
  type EscolhaAcompanhamento,
} from "./rematricula-acompanhamento";

const alunos: AlunoAtivoAcompanhamento[] = [
  { alunoId: "1", nome: "Ana", unidade: "CEC", turma: "1º Ano" },
  { alunoId: "2", nome: "Bruno", unidade: "CEC", turma: "1º Ano" },
  { alunoId: "3", nome: "Carla", unidade: "CEC", turma: "2º Ano" },
  { alunoId: "4", nome: "Davi", unidade: "CEC", turma: "2º Ano" },
  // Mesmo AlunoID de outra unidade: o cruzamento é por (unidade, alunoId).
  { alunoId: "1", nome: "Elisa", unidade: "Núcleo Belvedere", turma: "3º Ano" },
];

const escolha = (
  unidade: string,
  alunoId: string,
  status: EscolhaAcompanhamento["status"],
): EscolhaAcompanhamento => ({
  id: `escolha-${unidade}-${alunoId}`,
  unidade,
  alunoId,
  serie: "1º Ano",
  valorAnual: 1000,
  parcelas: 3,
  valorParcela: 333.33,
  valorPrimeiraParcela: 333.34,
  anoLetivo: 2027,
  status,
  atualizadoEm: "2026-08-20T12:00:00.000Z",
  sponteContaReceberId: status === "lancada" ? "12900" : "",
  sponteErro: "",
});

const escolhas: EscolhaAcompanhamento[] = [
  escolha("CEC", "3", "pendente_lancamento"),
  escolha("CEC", "4", "lancada"),
  escolha("Núcleo Belvedere", "1", "pendente_lancamento"),
];

const acessos: AcessoAcompanhamento[] = [
  { unidade: "CEC", alunoId: "2", ultimoAcessoEm: "2026-08-21T09:00:00.000Z" },
];

const linhas = montarLinhasAcompanhamento({
  alunos,
  escolhas,
  acessos,
  cadastroAlterados: [{ unidade: "CEC", alunoId: "3" }],
});

describe("linhas de acompanhamento da rematrícula", () => {
  it("gera uma linha por aluno ativo, com o status derivado do que foi persistido", () => {
    expect(linhas).toHaveLength(alunos.length);
    const porNome = new Map(linhas.map((l) => [l.nome, l]));
    expect(porNome.get("Ana")!.status).toBe("nao_iniciado");
    expect(porNome.get("Bruno")!.status).toBe("em_andamento");
    expect(porNome.get("Carla")!.status).toBe("aguardando_aprovacao");
    expect(porNome.get("Davi")!.status).toBe("rematriculado");
    expect(porNome.get("Elisa")!.status).toBe("aguardando_aprovacao");
  });

  it("mostra o parcelamento escolhido e o indicador de dado cadastral alterado", () => {
    const carla = linhas.find((l) => l.nome === "Carla")!;
    // O Intl usa espaço não-quebrável depois de "R$".
    expect(carla.parcelamento.replace(/\u00a0/g, " ")).toBe("3x de R$ 333,33 (1ª de R$ 333,34)");
    expect(carla.cadastroAlterado).toBe(true);
    expect(carla.atualizadoEm).toBe("2026-08-20T12:00:00.000Z");
    const ana = linhas.find((l) => l.nome === "Ana")!;
    expect(ana.parcelamento).toBe("");
    expect(ana.cadastroAlterado).toBe(false);
    expect(ana.atualizadoEm).toBeNull();
  });

  it("ordena pendências primeiro e rematriculado por último", () => {
    expect(ordenarAcompanhamento(linhas).map((l) => l.status)).toEqual([
      "nao_iniciado",
      "em_andamento",
      "aguardando_aprovacao",
      "aguardando_aprovacao",
      "rematriculado",
    ]);
  });

  it("filtra por unidade e por nome", () => {
    expect(filtrarAcompanhamento(linhas, { unidade: "CEC" })).toHaveLength(4);
    expect(
      filtrarAcompanhamento(linhas, {
        unidadesPermitidas: ["CEC", "Núcleo Belvedere"],
      }),
    ).toHaveLength(5);
    expect(filtrarAcompanhamento(linhas, { unidadesPermitidas: ["CEC"] })).toHaveLength(4);
    expect(
      filtrarAcompanhamento(linhas, { unidade: null, busca: " car " }).map((l) => l.nome),
    ).toEqual(["Carla"]);
  });
});

describe("cards de resumo x tabela filtrada por status", () => {
  it("bate com a contagem real da tabela em cada filtro de status", () => {
    for (const filtro of [
      { unidade: null as string | null, unidadesPermitidas: ["CEC", "Núcleo Belvedere"] },
      { unidade: "CEC" as string | null, unidadesPermitidas: ["CEC", "Núcleo Belvedere"] },
      {
        unidade: "Núcleo Belvedere" as string | null,
        unidadesPermitidas: ["CEC", "Núcleo Belvedere"],
      },
    ]) {
      const base = filtrarAcompanhamento(linhas, filtro);
      const cards = contadoresAcompanhamento(base);

      expect(cards.total).toBe(filtrarPorStatus(base, "todos").length);
      expect(cards.aguardandoAprovacao).toBe(filtrarPorStatus(base, "aguardando_aprovacao").length);
      expect(cards.responderam).toBe(
        filtrarPorStatus(base, "aguardando_aprovacao").length +
          filtrarPorStatus(base, "rematriculado").length,
      );
      expect(cards.naoResponderam).toBe(
        filtrarPorStatus(base, "nao_iniciado").length +
          filtrarPorStatus(base, "em_andamento").length,
      );
      expect(cards.responderam + cards.naoResponderam).toBe(cards.total);
    }
  });

  it("a busca por nome também reflete nos cards", () => {
    const base = filtrarAcompanhamento(linhas, { unidade: "CEC", busca: "a" });
    const cards = contadoresAcompanhamento(base);
    expect(cards.total).toBe(base.length);
    expect(cards.responderam).toBe(base.filter((l) => l.parcelamento !== "").length);
  });
});
