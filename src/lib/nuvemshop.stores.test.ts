import { describe, expect, it } from "vitest";
import {
  abaixoDoEstoqueMinimo,
  motivoForaDaReposicao,
  notificaEstoqueBaixo,
} from "./nuvemshop.stores";

const MIN = 5;

function alerta(storeKey: "cec" | "belvedere", produto: string, stock: number): boolean {
  return notificaEstoqueBaixo({ storeKey, produto, stock, minStock: MIN });
}

describe("estoque baixo — peças de algodão (sob encomenda)", () => {
  it("nunca notifica, mesmo zerada, na loja do Belvedere", () => {
    expect(alerta("belvedere", "CAMISA MANGA LONGA (ALGODÃO)", 0)).toBe(false);
    expect(alerta("belvedere", "REGATA (ALGODÃO)", 3)).toBe(false);
  });

  it("nunca notifica no CEC nem quando o nome tem '/ Azul'", () => {
    expect(alerta("cec", "REGATA (ALGODÃO) / Azul", 0)).toBe(false);
    expect(motivoForaDaReposicao("cec", "REGATA (ALGODÃO) / Azul")).toBe("algodao");
  });

  it("reconhece o nome sem acento e em caixa baixa", () => {
    expect(alerta("belvedere", "regata (algodao)", 0)).toBe(false);
  });
});

describe("estoque baixo — CEC/CEC Baby em troca de uniforme", () => {
  it("notifica a peça do modelo novo ('/ Azul') abaixo do mínimo", () => {
    expect(alerta("cec", "BERMUDA TACTEL / Azul", 2)).toBe(true);
    expect(alerta("cec", "MANGA LONGA / Azul", 0)).toBe(true);
    expect(alerta("cec", "CALÇA BAILARINA / Azul", MIN - 1)).toBe(true);
  });

  it("não notifica a peça nova com saldo exatamente no mínimo", () => {
    expect(alerta("cec", "CALÇA BAILARINA / Azul", MIN)).toBe(false);
  });

  it("aceita '/Azul' sem espaço depois da barra", () => {
    expect(alerta("cec", "BERMUDA TACTEL /Azul", 1)).toBe(true);
  });

  it("não notifica a peça do uniforme antigo, mesmo zerada", () => {
    expect(alerta("cec", "BERMUDA TACTEL", 0)).toBe(false);
    expect(alerta("cec", "CAMISA MANGA CURTA", 1)).toBe(false);
    expect(motivoForaDaReposicao("cec", "BERMUDA TACTEL")).toBe("uniforme_antigo_cec");
  });

  it("não confunde 'Azul' fora do sufixo do modelo novo", () => {
    expect(alerta("cec", "BERMUDA AZUL MARINHO", 0)).toBe(false);
  });

  it("não notifica a peça nova com saldo acima do mínimo", () => {
    expect(alerta("cec", "BERMUDA TACTEL / Azul", MIN + 1)).toBe(false);
  });
});

describe("estoque baixo — Belvedere e Vale do Sereno (comportamento preservado)", () => {
  it("notifica peça do Belvedere abaixo do mínimo, sem exigir '/ Azul'", () => {
    expect(alerta("belvedere", "BELVEDERE - CAMISA MANGA CURTA", 2)).toBe(true);
    expect(alerta("belvedere", "BELVEDERE - COLETE", MIN - 1)).toBe(true);
    expect(motivoForaDaReposicao("belvedere", "BELVEDERE - COLETE")).toBeNull();
  });

  it("não notifica a peça do Belvedere com saldo exatamente no mínimo", () => {
    expect(alerta("belvedere", "BELVEDERE - COLETE", MIN)).toBe(false);
  });

  it("continua sem notificar o Vale do Sereno, em descontinuação", () => {
    expect(alerta("belvedere", "VALE DO SERENO - REGATA", 0)).toBe(false);
    expect(motivoForaDaReposicao("belvedere", "VALE DO SERENO - REGATA")).toBe("vale_do_sereno");
  });

  it("não notifica peça do Belvedere com saldo acima do mínimo", () => {
    expect(alerta("belvedere", "BELVEDERE - COLETE", MIN + 1)).toBe(false);
  });
});

describe("estoque baixo — limite do mínimo", () => {
  it("notifica abaixo do mínimo, não no valor exato nem acima", () => {
    expect(abaixoDoEstoqueMinimo(0, MIN)).toBe(true);
    expect(abaixoDoEstoqueMinimo(MIN - 1, MIN)).toBe(true);
    expect(abaixoDoEstoqueMinimo(MIN, MIN)).toBe(false);
    expect(abaixoDoEstoqueMinimo(MIN + 1, MIN)).toBe(false);
  });
});

describe("estoque baixo — agrupamento por loja no sininho", () => {
  const variacoes = [
    { storeKey: "cec" as const, produto: "BERMUDA TACTEL / Azul", stock: 2 },
    { storeKey: "cec" as const, produto: "BERMUDA TACTEL", stock: 0 },
    { storeKey: "cec" as const, produto: "REGATA (ALGODÃO)", stock: 0 },
    { storeKey: "belvedere" as const, produto: "BELVEDERE - COLETE", stock: 1 },
    { storeKey: "belvedere" as const, produto: "VALE DO SERENO - REGATA", stock: 0 },
    { storeKey: "belvedere" as const, produto: "REGATA (ALGODÃO)", stock: 0 },
  ];

  const alertando = variacoes.filter((v) => notificaEstoqueBaixo({ ...v, minStock: MIN }));

  it("mantém um alerta por loja quando ainda sobra peça reposta", () => {
    expect(alertando.map((v) => v.produto)).toEqual([
      "BERMUDA TACTEL / Azul",
      "BELVEDERE - COLETE",
    ]);
    expect(new Set(alertando.map((v) => v.storeKey))).toEqual(new Set(["cec", "belvedere"]));
  });

  it("some o alerta da loja quando só restam peças fora da reposição", () => {
    const soExcecoes = variacoes.filter(
      (v) => v.storeKey === "cec" && v.produto !== "BERMUDA TACTEL / Azul",
    );
    expect(soExcecoes.filter((v) => notificaEstoqueBaixo({ ...v, minStock: MIN }))).toEqual([]);
  });
});
