import { describe, it, expect } from "vitest";
import {
  conversaVisivelNaUnidade,
  escolherConversaDoNumero,
  grupoDaConversa,
  grupoDaUnidade,
  grupoDoPhoneNumberId,
  numeroDeEnvio,
  unidadesDoGrupo,
  type NumeroWhatsApp,
} from "./whatsapp-numeros";

const NUMEROS: NumeroWhatsApp[] = [
  { grupo: "cec", phoneNumberId: "111" },
  { grupo: "belvedere", phoneNumberId: "222" },
];

describe("grupoDaUnidade", () => {
  it("agrupa as unidades por número", () => {
    expect(grupoDaUnidade("CEC")).toBe("cec");
    expect(grupoDaUnidade("CEC Baby")).toBe("cec");
    expect(grupoDaUnidade("Núcleo Belvedere")).toBe("belvedere");
    expect(grupoDaUnidade("Núcleo Vale do Sereno")).toBe("belvedere");
  });

  it("devolve null para unidade ausente ou desconhecida", () => {
    expect(grupoDaUnidade(null)).toBeNull();
    expect(grupoDaUnidade("")).toBeNull();
    expect(grupoDaUnidade("Outra Escola")).toBeNull();
  });

  it("expõe as duas unidades de cada número", () => {
    expect(unidadesDoGrupo("cec")).toEqual(["CEC", "CEC Baby"]);
    expect(unidadesDoGrupo("belvedere")).toEqual(["Núcleo Belvedere", "Núcleo Vale do Sereno"]);
  });
});

describe("grupoDoPhoneNumberId", () => {
  it("identifica o número que recebeu a mensagem", () => {
    expect(grupoDoPhoneNumberId("111", NUMEROS)).toBe("cec");
    expect(grupoDoPhoneNumberId("222", NUMEROS)).toBe("belvedere");
  });

  it("devolve null para número não configurado", () => {
    expect(grupoDoPhoneNumberId("999", NUMEROS)).toBeNull();
    expect(grupoDoPhoneNumberId(null, NUMEROS)).toBeNull();
  });
});

describe("grupoDaConversa", () => {
  it("usa o grupo gravado, mesmo divergindo da unidade vinculada", () => {
    expect(grupoDaConversa({ numero_grupo: "belvedere", unidade: "CEC" })).toBe("belvedere");
  });

  it("cai na unidade quando a conversa não tem número gravado", () => {
    expect(grupoDaConversa({ numero_grupo: null, unidade: "Núcleo Vale do Sereno" })).toBe(
      "belvedere",
    );
  });

  it("trata conversa legada (sem número e sem unidade) como do número do CEC", () => {
    expect(grupoDaConversa({})).toBe("cec");
    expect(grupoDaConversa({ numero_grupo: "outro", unidade: "" })).toBe("cec");
  });
});

describe("numeroDeEnvio", () => {
  it("responde pelo mesmo número que recebeu a mensagem", () => {
    expect(numeroDeEnvio({ phone_number_id: "222", numero_grupo: "belvedere" }, NUMEROS)).toEqual({
      grupo: "belvedere",
      phoneNumberId: "222",
    });
    expect(numeroDeEnvio({ phone_number_id: "111", numero_grupo: "cec" }, NUMEROS)).toEqual({
      grupo: "cec",
      phoneNumberId: "111",
    });
  });

  it("usa a unidade quando a conversa não guarda o número", () => {
    expect(numeroDeEnvio({ unidade: "Núcleo Belvedere" }, NUMEROS)?.phoneNumberId).toBe("222");
    expect(numeroDeEnvio({ unidade: "CEC Baby" }, NUMEROS)?.phoneNumberId).toBe("111");
  });

  it("cai no número histórico sem número nem unidade", () => {
    expect(numeroDeEnvio({}, NUMEROS)?.phoneNumberId).toBe("111");
  });

  it("usa o único número configurado enquanto o segundo não existir", () => {
    const so_cec: NumeroWhatsApp[] = [{ grupo: "cec", phoneNumberId: "111" }];
    expect(numeroDeEnvio({ unidade: "Núcleo Belvedere" }, so_cec)?.phoneNumberId).toBe("111");
  });

  it("devolve null sem nenhum número configurado", () => {
    expect(numeroDeEnvio({ unidade: "CEC" }, [])).toBeNull();
  });
});

describe("escolherConversaDoNumero", () => {
  const doCec = { id: "a", phone_number_id: "111", numero_grupo: "cec" };
  const doBelvedere = { id: "b", phone_number_id: "222", numero_grupo: "belvedere" };

  it("separa as duas conversas do mesmo telefone pelo número que recebeu", () => {
    const candidatas = [doBelvedere, doCec];
    expect(escolherConversaDoNumero(candidatas, "111", NUMEROS)?.id).toBe("a");
    expect(escolherConversaDoNumero(candidatas, "222", NUMEROS)?.id).toBe("b");
  });

  it("não entrega a conversa do outro número quando ainda não existe a deste", () => {
    expect(escolherConversaDoNumero([doCec], "222", NUMEROS)).toBeNull();
    expect(escolherConversaDoNumero([doBelvedere], "111", NUMEROS)).toBeNull();
  });

  it("adota a conversa antiga (sem número) pelo número do grupo dela", () => {
    const legadaCec = { id: "c", phone_number_id: null, unidade: "CEC" };
    expect(escolherConversaDoNumero([legadaCec], "111", NUMEROS)?.id).toBe("c");
    expect(escolherConversaDoNumero([legadaCec], "222", NUMEROS)).toBeNull();
  });

  it("prefere a conversa do número exato à conversa antiga do mesmo grupo", () => {
    const legada = { id: "c", phone_number_id: null, unidade: "CEC" };
    expect(escolherConversaDoNumero([legada, doCec], "111", NUMEROS)?.id).toBe("a");
  });

  it("sem metadata do número, usa a conversa mais recente do telefone", () => {
    expect(escolherConversaDoNumero([doBelvedere, doCec], null, NUMEROS)?.id).toBe("b");
  });
});

describe("conversaVisivelNaUnidade", () => {
  const doCec = { numero_grupo: "cec", unidade: "CEC" };
  const doBelvedere = { numero_grupo: "belvedere", unidade: "Núcleo Belvedere" };

  it("mostra somente as conversas do número da unidade selecionada", () => {
    expect(conversaVisivelNaUnidade(doCec, "CEC Baby")).toBe(true);
    expect(conversaVisivelNaUnidade(doBelvedere, "CEC Baby")).toBe(false);
    expect(conversaVisivelNaUnidade(doBelvedere, "Núcleo Vale do Sereno")).toBe(true);
    expect(conversaVisivelNaUnidade(doCec, "Núcleo Vale do Sereno")).toBe(false);
  });

  it("não filtra em Todas as Unidades", () => {
    expect(conversaVisivelNaUnidade(doCec, null)).toBe(true);
    expect(conversaVisivelNaUnidade(doBelvedere, null)).toBe(true);
  });

  it("mantém conversa legada visível no número do CEC", () => {
    expect(conversaVisivelNaUnidade({}, "CEC")).toBe(true);
    expect(conversaVisivelNaUnidade({}, "Núcleo Belvedere")).toBe(false);
  });
});
