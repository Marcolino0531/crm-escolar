import { describe, expect, it } from "vitest";
import {
  agruparUnidadesPorCredencial,
  alunoDaSessao,
  emailDoResponsavel,
  filtrarAlunosAtivos,
  statusContratoPortal,
  unirVinculos,
  urlLinkPortal,
  type MatriculaAtiva,
} from "./portal-responsavel";

const CONFIG = {
  CEC: { codigoEnv: "SPONTE_CODIGO_CLIENTE" },
  "CEC Baby": { codigoEnv: "SPONTE_CODIGO_CLIENTE" },
  "Núcleo Belvedere": { codigoEnv: "SPONTE_BELVEDERE_CODIGO_CLIENTE" },
  "Núcleo Vale do Sereno": { codigoEnv: "SPONTE_VALE_SERENO_CODIGO" },
};

describe("agruparUnidadesPorCredencial", () => {
  it("CEC e CEC Baby compartilham uma credencial; Belvedere e Vale do Sereno têm a sua", () => {
    expect(agruparUnidadesPorCredencial(CONFIG)).toEqual([
      { unidades: ["CEC", "CEC Baby"] },
      { unidades: ["Núcleo Belvedere"] },
      { unidades: ["Núcleo Vale do Sereno"] },
    ]);
  });
});

describe("unirVinculos", () => {
  it("une os AlunoIDs das credenciais, marcando cada um com as unidades da credencial", () => {
    const r = unirVinculos([
      { unidades: ["CEC", "CEC Baby"], alunoIds: [101, 102] },
      { unidades: ["Núcleo Belvedere"], alunoIds: [301] },
    ]);
    expect(r).toEqual([
      { alunoId: "101", unidadesPossiveis: ["CEC", "CEC Baby"] },
      { alunoId: "102", unidadesPossiveis: ["CEC", "CEC Baby"] },
      { alunoId: "301", unidadesPossiveis: ["Núcleo Belvedere"] },
    ]);
  });

  it("mesmo AlunoID em credenciais diferentes acumula as duas unidades possíveis", () => {
    const r = unirVinculos([
      { unidades: ["CEC", "CEC Baby"], alunoIds: [7] },
      { unidades: ["Núcleo Belvedere"], alunoIds: ["7"] },
    ]);
    expect(r).toEqual([
      { alunoId: "7", unidadesPossiveis: ["CEC", "CEC Baby", "Núcleo Belvedere"] },
    ]);
  });

  it("descarta IDs inválidos e repetidos dentro da mesma credencial", () => {
    const r = unirVinculos([{ unidades: ["CEC"], alunoIds: [5, 5, 0, -1, "abc", " 6 "] }]);
    expect(r.map((v) => v.alunoId)).toEqual(["5", "6"]);
  });

  it("nenhuma credencial encontrou o CPF → lista vazia", () => {
    expect(unirVinculos([])).toEqual([]);
  });
});

describe("filtrarAlunosAtivos", () => {
  const matriculas: MatriculaAtiva[] = [
    { unidade: "CEC Baby", alunoId: "101", nome: "Bia", turma: "Maternal 2" },
    { unidade: "CEC", alunoId: "102", nome: "Ana", turma: "6º Ano" },
    { unidade: "Núcleo Belvedere", alunoId: "301", nome: "Caio", turma: "1º Período" },
    { unidade: "Núcleo Belvedere", alunoId: "7", nome: "Duda", turma: "2º Período" },
  ];

  it("só passa quem tem matrícula ativa no ano, resolvendo a unidade exata (CEC × CEC Baby)", () => {
    const candidatos = unirVinculos([
      { unidades: ["CEC", "CEC Baby"], alunoIds: [101, 102, 103] },
      { unidades: ["Núcleo Belvedere"], alunoIds: [301, 302] },
    ]);
    expect(filtrarAlunosAtivos(candidatos, matriculas)).toEqual([
      { unidade: "CEC", alunoId: "102", nome: "Ana", turma: "6º Ano" },
      { unidade: "CEC Baby", alunoId: "101", nome: "Bia", turma: "Maternal 2" },
      { unidade: "Núcleo Belvedere", alunoId: "301", nome: "Caio", turma: "1º Período" },
    ]);
  });

  it("mesmo AlunoID em outra credencial não vaza: a matrícula precisa ser de uma unidade possível", () => {
    const candidatos = unirVinculos([{ unidades: ["CEC", "CEC Baby"], alunoIds: [7] }]);
    expect(filtrarAlunosAtivos(candidatos, matriculas)).toEqual([]);
  });

  it("aluno inativo no ano (sem linha ativa) fica de fora → lista vazia", () => {
    const candidatos = unirVinculos([{ unidades: ["CEC", "CEC Baby"], alunoIds: [999] }]);
    expect(filtrarAlunosAtivos(candidatos, matriculas)).toEqual([]);
  });

  it("não duplica o mesmo (unidade, aluno) quando a matrícula aparece duas vezes", () => {
    const candidatos = unirVinculos([{ unidades: ["CEC"], alunoIds: [102] }]);
    expect(filtrarAlunosAtivos(candidatos, [matriculas[1], matriculas[1]])).toHaveLength(1);
  });
});

describe("alunoDaSessao", () => {
  const alunos = [
    { unidade: "CEC", alunoId: "102" },
    { unidade: "Núcleo Belvedere", alunoId: "301" },
  ];
  it("aceita só o par (unidade, alunoId) exato da sessão", () => {
    expect(alunoDaSessao(alunos, "CEC", "102")).toBe(true);
    expect(alunoDaSessao(alunos, "CEC Baby", "102")).toBe(false);
    expect(alunoDaSessao(alunos, "CEC", "301")).toBe(false);
  });
});

describe("emailDoResponsavel / urlLinkPortal / statusContratoPortal", () => {
  it("usa o primeiro email não vazio entre as credenciais", () => {
    expect(
      emailDoResponsavel([
        { unidades: ["CEC"], alunoIds: [1], email: "  " },
        { unidades: ["Núcleo Belvedere"], alunoIds: [2], email: "mae@exemplo.com" },
      ]),
    ).toBe("mae@exemplo.com");
  });
  it("monta o link do portal com o token na query", () => {
    expect(urlLinkPortal("https://x.app/", "a b")).toBe("https://x.app/portal?token=a%20b");
  });
  it("deriva o status visível do contrato", () => {
    expect(statusContratoPortal("gerando", null)).toBe("gerando");
    expect(statusContratoPortal("enviado", null)).toBe("aguardando_assinatura");
    expect(statusContratoPortal("enviado", "signed")).toBe("assinado");
    expect(statusContratoPortal("enviado", "refused")).toBe("erro");
    expect(statusContratoPortal("erro", "signed")).toBe("erro");
  });
});
