import { describe, it, expect } from "vitest";
import {
  assuntoEmailContracheque,
  classificarErroPdf,
  competenciaExtenso,
  conferirPaginas,
  corpoEmailContracheque,
  corrigirVinculo,
  identificarFuncionarioDaPagina,
  mensagemFalhaPdf,
  nomeArquivoContracheque,
  paginasEnviaveis,
  removerPagina,
  resumirConferencia,
  senhaDoCpf,
  textoDosItens,
  detalheTecnicoErro,
  mensagemErroProcessamento,
  MENSAGEM_ERRO_TECNICO,
  type FuncionarioContracheque,
  type PaginaPdf,
} from "./contracheques";

function func(
  id: string,
  nomeCompleto: string,
  extra: Partial<FuncionarioContracheque> = {},
): FuncionarioContracheque {
  return {
    id,
    nomeCompleto,
    cpf: "106.875.516-41",
    email: `${id}@colegio.com.br`,
    unidade: "CEC",
    ativo: true,
    ...extra,
  };
}

const ANA = func("ana", "Ana Maria de Souza Ferreira");
const BRUNO = func("bruno", "Bruno Lima Costa");
const CARLA = func("carla", "Carla Dias Nogueira");
const EQUIPE = [ANA, BRUNO, CARLA];

// Texto no formato típico de contracheque da contabilidade.
function paginaDe(nome: string, pagina: number, extra = ""): PaginaPdf {
  return {
    pagina,
    texto: [
      "COLEGIO CEC LTDA",
      "RECIBO DE PAGAMENTO DE SALARIO",
      "Competencia: 08/2026",
      `Funcionario: ${nome}`,
      "Cargo: PROFESSOR   Admissao: 01/02/2024",
      "Salario base 3.500,00   Liquido a receber 3.128,45",
      extra,
    ].join("\n"),
  };
}

describe("identificarFuncionarioDaPagina", () => {
  it("casa o nome completo exatamente como cadastrado", () => {
    const achado = identificarFuncionarioDaPagina(paginaDe("Bruno Lima Costa", 1).texto, EQUIPE);
    expect(achado?.funcionario.id).toBe("bruno");
    expect(achado?.origem).toBe("exata");
  });

  it("ignora acento, caixa e pontuação do PDF", () => {
    const achado = identificarFuncionarioDaPagina("FUNCIONARIO: ANA MARIA DE SOUZA FERREIRA", [
      func("ana", "Ana Maria de Souza Ferreira"),
    ]);
    expect(achado?.funcionario.id).toBe("ana");
    expect(achado?.origem).toBe("exata");
  });

  it("casa parcialmente quando o PDF abrevia um nome do meio", () => {
    const achado = identificarFuncionarioDaPagina(paginaDe("Ana Souza Ferreira", 1).texto, EQUIPE);
    expect(achado?.funcionario.id).toBe("ana");
    expect(achado?.origem).toBe("parcial");
  });

  it("não casa quando falta o último nome (evita trocar homônimo parcial)", () => {
    const achado = identificarFuncionarioDaPagina("Funcionario: Ana Maria de Souza", [
      func("ana", "Ana Maria de Souza Ferreira"),
    ]);
    expect(achado).toBeNull();
  });

  it("devolve nulo quando o nome não está na lista do RH", () => {
    const achado = identificarFuncionarioDaPagina(paginaDe("Joana Ribeiro Alves", 1).texto, EQUIPE);
    expect(achado).toBeNull();
  });

  it("devolve nulo em empate ambíguo entre dois funcionários", () => {
    const gemeos = [func("a1", "Maria Silva Santos"), func("a2", "Maria Silva Santos")];
    expect(identificarFuncionarioDaPagina("Maria Silva Santos", gemeos)?.funcionario.id).toBe("a1");
    const ambiguo = identificarFuncionarioDaPagina("Maria Santos", [
      func("b1", "Maria Andrade Santos"),
      func("b2", "Maria Ferreira Santos"),
    ]);
    expect(ambiguo).toBeNull();
  });

  it("prefere o funcionário ativo quando há homônimo desligado", () => {
    const achado = identificarFuncionarioDaPagina("Funcionario: Bruno Lima Costa", [
      func("antigo", "Bruno Lima Costa", { ativo: false }),
      func("atual", "Bruno Lima Costa"),
    ]);
    expect(achado?.funcionario.id).toBe("atual");
  });

  it("devolve nulo para página sem texto (PDF só de imagem)", () => {
    expect(identificarFuncionarioDaPagina("   ", EQUIPE)).toBeNull();
  });
});

describe("conferirPaginas", () => {
  const paginas = [
    paginaDe("Ana Maria de Souza Ferreira", 1),
    paginaDe("Bruno Lima Costa", 2),
    paginaDe("Joana Ribeiro Alves", 3),
  ];

  it("vincula cada página ao funcionário da lista e sinaliza a sem correspondência", () => {
    const conf = conferirPaginas(paginas, EQUIPE);

    expect(conf.map((p) => [p.pagina, p.funcionarioId, p.status])).toEqual([
      [1, "ana", "pronta"],
      [2, "bruno", "pronta"],
      [3, null, "sem_correspondencia"],
    ]);
    expect(conf[2].funcionarioNome).toBe("");
  });

  it("sinaliza funcionário sem email cadastrado", () => {
    const conf = conferirPaginas(paginas, [{ ...ANA, email: "" }, BRUNO, CARLA]);

    expect(conf[0].status).toBe("sem_email");
    expect(conf[0].funcionarioId).toBe("ana");
    expect(conf[1].status).toBe("pronta");
  });

  it("sinaliza funcionário sem CPF, já que a senha vem do CPF", () => {
    const conf = conferirPaginas(paginas, [{ ...ANA, cpf: "" }, BRUNO, CARLA]);
    expect(conf[0].status).toBe("sem_cpf");
  });

  it("marca páginas duplicadas do mesmo funcionário", () => {
    const conf = conferirPaginas(
      [paginaDe("Bruno Lima Costa", 1), paginaDe("Bruno Lima Costa", 2)],
      EQUIPE,
    );
    expect(conf.map((p) => p.duplicada)).toEqual([true, true]);
  });

  it("preserva o texto extraído para o usuário conferir", () => {
    const conf = conferirPaginas(paginas, EQUIPE);
    expect(conf[0].texto).toContain("RECIBO DE PAGAMENTO DE SALARIO");
  });
});

describe("paginasEnviaveis e resumo", () => {
  const conf = conferirPaginas(
    [
      paginaDe("Ana Maria de Souza Ferreira", 1),
      paginaDe("Bruno Lima Costa", 2),
      paginaDe("Carla Dias Nogueira", 3),
      paginaDe("Joana Ribeiro Alves", 4),
    ],
    [ANA, { ...BRUNO, email: "" }, { ...CARLA, cpf: "12" }],
  );

  it("só envia as páginas prontas", () => {
    expect(paginasEnviaveis(conf).map((p) => p.funcionarioId)).toEqual(["ana"]);
  });

  it("conta cada pendência separadamente", () => {
    expect(resumirConferencia(conf)).toEqual({
      total: 4,
      prontas: 1,
      semCorrespondencia: 1,
      semEmail: 1,
      semCpf: 1,
      duplicadas: 0,
    });
  });
});

describe("correção manual e remoção", () => {
  const conf = conferirPaginas(
    [paginaDe("Joana Ribeiro Alves", 1), paginaDe("Bruno Lima Costa", 2)],
    EQUIPE,
  );

  it("vincular manualmente resolve a página sem correspondência", () => {
    const corrigida = corrigirVinculo(conf, 1, CARLA);

    expect(corrigida[0].funcionarioId).toBe("carla");
    expect(corrigida[0].status).toBe("pronta");
    expect(corrigida[0].origem).toBe("manual");
    expect(paginasEnviaveis(corrigida)).toHaveLength(2);
  });

  it("corrigir para o funcionário errado detectado pelo usuário troca o vínculo", () => {
    const corrigida = corrigirVinculo(conf, 2, ANA);
    expect(corrigida[1].funcionarioId).toBe("ana");
    expect(corrigida[1].email).toBe("ana@colegio.com.br");
  });

  it("correção manual que repete funcionário marca duplicidade nas duas páginas", () => {
    const corrigida = corrigirVinculo(conf, 1, BRUNO);
    expect(corrigida.map((p) => p.duplicada)).toEqual([true, true]);
  });

  it("desvincular volta a página para sem correspondência", () => {
    const corrigida = corrigirVinculo(conf, 2, null);
    expect(corrigida[1].status).toBe("sem_correspondencia");
    expect(corrigida[1].funcionarioId).toBeNull();
  });

  it("remover página tira a página do envio sem renumerar as demais", () => {
    const restante = removerPagina(conf, 2);
    expect(restante.map((p) => p.pagina)).toEqual([1]);
  });
});

describe("senha e textos do email", () => {
  it("usa os 5 primeiros dígitos do CPF, ignorando máscara", () => {
    expect(senhaDoCpf("106.875.516-41")).toBe("10687");
    expect(senhaDoCpf("10687551641")).toBe("10687");
  });

  it("não gera senha com CPF incompleto", () => {
    expect(senhaDoCpf("1068")).toBeNull();
    expect(senhaDoCpf("")).toBeNull();
  });

  it("competência aparece por extenso no assunto e no corpo", () => {
    expect(competenciaExtenso("2026-08")).toBe("agosto/2026");
    expect(assuntoEmailContracheque("2026-08")).toBe("Contracheque — agosto/2026");

    const { html, text } = corpoEmailContracheque({
      nome: "Ana Maria de Souza Ferreira",
      competencia: "2026-08",
    });
    expect(text).toContain("Olá, Ana!");
    expect(text).toContain("agosto/2026");
    expect(text).toContain("5 primeiros dígitos do seu CPF");
    expect(html).toContain("<strong>agosto/2026</strong>");
  });

  it("nome do arquivo identifica funcionário e competência", () => {
    expect(nomeArquivoContracheque("Ana Maria de Souza Ferreira", "2026-08")).toBe(
      "contracheque-ana-maria-de-souza-ferreira-2026-08.pdf",
    );
  });
});

// Erros de leitura do PDF: o motivo precisa chegar ao usuário, porque a ação de
// correção é diferente em cada caso (senha, arquivo escaneado, corrompido…).
// Os erros abaixo são os que o pdfjs 5.x realmente lança (verificado contra a
// lib com PDFs cifrado, escaneado, corrompido e vazio).
describe("classificação de falha na leitura do PDF", () => {
  function erroPdfjs(name: string, message: string, code?: number) {
    const e = new Error(message) as Error & { code?: number };
    e.name = name;
    if (code !== undefined) e.code = code;
    return e;
  }

  it("PDF protegido por senha é identificado como senha ausente", () => {
    expect(classificarErroPdf(erroPdfjs("PasswordException", "No password given", 1))).toBe(
      "senha",
    );
  });

  it("senha errada é distinguida de senha ausente", () => {
    expect(classificarErroPdf(erroPdfjs("PasswordException", "Incorrect Password", 2))).toBe(
      "senha_incorreta",
    );
  });

  it("PDF corrompido e arquivo vazio caem em 'inválido'", () => {
    expect(classificarErroPdf(erroPdfjs("InvalidPDFException", "Invalid PDF structure."))).toBe(
      "invalido",
    );
    expect(
      classificarErroPdf(
        erroPdfjs("InvalidPDFException", "The PDF file is empty, i.e. its size is zero bytes."),
      ),
    ).toBe("invalido");
  });

  it("erro desconhecido não é classificado como senha nem como inválido", () => {
    expect(classificarErroPdf(erroPdfjs("TypeError", "x is not a function"))).toBe("desconhecido");
    expect(classificarErroPdf(null)).toBe("desconhecido");
    expect(classificarErroPdf("falhou")).toBe("desconhecido");
  });

  it("cada motivo vira uma mensagem específica, com a ação de correção", () => {
    expect(mensagemFalhaPdf("senha")).toContain("protegido por senha");
    expect(mensagemFalhaPdf("senha_incorreta")).toContain("não abre");
    expect(mensagemFalhaPdf("invalido")).toContain("corrompido");

    const escaneado = mensagemFalhaPdf("sem_texto", { paginas: 95 });
    expect(escaneado).toContain("95 páginas");
    expect(escaneado).toContain("imagem escaneada");

    const grande = mensagemFalhaPdf("tamanho", { tamanhoMaximoMb: 50, tamanhoMb: 73.4 });
    expect(grande).toContain("50 MB");
    expect(grande).toContain("73.4 MB");
  });

  it("mensagem genérica só sobra para o motivo desconhecido", () => {
    expect(mensagemFalhaPdf("desconhecido")).toContain("Não foi possível ler o PDF");
  });
});

describe("reconstrução do texto da página (itens do pdfjs)", () => {
  function item(str: string, y: number) {
    return { str, transform: [1, 0, 0, 1, 10, y] };
  }

  it("agrupa itens da mesma linha e separa linhas diferentes", () => {
    expect(
      textoDosItens([
        item("Funcionário:", 700),
        item("Ana Maria de Souza Ferreira", 701),
        item("Competência: 06/2026", 680),
      ]),
    ).toBe("Funcionário: Ana Maria de Souza Ferreira\nCompetência: 06/2026");
  });

  it("resposta fora do contrato da lib não quebra a leitura da página", () => {
    // Era isto que estourava "undefined is not a function" no for...of.
    expect(textoDosItens(undefined)).toBe("");
    expect(textoDosItens(null)).toBe("");
    expect(textoDosItens({ items: [] })).toBe("");
    expect(textoDosItens("texto")).toBe("");
    expect(textoDosItens([])).toBe("");
  });

  it("itens inválidos são ignorados sem derrubar os válidos", () => {
    expect(
      textoDosItens([
        null,
        "solto",
        { str: "sem transform" },
        { str: 42, transform: [1, 0, 0, 1, 0, 700] },
        { str: "   ", transform: [1, 0, 0, 1, 0, 700] },
        { str: "sem Y", transform: [1, 0, 0, 1, 0, "x"] },
        item("Valor líquido 2.980,45", 660),
      ]),
    ).toBe("Valor líquido 2.980,45");
  });
});

describe("cadastro incompleto de funcionário", () => {
  it("funcionário sem nome não derruba a conferência dos outros", () => {
    const quebrado = { id: "x", ativo: true } as unknown as FuncionarioContracheque;
    const conf = conferirPaginas([paginaDe(BRUNO.nomeCompleto, 1)], [quebrado, BRUNO]);
    expect(conf[0].funcionarioId).toBe(BRUNO.id);
  });

  it("lista de funcionários vazia ou inválida devolve 'sem correspondência'", () => {
    expect(conferirPaginas([paginaDe(ANA.nomeCompleto, 1)], [])[0].status).toBe(
      "sem_correspondencia",
    );
    expect(
      identificarFuncionarioDaPagina(
        "qualquer texto",
        undefined as unknown as FuncionarioContracheque[],
      ),
    ).toBeNull();
    expect(identificarFuncionarioDaPagina(undefined as unknown as string, EQUIPE)).toBeNull();
  });

  it("email/CPF ausentes no cadastro viram status, não exceção", () => {
    const semNada = {
      id: "z",
      nomeCompleto: "Zeca Pagodinho Silva",
      unidade: "CEC",
      ativo: true,
    } as unknown as FuncionarioContracheque;
    const conf = conferirPaginas([paginaDe("Zeca Pagodinho Silva", 1)], [semNada]);
    expect(conf[0].status).toBe("sem_email");
    expect(conf[0].email).toBe("");
    expect(conf[0].cpf).toBe("");
  });
});

describe("erro técnico não aparece cru para o usuário", () => {
  it("falha conhecida da leitura mantém a mensagem explicativa", () => {
    const erro = new Error("Este PDF está protegido por senha. Informe a senha…");
    erro.name = "ErroLeituraPdf";
    expect(mensagemErroProcessamento(erro)).toContain("protegido por senha");
  });

  it("erro de JavaScript vira mensagem amigável, sem o texto minificado", () => {
    const bug = new TypeError("undefined is not a function (near '...i of e...')");
    const msg = mensagemErroProcessamento(bug);
    expect(msg).toBe(MENSAGEM_ERRO_TECNICO);
    expect(msg).not.toContain("undefined is not a function");
    expect(mensagemErroProcessamento(null)).toBe(MENSAGEM_ERRO_TECNICO);
    expect(mensagemErroProcessamento("boom")).toBe(MENSAGEM_ERRO_TECNICO);
  });

  it("o detalhe técnico é preservado para o log do servidor", () => {
    const bug = new TypeError("a.toHex is not a function");
    const d = detalheTecnicoErro(bug);
    expect(d.name).toBe("TypeError");
    expect(d.message).toBe("a.toHex is not a function");
    expect(d.stack.length).toBeGreaterThan(0);

    const semStack = detalheTecnicoErro("falhou");
    expect(semStack.message).toBe("falhou");
    expect(semStack.stack).toBe("");

    const gigante = new Error("x");
    gigante.stack = "y".repeat(9000);
    expect(detalheTecnicoErro(gigante).stack.length).toBe(4000);
  });
});
