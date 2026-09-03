import { describe, expect, it } from "vitest";
import { agruparFalhas, categorizarErro, totalEmRisco, type LogEntrega } from "./billing-falhas";
import { filtrarPorUnidade } from "./unidade-global";

function log(
  p: Partial<LogEntrega> & { id: string; data_envio: string; status: string },
): LogEntrega {
  return {
    responsavel_name: "Lucas Henrique",
    aluno_name: "Aluno Teste",
    telefone: "(31) 99999-0001",
    unidade: "Colégio CEC",
    valor: 1000,
    vencimento: "2026-09-07",
    erro_mensagem: p.status === "falha" ? "Message Undeliverable." : null,
    tipo: "cobranca",
    ...p,
  };
}

describe("categorizarErro", () => {
  it("classifica os erros conhecidos", () => {
    expect(categorizarErro("Message Undeliverable.")).toBe("sem_whatsapp");
    expect(categorizarErro("Responsável sem telefone cadastrado no Sponte.")).toBe("sem_telefone");
    expect(categorizarErro("(#131047) Re-engagement message")).toBe("fora_da_janela");
    expect(categorizarErro("(#132001) Template name does not exist")).toBe("template");
    expect(categorizarErro("(#131049) healthy ecosystem engagement")).toBe("limite_meta");
    expect(categorizarErro(null)).toBe("outro");
  });
});

describe("agruparFalhas", () => {
  it("agrupa 3 falhas seguidas do mesmo telefone em uma linha com a última tentativa", () => {
    const linhas = agruparFalhas([
      log({ id: "a", data_envio: "2026-09-01T12:00:00Z", status: "falha", valor: 1000 }),
      log({ id: "b", data_envio: "2026-09-02T12:00:00Z", status: "falha", valor: 1000 }),
      log({ id: "c", data_envio: "2026-09-03T12:00:00Z", status: "falha", valor: 1050.5 }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].tentativas).toBe(3);
    expect(linhas[0].ultimaTentativa).toBe("2026-09-03T12:00:00Z");
    expect(linhas[0].valor).toBe(1050.5);
    expect(linhas[0].logIds).toEqual(["c", "b", "a"]);
  });

  it("quem voltou a receber depois da falha não é pendência", () => {
    const linhas = agruparFalhas([
      log({ id: "a", data_envio: "2026-09-01T12:00:00Z", status: "falha" }),
      log({ id: "b", data_envio: "2026-09-02T12:00:00Z", status: "entregue" }),
    ]);
    expect(linhas).toHaveLength(0);
  });

  it("uma entrega no meio reinicia a contagem de falhas seguidas", () => {
    const linhas = agruparFalhas([
      log({ id: "a", data_envio: "2026-09-01T12:00:00Z", status: "falha" }),
      log({ id: "b", data_envio: "2026-09-02T12:00:00Z", status: "lido" }),
      log({ id: "c", data_envio: "2026-09-03T12:00:00Z", status: "falha" }),
    ]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].tentativas).toBe(1);
  });

  it("agrupa pelo telefone normalizado, une os alunos e ordena do mais recente", () => {
    const linhas = agruparFalhas([
      log({
        id: "a",
        data_envio: "2026-09-01T12:00:00Z",
        status: "falha",
        telefone: "31999990001",
        aluno_name: "Irmão 1",
      }),
      log({
        id: "b",
        data_envio: "2026-09-02T12:00:00Z",
        status: "falha",
        telefone: "(31) 99999-0001",
        alunos_cobrados: [{ nome: "Irmão 1" }, { nome: "Irmão 2" }],
      }),
      log({
        id: "z",
        data_envio: "2026-09-03T12:00:00Z",
        status: "erro",
        telefone: "",
        responsavel_name: "Sem Número",
        erro_mensagem: "Responsável sem telefone cadastrado no Sponte.",
      }),
    ]);
    expect(linhas.map((l) => l.responsavel)).toEqual(["Sem Número", "Lucas Henrique"]);
    expect(linhas[1].alunos).toEqual(["Irmão 1", "Irmão 2"]);
    expect(linhas[0].categoria).toBe("sem_telefone");
  });
});

describe("totalEmRisco", () => {
  it("soma o valor da última tentativa uma vez por responsável, sem erro de centavos", () => {
    const linhas = agruparFalhas([
      log({ id: "a", data_envio: "2026-09-01T12:00:00Z", status: "falha", valor: "1117.3" }),
      log({ id: "b", data_envio: "2026-09-02T12:00:00Z", status: "falha", valor: "1117.3" }),
      log({
        id: "c",
        data_envio: "2026-09-02T12:00:00Z",
        status: "falha",
        telefone: "(31) 98888-0002",
        valor: 0.1,
      }),
      log({
        id: "d",
        data_envio: "2026-09-02T12:00:00Z",
        status: "falha",
        telefone: "(31) 97777-0003",
        valor: 0.2,
      }),
    ]);
    expect(totalEmRisco(linhas)).toBe(1117.6);
  });

  it("soma só a unidade filtrada pelo seletor global", () => {
    const linhas = agruparFalhas([
      log({ id: "a", data_envio: "2026-09-01T12:00:00Z", status: "falha", valor: 100 }),
      log({
        id: "b",
        data_envio: "2026-09-01T12:00:00Z",
        status: "falha",
        telefone: "(31) 98888-0002",
        unidade: "Núcleo Belvedere",
        valor: 250.25,
      }),
    ]);
    const belvedere = filtrarPorUnidade(linhas, "Núcleo Belvedere", (l) => l.unidade);
    expect(totalEmRisco(belvedere)).toBe(250.25);
    expect(totalEmRisco(filtrarPorUnidade(linhas, null, (l) => l.unidade))).toBe(350.25);
    expect(totalEmRisco([])).toBe(0);
  });
});
