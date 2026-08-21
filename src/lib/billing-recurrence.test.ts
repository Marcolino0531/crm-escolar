import { describe, expect, it } from "vitest";

import {
  addDiasUteis,
  agruparPorResponsavel,
  chaveTelefone,
  comporLinhasDigitaveis,
  jaCobradoHoje,
  juntarNomes,
  parcelaQuitada,
  parcelasCobraveis,
  primeiroDiaCobranca,
  resolverContatoResponsavel,
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

describe("linha digitável de cada boleto da mensagem", () => {
  const heitor = {
    alunoNome: "Heitor Cordeiro Borges",
    valor: 180,
    linhaDigitavel: "11111.11111 11111.111111 11111.111111 1 11110000018000",
  };
  const vicente = {
    alunoNome: "Vicente Cordeiro Borges",
    valor: 100,
    linhaDigitavel: "22222.22222 22222.222222 22222.222222 2 22220000010000",
  };

  it("um boleto: devolve só a linha digitável, sem rótulo (formato atual)", () => {
    expect(comporLinhasDigitaveis([heitor])).toBe(heitor.linhaDigitavel);
  });

  it("vários boletos: cada linha vem com o aluno e o valor do boleto certo", () => {
    expect(comporLinhasDigitaveis([heitor, vicente])).toBe(
      `Heitor Cordeiro Borges: R$ 180,00, linha digitável ${heitor.linhaDigitavel}; ` +
        `Vicente Cordeiro Borges: R$ 100,00, linha digitável ${vicente.linhaDigitavel}`,
    );
  });

  it("ignora boletos sem linha digitável, mantendo as demais", () => {
    const semLinha = { alunoNome: "Sem Boleto", valor: 50, linhaDigitavel: "" };
    expect(comporLinhasDigitaveis([semLinha, heitor])).toBe(heitor.linhaDigitavel);
    expect(comporLinhasDigitaveis([semLinha])).toBe("");
    expect(comporLinhasDigitaveis([])).toBe("");
  });

  it("formata valores com milhar e mantém tudo em uma única linha", () => {
    const composto = comporLinhasDigitaveis([
      { alunoNome: "Lara", valor: 1936.7, linhaDigitavel: "linha-lara" },
      { alunoNome: " Pedro \n", valor: 408.98, linhaDigitavel: "linha-pedro" },
    ]);
    expect(composto).toBe(
      "Lara: R$ 1.936,70, linha digitável linha-lara; " +
        "Pedro: R$ 408,98, linha digitável linha-pedro",
    );
    expect(composto).not.toMatch(/[\n\t]/);
  });
});

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

describe("responsável financeiro atual no momento do disparo", () => {
  // Caso real: Luísa Mascarenhas (AlunoID 862) teve o responsável financeiro
  // trocado do pai para a mãe no Sponte; o histórico de disparos ainda guarda o
  // telefone do pai.
  const HISTORICO = { nome: "Areno Mascarenhas da Silva", telefone: "(31) 99110-8686" };
  const SPONTE = { nome: "Michelle Batista Marcelino", telefone: "(31) 99430-0959" };

  it("troca recente redireciona a cobrança para o responsável atual", () => {
    const contato = resolverContatoResponsavel(HISTORICO, SPONTE);
    expect(contato.telefone).toBe("(31) 99430-0959");
    expect(contato.nome).toBe("Michelle Batista Marcelino");
    expect(contato.origem).toBe("sponte");
    expect(contato.trocou).toBe(true);
  });

  it("sem troca, o contato do Sponte confirma o histórico", () => {
    const contato = resolverContatoResponsavel(HISTORICO, { ...HISTORICO });
    expect(contato.telefone).toBe(HISTORICO.telefone);
    expect(contato.trocou).toBe(false);
    expect(contato.origem).toBe("sponte");
  });

  it("mesma pessoa com o número reformatado não conta como troca", () => {
    const contato = resolverContatoResponsavel(HISTORICO, {
      nome: HISTORICO.nome,
      telefone: "+55 (31) 9 9110-8686",
    });
    expect(contato.trocou).toBe(false);
    expect(contato.telefone).toBe("+55 (31) 9 9110-8686");
  });

  it("responsável atual sem telefone no cadastro não cai no número antigo", () => {
    const contato = resolverContatoResponsavel(HISTORICO, {
      nome: "Debora Larissa Santos Ribeiro",
      telefone: "",
    });
    expect(contato.telefone).toBe("");
    expect(contato.nome).toBe("Debora Larissa Santos Ribeiro");
    expect(chaveTelefone(contato.telefone)).toBe("");
  });

  it("falha na consulta ao Sponte mantém o contato do histórico", () => {
    const contato = resolverContatoResponsavel(HISTORICO, null);
    expect(contato).toEqual({ ...HISTORICO, origem: "historico", trocou: false });
  });

  it("Sponte sem nome preserva o nome conhecido do histórico", () => {
    const contato = resolverContatoResponsavel(HISTORICO, { nome: "", telefone: SPONTE.telefone });
    expect(contato.nome).toBe(HISTORICO.nome);
    expect(contato.telefone).toBe(SPONTE.telefone);
  });

  it("o agrupamento de irmãos passa a usar o telefone atual", () => {
    const contato = resolverContatoResponsavel(HISTORICO, SPONTE);
    const grupos = agruparPorResponsavel(
      parcelasCobraveis(
        [
          parcela({ alunoId: "862", telefone: contato.telefone, responsavelNome: contato.nome }),
          parcela({ alunoId: "863", telefone: contato.telefone, responsavelNome: contato.nome }),
          // Irmão cujo cadastro ainda aponta para o responsável antigo fica em outro grupo.
          parcela({ alunoId: "864", telefone: HISTORICO.telefone }),
        ],
        "2026-08-11",
        DATA_BASE,
      ),
      "2026-08-11",
    );
    expect(grupos).toHaveLength(2);
    const atual = grupos.find((g) => g.chave === chaveTelefone(SPONTE.telefone));
    expect(atual?.alunoIds).toEqual(["862", "863"]);
    expect(atual?.responsavelNome).toBe(SPONTE.nome);
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
