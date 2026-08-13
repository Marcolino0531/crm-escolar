import { describe, it, expect } from "vitest";
import {
  assuntoEmailContracheque,
  competenciaExtenso,
  conferirPaginas,
  corpoEmailContracheque,
  corrigirVinculo,
  identificarFuncionarioDaPagina,
  nomeArquivoContracheque,
  paginasEnviaveis,
  removerPagina,
  resumirConferencia,
  senhaDoCpf,
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
