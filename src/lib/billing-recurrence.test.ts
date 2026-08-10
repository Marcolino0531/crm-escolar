import { describe, expect, it } from "vitest";

import {
  addDiasUteis,
  agruparPorResponsavel,
  chaveTelefone,
  jaCobradoHoje,
  juntarNomes,
  parcelaQuitada,
  parcelasCobraveis,
  primeiroDiaCobranca,
  toleranciaCumprida,
  vencimentosEntrandoEmCobranca,
  type ParcelaCobranca,
} from "./billing-recurrence";

const DATA_BASE = "2026-08-01";

function parcela(over: Partial<ParcelaCobranca> = {}): ParcelaCobranca {
  return {
    alunoId: "883",
    alunoNome: "Anthony Castilho Marques",
    unidade: "CEC Baby",
    telefone: "(31) 98631-1522",
    responsavelNome: "Maria Castilho",
    vencimento: "2026-08-05",
    saldo: 1000,
    ...over,
  };
}

describe("tolerância de 2 dias úteis", () => {
  it("conta apenas dias úteis a partir do vencimento", () => {
    // Quarta 05/08 → quinta (1) → sexta (2).
    expect(addDiasUteis("2026-08-05", 2)).toBe("2026-08-07");
    expect(primeiroDiaCobranca("2026-08-05")).toBe("2026-08-07");
  });

  it("pula fim de semana: vencimento na quinta só é cobrado na segunda", () => {
    // Quinta 06/08 → sexta (1) → sábado/domingo não contam → segunda (2).
    expect(primeiroDiaCobranca("2026-08-06")).toBe("2026-08-10");
  });

  it("vencimento no sábado começa a cobrar na terça", () => {
    // Sábado 08/08 → segunda (1) → terça (2).
    expect(primeiroDiaCobranca("2026-08-08")).toBe("2026-08-11");
  });

  it("pula feriado nacional na contagem", () => {
    // Sexta 04/09 → segunda 07/09 é Independência → terça (1) → quarta (2).
    expect(primeiroDiaCobranca("2026-09-04")).toBe("2026-09-09");
  });

  it("cobra em todos os dias úteis a partir do 1º dia, não só nele", () => {
    expect(toleranciaCumprida("2026-08-05", "2026-08-06")).toBe(false); // dentro da tolerância
    expect(toleranciaCumprida("2026-08-05", "2026-08-07")).toBe(true); // 1º dia
    expect(toleranciaCumprida("2026-08-05", "2026-08-10")).toBe(true); // recorrência
    expect(toleranciaCumprida("2026-08-05", "2026-08-11")).toBe(true);
  });

  it("nunca cobra em sábado, domingo ou feriado", () => {
    expect(toleranciaCumprida("2026-08-05", "2026-08-08")).toBe(false); // sábado
    expect(toleranciaCumprida("2026-08-05", "2026-08-09")).toBe(false); // domingo
    expect(toleranciaCumprida("2026-08-05", "2026-09-07")).toBe(false); // Independência
  });

  it("lista os vencimentos que entram em cobrança hoje", () => {
    // Segunda 10/08: vence a tolerância dos vencimentos de quinta 06/08 e do
    // fim de semana (07/08 é sexta → só entra na terça).
    expect(vencimentosEntrandoEmCobranca("2026-08-10")).toEqual(["2026-08-06"]);
    expect(vencimentosEntrandoEmCobranca("2026-08-11")).toEqual([
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(vencimentosEntrandoEmCobranca("2026-08-08")).toEqual([]); // sábado
  });
});

describe("parada do disparo após o pagamento", () => {
  it("considera quitada a parcela com data de pagamento no Sponte", () => {
    expect(parcelaQuitada(parcela({ dataPagamento: "2026-08-10" }))).toBe(true);
    expect(parcelaQuitada(parcela({ dataPagamento: "" }))).toBe(false);
  });

  it("considera quitada a parcela com saldo zerado ou negativo", () => {
    expect(parcelaQuitada(parcela({ saldo: 0 }))).toBe(true);
    expect(parcelaQuitada(parcela({ saldo: -5 }))).toBe(true);
    expect(parcelaQuitada(parcela({ saldo: 0.5 }))).toBe(false);
  });

  it("remove do disparo do dia a parcela paga no próprio dia", () => {
    const parcelas = [
      parcela({ alunoId: "883", dataPagamento: "2026-08-11" }),
      parcela({ alunoId: "554", telefone: "(31) 99500-6385" }),
    ];
    const cobraveis = parcelasCobraveis(parcelas, "2026-08-11", DATA_BASE);
    expect(cobraveis.map((p) => p.alunoId)).toEqual(["554"]);
  });

  it("ignora parcelas futuras, dentro da tolerância e anteriores à data base", () => {
    const parcelas = [
      parcela({ alunoId: "1", vencimento: "2026-08-20" }), // futura
      parcela({ alunoId: "2", vencimento: "2026-08-10" }), // vencida ontem → em tolerância
      parcela({ alunoId: "3", vencimento: "2026-07-10" }), // antes da data base
      parcela({ alunoId: "4", vencimento: "2026-08-05" }), // cobrável
    ];
    const cobraveis = parcelasCobraveis(parcelas, "2026-08-11", DATA_BASE);
    expect(cobraveis.map((p) => p.alunoId)).toEqual(["4"]);
  });
});

describe("agrupamento em uma mensagem diária por responsável", () => {
  it("junta parcelas de alunos diferentes do mesmo telefone num único grupo", () => {
    const parcelas = [
      parcela({ alunoId: "10", alunoNome: "Cauã Machado Rocha", vencimento: "2026-08-05" }),
      parcela({ alunoId: "11", alunoNome: "Maria Flor Machado Rocha", vencimento: "2026-08-04" }),
    ];
    const grupos = agruparPorResponsavel(
      parcelasCobraveis(parcelas, "2026-08-11", DATA_BASE),
      "2026-08-11",
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].alunoIds).toEqual(["11", "10"]);
    expect(grupos[0].alunosLabel).toBe("Maria Flor Machado Rocha e Cauã Machado Rocha");
    expect(grupos[0].vencimentoMaisAntigo).toBe("2026-08-04");
    expect(grupos[0].multipla).toBe(true);
  });

  it("separa responsáveis diferentes, um grupo por telefone", () => {
    const parcelas = [
      parcela({ alunoId: "10", telefone: "(31) 98631-1522" }),
      parcela({ alunoId: "20", telefone: "31995006385" }),
      parcela({ alunoId: "21", telefone: "+55 (31) 99500-6385" }),
    ];
    const grupos = agruparPorResponsavel(
      parcelasCobraveis(parcelas, "2026-08-11", DATA_BASE),
      "2026-08-11",
    );
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.alunoIds.length).sort()).toEqual([1, 2]);
  });

  it("casa o telefone pelos últimos 8 dígitos, indiferente a DDI/formatação", () => {
    expect(chaveTelefone("(31) 98631-1522")).toBe("86311522");
    expect(chaveTelefone("+55 31 98631-1522")).toBe("86311522");
    expect(chaveTelefone("")).toBe("");
  });

  it("soma o total atualizado de todas as parcelas vencidas do responsável", () => {
    const parcelas = [
      parcela({ alunoId: "10", vencimento: "2026-08-05", saldo: 1000 }),
      parcela({ alunoId: "10", vencimento: "2026-07-05", saldo: 1000 }),
    ];
    const grupos = agruparPorResponsavel(
      parcelasCobraveis(parcelas, "2026-08-11", DATA_BASE),
      "2026-08-11",
    );
    // Só 05/08 é cobrável (07/05 é anterior à data base), mas o total considera
    // as duas vencidas quando o mapa de vencidas do aluno é informado.
    const comTotal = agruparPorResponsavel(
      parcelasCobraveis(parcelas, "2026-08-11", DATA_BASE),
      "2026-08-11",
      new Map([
        [
          "10",
          [
            { vencimento: "2026-08-05", saldo: 1000 },
            { vencimento: "2026-07-05", saldo: 1000 },
          ],
        ],
      ]),
    );
    expect(grupos[0].totalAtualizado).toBeCloseTo(1022, 0);
    expect(comTotal[0].totalAtualizado).toBeGreaterThan(2040);
    expect(comTotal[0].multipla).toBe(true);
  });

  it("marca como simples o responsável com uma única parcela de um aluno", () => {
    const grupos = agruparPorResponsavel(
      parcelasCobraveis([parcela({ alunoId: "10" })], "2026-08-11", DATA_BASE),
      "2026-08-11",
    );
    expect(grupos[0].multipla).toBe(false);
    expect(grupos[0].alunosLabel).toBe("Anthony Castilho Marques");
  });

  it("formata a lista de alunos em português", () => {
    expect(juntarNomes(["Ana"])).toBe("Ana");
    expect(juntarNomes(["Ana", "Bia"])).toBe("Ana e Bia");
    expect(juntarNomes(["Ana", "Bia", "Caio"])).toBe("Ana, Bia e Caio");
    expect(juntarNomes(["Ana", "Ana"])).toBe("Ana");
  });
});

describe("idempotência do disparo diário", () => {
  it("não repete o envio para quem já foi cobrado hoje", () => {
    const enviadosHoje = ["(31) 98631-1522"];
    expect(jaCobradoHoje(enviadosHoje, "+55 31 98631-1522")).toBe(true);
    expect(jaCobradoHoje(enviadosHoje, "31995006385")).toBe(false);
    expect(jaCobradoHoje([], "(31) 98631-1522")).toBe(false);
  });
});
