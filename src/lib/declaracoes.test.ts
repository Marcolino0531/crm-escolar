import { describe, expect, it } from "vitest";
import {
  exigeConfirmacao,
  fraseFiliacao,
  identificacaoColegio,
  montarDeclaracaoDebitos,
  nomesFiliacao,
  pendenciasEmAberto,
  rotuloTipoDocumento,
  textoDeclaracaoDebitos,
  validarDeclaracao,
  type ResponsavelDeclaracao,
  type TituloAberto,
} from "./declaracoes";
import type { AlunoRecibo, ColegioRecibo } from "./recibos";

const COLEGIO: ColegioRecibo = {
  unidade: "CEC",
  razaoSocial: "Centro Educacional Cristão Ltda",
  nomeFantasia: "CEC",
  cnpj: "12.345.678/0001-90",
  inscricaoMunicipal: "",
  endereco: "Rua das Acácias",
  numero: "100",
  complemento: "",
  bairro: "Belvedere",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "30320-000",
  telefone: "(31) 3333-3333",
  email: "secretaria@cec.com.br",
  site: "",
  assinanteNome: "Maria Diretora",
  assinanteCargo: "Diretora",
  observacao: "",
};

const ALUNO: AlunoRecibo = {
  alunoId: "672",
  nome: "Bento Ribeiro Marcolino",
  cpf: "111.111.111-11",
  turma: "3º ano",
  matricula: "2026-0672",
};

const resp = (nome: string, parentesco: string, id = nome): ResponsavelDeclaracao => ({
  responsavelId: id,
  nome,
  cpf: "",
  parentesco,
});

const titulo = (over: Partial<TituloAberto>): TituloAberto => ({
  saldo: 0,
  quitada: true,
  vencimento: "2026-08-10",
  valor: 1000,
  categoria: "Mensalidade",
  ...over,
});

describe("filiação", () => {
  it("cita pai e mãe na ordem do documento, mesmo vindo invertidos do Sponte", () => {
    const nomes = nomesFiliacao([resp("Ana Souza", "Mãe"), resp("João Souza", "Pai")]);
    expect(nomes).toEqual(["João Souza", "Ana Souza"]);
    expect(fraseFiliacao([resp("Ana Souza", "Mãe"), resp("João Souza", "Pai")])).toBe(
      "filho(a) de João Souza e Ana Souza",
    );
  });

  it("cita só quem existe quando há um único responsável (sem 'e' sobrando)", () => {
    const frase = fraseFiliacao([resp("Ana Souza", "Mãe")]);
    expect(frase).toBe("filho(a) de Ana Souza");
    expect(frase).not.toContain(" e ");
  });

  it("não repete o mesmo nome cadastrado duas vezes", () => {
    expect(fraseFiliacao([resp("Ana Souza", "Mãe", "1"), resp("Ana Souza", "Avó", "2")])).toBe(
      "filho(a) de Ana Souza",
    );
  });

  it("junta três responsáveis com vírgula e 'e' no último", () => {
    expect(
      fraseFiliacao([resp("João", "Pai"), resp("Ana", "Mãe"), resp("Rita", "Avó")]),
    ).toBe("filho(a) de João, Ana e Rita");
  });

  it("devolve vazio quando não há responsável cadastrado", () => {
    expect(fraseFiliacao([])).toBe("");
    expect(fraseFiliacao([resp("   ", "Pai")])).toBe("");
  });
});

describe("texto da declaração", () => {
  it("monta o modelo com colégio, aluno e os dois responsáveis", () => {
    const texto = textoDeclaracaoDebitos({
      colegio: COLEGIO,
      aluno: ALUNO,
      responsaveis: [resp("João Souza", "Pai"), resp("Ana Souza", "Mãe")],
    });
    expect(texto).toBe(
      "COLÉGIO CEC - Centro Educacional Cristão Ltda, inscrito no CNPJ n° 12.345.678/0001-90, " +
        "localizado na Rua das Acácias, 100 — Belvedere, Belo Horizonte/MG — CEP 30320-000, " +
        "secretaria@cec.com.br, declara para os devidos fins que o(a) aluno(a) " +
        "Bento Ribeiro Marcolino, filho(a) de João Souza e Ana Souza, não possui débitos junto a " +
        "esta instituição até a presente data.",
    );
  });

  it("com um único responsável não deixa lacuna nem 'e' solto", () => {
    const texto = textoDeclaracaoDebitos({
      colegio: COLEGIO,
      aluno: ALUNO,
      responsaveis: [resp("Ana Souza", "Mãe")],
    });
    expect(texto).toContain("o(a) aluno(a) Bento Ribeiro Marcolino, filho(a) de Ana Souza, não possui");
    expect(texto).not.toMatch(/ e ,|,\s{2,}|filho\(a\) de\s*,/);
  });

  it("omite a filiação inteira quando o aluno não tem responsável", () => {
    const texto = textoDeclaracaoDebitos({ colegio: COLEGIO, aluno: ALUNO, responsaveis: [] });
    expect(texto).toContain("o(a) aluno(a) Bento Ribeiro Marcolino, não possui débitos");
    expect(texto).not.toContain("filho(a)");
  });

  it("omite CNPJ, endereço e e-mail ausentes sem imprimir vírgula sobrando", () => {
    const texto = textoDeclaracaoDebitos({
      colegio: { ...COLEGIO, cnpj: "", email: "", endereco: "", numero: "", bairro: "", cep: "" },
      aluno: ALUNO,
      responsaveis: [resp("Ana Souza", "Mãe")],
    });
    expect(texto).toBe(
      "COLÉGIO CEC - Centro Educacional Cristão Ltda, localizado na Belo Horizonte/MG, declara " +
        "para os devidos fins que o(a) aluno(a) Bento Ribeiro Marcolino, filho(a) de Ana Souza, " +
        "não possui débitos junto a esta instituição até a presente data.",
    );
  });

  it("não duplica o nome quando fantasia e razão social são iguais", () => {
    expect(identificacaoColegio({ ...COLEGIO, nomeFantasia: COLEGIO.razaoSocial })).toBe(
      `COLÉGIO ${COLEGIO.razaoSocial}`,
    );
  });
});

describe("parcelas em aberto", () => {
  const hoje = "2026-08-18";

  it("não acusa pendência quando tudo está quitado", () => {
    const pend = pendenciasEmAberto(
      [titulo({}), titulo({ vencimento: "2026-07-10" })],
      hoje,
    );
    expect(pend).toEqual({ total: 0, vencidas: 0, aVencer: 0, valor: 0 });
    expect(exigeConfirmacao(pend)).toBe(false);
  });

  it("conta parcela em aberto separando vencidas de a vencer e soma o saldo", () => {
    const pend = pendenciasEmAberto(
      [
        titulo({ quitada: false, saldo: 1200.5, vencimento: "2026-07-10" }),
        titulo({ quitada: false, saldo: 800, vencimento: "2026-09-10" }),
        titulo({ quitada: true, saldo: 0, vencimento: "2026-06-10" }),
      ],
      hoje,
    );
    expect(pend).toEqual({ total: 2, vencidas: 1, aVencer: 1, valor: 2000.5 });
    expect(exigeConfirmacao(pend)).toBe(true);
  });

  it("ignora parcela sem saldo mesmo com situação pendente (pagamento parcial já coberto)", () => {
    const pend = pendenciasEmAberto([titulo({ quitada: false, saldo: 0 })], hoje);
    expect(pend.total).toBe(0);
    expect(exigeConfirmacao(pend)).toBe(false);
  });

  it("trata parcela vencida hoje como a vencer (o dia ainda não passou)", () => {
    const pend = pendenciasEmAberto([titulo({ quitada: false, saldo: 100, vencimento: hoje })], hoje);
    expect(pend).toEqual({ total: 1, vencidas: 0, aVencer: 1, valor: 100 });
  });
});

describe("documento montado e validação", () => {
  it("guarda o texto, a data por extenso e o snapshot das pendências conferidas", () => {
    const doc = montarDeclaracaoDebitos({
      numero: 7,
      dataDocumento: "2026-08-14",
      colegio: COLEGIO,
      aluno: ALUNO,
      responsaveis: [resp("Ana Souza", "Mãe")],
      pendencias: { total: 0, vencidas: 0, aVencer: 0, valor: 0 },
    });
    expect(doc.numero).toBe("00007/2026");
    expect(doc.dataExtenso).toBe("Belo Horizonte, 14 de agosto de 2026");
    expect(doc.texto).toContain("filho(a) de Ana Souza");
    expect(doc.pendencias.total).toBe(0);
  });

  it("exige aluno, data e cadastro do colégio", () => {
    expect(
      validarDeclaracao({ colegio: COLEGIO, aluno: ALUNO, dataDocumento: "2026-08-14" }),
    ).toEqual([]);
    expect(validarDeclaracao({ colegio: COLEGIO, aluno: null, dataDocumento: "" })).toEqual([
      "Selecione o aluno.",
      "Informe a data do documento.",
    ]);
    expect(
      validarDeclaracao({
        colegio: { ...COLEGIO, razaoSocial: "", cnpj: "" },
        aluno: ALUNO,
        dataDocumento: "2026-08-14",
      }),
    ).toHaveLength(2);
  });

  it("rotula os tipos do histórico compartilhado", () => {
    expect(rotuloTipoDocumento("recibo")).toBe("Recibo");
    expect(rotuloTipoDocumento("declaracao_debitos")).toBe("Declaração de Inexistência de Débitos");
    expect(rotuloTipoDocumento("")).toBe("Recibo");
  });
});
