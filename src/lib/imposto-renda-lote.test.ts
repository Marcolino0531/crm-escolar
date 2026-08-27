import { describe, expect, it } from "vitest";
import {
  assuntoEmailIR,
  destinatariosLote,
  emailValido,
  falhasDoLote,
  filtrarAlunosDaUnidade,
  mesclarResultados,
  resumoEnvio,
  resumoPrevia,
  semEmailLote,
  unidadeDoAlunoIR,
  type AlunoLoteIR,
  type ResultadoEnvioLote,
} from "./imposto-renda-lote";

function aluno(over: Partial<AlunoLoteIR>): AlunoLoteIR {
  return {
    alunoId: "1",
    nome: "Aluno",
    turma: "3º Ano",
    responsavelId: "10",
    responsavelNome: "Responsável",
    responsavelCpf: "111.111.111-11",
    responsavelEmail: "responsavel@exemplo.com",
    ...over,
  };
}

describe("filtro por unidade", () => {
  const alunos = [
    aluno({ alunoId: "1", turma: "Berçário 2" }),
    aluno({ alunoId: "2", turma: "Maternal 3" }),
    aluno({ alunoId: "3", turma: "Jardim 1" }),
    aluno({ alunoId: "4", turma: "5º Ano" }),
    aluno({ alunoId: "5", turma: "" }),
  ];

  it("separa CEC Baby por turma no token compartilhado", () => {
    expect(filtrarAlunosDaUnidade(alunos, "CEC Baby", true).map((a) => a.alunoId)).toEqual([
      "1",
      "2",
    ]);
  });

  it("deixa no CEC as turmas que não são Berçário/Maternal, inclusive sem turma", () => {
    expect(filtrarAlunosDaUnidade(alunos, "CEC", true).map((a) => a.alunoId)).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  it("não recorta unidade com credencial própria", () => {
    expect(filtrarAlunosDaUnidade(alunos, "Núcleo Belvedere", false)).toHaveLength(alunos.length);
  });

  it("classifica turma com acento e caixa diferente", () => {
    expect(unidadeDoAlunoIR("BERÇÁRIO I")).toBe("CEC Baby");
    expect(unidadeDoAlunoIR("maternal 1")).toBe("CEC Baby");
    expect(unidadeDoAlunoIR("2º Período")).toBe("CEC");
  });
});

describe("identificação de quem tem email", () => {
  it("recusa vazio, texto sem arroba, sem domínio e com espaço", () => {
    expect(emailValido("")).toBe(false);
    expect(emailValido("   ")).toBe(false);
    expect(emailValido("não tem")).toBe(false);
    expect(emailValido("mae@")).toBe(false);
    expect(emailValido("mae@dominio")).toBe(false);
    expect(emailValido("mae @dominio.com")).toBe(false);
  });

  it("aceita email cadastrado com espaço em volta", () => {
    expect(emailValido("  mae@dominio.com.br ")).toBe(true);
  });

  it("conta com email, sem email e total na prévia", () => {
    const lista = [
      aluno({ alunoId: "1", responsavelEmail: "a@b.com" }),
      aluno({ alunoId: "2", responsavelEmail: "" }),
      aluno({ alunoId: "3", responsavelEmail: "sem-arroba" }),
      aluno({ alunoId: "4", responsavelEmail: "c@d.com.br" }),
    ];
    expect(resumoPrevia(lista)).toEqual({ total: 4, comEmail: 2, semEmail: 2 });
    expect(destinatariosLote(lista).map((a) => a.alunoId)).toEqual(["1", "4"]);
    expect(semEmailLote(lista).map((a) => a.alunoId)).toEqual(["2", "3"]);
  });

  it("mantém na lista quem não tem email, para avisar por outro meio", () => {
    const lista = [aluno({ alunoId: "9", responsavelEmail: "" })];
    expect(resumoPrevia(lista).total).toBe(1);
    expect(destinatariosLote(lista)).toHaveLength(0);
    expect(semEmailLote(lista)).toHaveLength(1);
  });
});

describe("resumo final do envio", () => {
  const resultados: ResultadoEnvioLote[] = [
    { alunoId: "1", alunoNome: "A", email: "a@b.com", ok: true },
    { alunoId: "2", alunoNome: "B", email: "b@b.com", ok: false, erro: "Resend HTTP 422" },
    { alunoId: "3", alunoNome: "C", email: "c@b.com", ok: true },
  ];

  it("bate com o que foi enviado e o que falhou", () => {
    expect(resumoEnvio(resultados)).toEqual({ enviados: 2, falhas: 1 });
    expect(falhasDoLote(resultados).map((r) => r.alunoId)).toEqual(["2"]);
  });

  it("reenviar só as falhas não recontabiliza os já enviados", () => {
    const reenvio: ResultadoEnvioLote[] = [
      { alunoId: "2", alunoNome: "B", email: "b@b.com", ok: true },
    ];
    const mesclado = mesclarResultados(resultados, reenvio);
    expect(mesclado).toHaveLength(3);
    expect(resumoEnvio(mesclado)).toEqual({ enviados: 3, falhas: 0 });
    expect(falhasDoLote(mesclado)).toHaveLength(0);
  });

  it("falha que persiste no reenvio continua contada uma única vez", () => {
    const mesclado = mesclarResultados(resultados, [
      { alunoId: "2", alunoNome: "B", email: "b@b.com", ok: false, erro: "Resend HTTP 429" },
    ]);
    expect(resumoEnvio(mesclado)).toEqual({ enviados: 2, falhas: 1 });
    expect(falhasDoLote(mesclado)[0].erro).toBe("Resend HTTP 429");
  });
});

describe("assunto do email", () => {
  it("usa o ano do IR e o nome do colégio", () => {
    expect(assuntoEmailIR(2027, "Colégio CEC")).toBe(
      "Declaração de Imposto de Renda 2027 — Colégio CEC",
    );
  });

  it("omite o travessão quando o colégio não tem nome cadastrado", () => {
    expect(assuntoEmailIR(2027, "  ")).toBe("Declaração de Imposto de Renda 2027");
  });
});
