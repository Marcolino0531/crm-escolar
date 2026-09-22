import { describe, expect, it } from "vitest";

import {
  backfillTestemunhasPorUnidade,
  testemunhasDaUnidade,
  type TestemunhaDocumento,
} from "./testemunhas";

const UNIDADES = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

const globais: TestemunhaDocumento[] = [
  {
    unidade: "",
    ordem: 1,
    nome: "Márcia Regina Ribeiro Marcolino",
    cpf: "631.466.656-20",
    email: "marcia@ex.com",
    celular: "(31) 99999-0001",
    ativa: true,
  },
  {
    unidade: "",
    ordem: 2,
    nome: "Anna Clara Marcolino Ribeiro",
    cpf: "157.432.546-99",
    email: "anna@ex.com",
    celular: "(31) 99999-0002",
    ativa: true,
  },
];

describe("backfillTestemunhasPorUnidade", () => {
  it("cada uma das 4 unidades fica com as 2 testemunhas atuais, dados preservados", () => {
    const linhas = backfillTestemunhasPorUnidade(globais, UNIDADES);
    expect(linhas).toHaveLength(8);
    for (const u of UNIDADES) {
      const t = testemunhasDaUnidade(linhas, u);
      expect(t.map((x) => [x.ordem, x.nome, x.cpf, x.email, x.celular])).toEqual([
        [
          1,
          "Márcia Regina Ribeiro Marcolino",
          "631.466.656-20",
          "marcia@ex.com",
          "(31) 99999-0001",
        ],
        [2, "Anna Clara Marcolino Ribeiro", "157.432.546-99", "anna@ex.com", "(31) 99999-0002"],
      ]);
    }
    expect(linhas.some((l) => l.unidade === "")).toBe(false);
  });

  it("é idempotente e não copia inativas nem sobrescreve ordem já ocupada", () => {
    const comInativa = [
      ...globais,
      { ...globais[0], ordem: 1, ativa: false, nome: "Antiga" },
      {
        unidade: "CEC Baby",
        ordem: 1,
        nome: "Própria",
        cpf: "",
        email: "",
        celular: "",
        ativa: true,
      },
    ];
    const uma = backfillTestemunhasPorUnidade(comInativa, UNIDADES);
    const duas = backfillTestemunhasPorUnidade(uma, UNIDADES);
    expect(duas).toEqual(uma);
    expect(testemunhasDaUnidade(uma, "CEC Baby").map((t) => t.nome)).toEqual([
      "Própria",
      "Anna Clara Marcolino Ribeiro",
    ]);
    expect(uma.filter((t) => t.nome === "Antiga")).toHaveLength(1);
  });
});

describe("testemunhasDaUnidade", () => {
  it("lê só a unidade pedida: editar uma não afeta as outras", () => {
    const linhas = backfillTestemunhasPorUnidade(globais, UNIDADES).map((t) =>
      t.unidade === "Núcleo Belvedere" && t.ordem === 2 ? { ...t, nome: "Outra Pessoa" } : t,
    );
    expect(testemunhasDaUnidade(linhas, "Núcleo Belvedere").map((t) => t.nome)).toEqual([
      "Márcia Regina Ribeiro Marcolino",
      "Outra Pessoa",
    ]);
    for (const u of ["CEC", "CEC Baby", "Núcleo Vale do Sereno"]) {
      expect(testemunhasDaUnidade(linhas, u)[1].nome).toBe("Anna Clara Marcolino Ribeiro");
    }
    expect(testemunhasDaUnidade(linhas, "Inexistente")).toEqual([]);
  });
});
