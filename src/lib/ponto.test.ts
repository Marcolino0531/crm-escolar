import { describe, expect, it } from "vitest";
import {
  agregarDias,
  avaliarDia,
  competenciaDoPdf,
  conferirFolha,
  conferirPagina,
  detectarLayout,
  formatarMinutos,
  identificarFuncionarioPonto,
  linhasDeItens,
  minutosDoHorario,
  parsePaginaPonto,
  rankingAtrasos,
  rankingSaidasAntecipadas,
  resumirFolha,
  resumosProcessados,
  revincularPagina,
  type DiaPonto,
  type FuncionarioPonto,
  type ResumoFuncionario,
} from "./ponto";

const HORARIO = { entrada: "08:00", saida: "18:00" };

function dia(data: string, marcacoes: string[], rotulos: string[] = []): DiaPonto {
  return { data, marcacoes, rotulos, previsto: null };
}

function funcionario(over: Partial<FuncionarioPonto> = {}): FuncionarioPonto {
  return {
    id: "f1",
    nomeCompleto: "ANA CAROLINA CORREIA BARBOSA",
    cpf: "130.281.516-42",
    unidade: "CEC",
    ativo: true,
    horarioInicio: "08:00",
    horarioFim: "18:00",
    ...over,
  };
}

function resumo(over: Partial<ResumoFuncionario> = {}): ResumoFuncionario {
  return {
    funcionarioId: "f1",
    nome: "FULANO",
    pagina: 1,
    diasAtraso: 0,
    minutosAtraso: 0,
    diasAntecipacao: 0,
    minutosAntecipacao: 0,
    diasAvaliados: 0,
    diasInconsistentes: 0,
    dias: [],
    ...over,
  };
}

// Itens no formato do pdfjs (transform[4] = x, transform[5] = y).
function item(texto: string, x: number, y: number) {
  return { str: texto, transform: [1, 0, 0, 1, x, y] };
}

describe("minutosDoHorario / formatarMinutos", () => {
  it("converte HH:MM em minutos e rejeita valores inválidos", () => {
    expect(minutosDoHorario("08:00")).toBe(480);
    expect(minutosDoHorario("7:05")).toBe(425);
    expect(minutosDoHorario("25:00")).toBeNull();
    expect(minutosDoHorario("08:60")).toBeNull();
    expect(minutosDoHorario("")).toBeNull();
    expect(minutosDoHorario("08h00")).toBeNull();
  });

  it("formata o total acumulado em horas e minutos", () => {
    expect(formatarMinutos(0)).toBe("0min");
    expect(formatarMinutos(45)).toBe("45min");
    expect(formatarMinutos(60)).toBe("1h");
    expect(formatarMinutos(125)).toBe("2h05");
  });
});

describe("avaliarDia", () => {
  it("entrada exatamente no horário não é atraso", () => {
    const r = avaliarDia(dia("01/07", ["08:00", "18:00"]), HORARIO);
    expect(r.situacao).toBe("avaliado");
    expect(r.atrasoMin).toBe(0);
    expect(r.antecipacaoMin).toBe(0);
  });

  it("entrada posterior ao esperado conta atraso em minutos", () => {
    const r = avaliarDia(dia("01/07", ["08:12", "18:00"]), HORARIO);
    expect(r.atrasoMin).toBe(12);
    expect(r.antecipacaoMin).toBe(0);
  });

  it("entrada antes do esperado não vira atraso negativo", () => {
    expect(avaliarDia(dia("01/07", ["07:40", "18:00"]), HORARIO).atrasoMin).toBe(0);
  });

  it("saída exatamente no horário não é saída antecipada", () => {
    expect(avaliarDia(dia("01/07", ["08:00", "18:00"]), HORARIO).antecipacaoMin).toBe(0);
  });

  it("saída anterior ao esperado conta saída antecipada em minutos", () => {
    const r = avaliarDia(dia("01/07", ["08:00", "17:25"]), HORARIO);
    expect(r.antecipacaoMin).toBe(35);
    expect(r.atrasoMin).toBe(0);
  });

  it("saída depois do esperado não gera antecipação", () => {
    expect(avaliarDia(dia("01/07", ["08:00", "19:10"]), HORARIO).antecipacaoMin).toBe(0);
  });

  it("atraso e saída antecipada podem acontecer no mesmo dia", () => {
    const r = avaliarDia(dia("01/07", ["08:20", "17:30"]), HORARIO);
    expect(r.atrasoMin).toBe(20);
    expect(r.antecipacaoMin).toBe(30);
  });

  it("usa a primeira entrada e a última saída em jornada de quatro marcações", () => {
    const r = avaliarDia(dia("01/07", ["08:07", "12:04", "13:01", "17:47"]), HORARIO);
    expect(r.entrada).toBe("08:07");
    expect(r.saida).toBe("17:47");
    expect(r.atrasoMin).toBe(7);
    expect(r.antecipacaoMin).toBe(13);
  });

  it("ignora dias de folga, férias, falta, atestado, DSR e DUNT", () => {
    for (const rotulo of ["Folga", "Férias", "Falta", "Atestado", "DSR", "DUNT", "Feriado"]) {
      const r = avaliarDia(dia("01/07", [], [rotulo]), HORARIO);
      expect(r.situacao).toBe("ignorado");
      expect(r.atrasoMin).toBe(0);
      expect(r.antecipacaoMin).toBe(0);
    }
  });

  it("ignora dia sem nenhuma marcação", () => {
    const r = avaliarDia(dia("01/07", []), HORARIO);
    expect(r.situacao).toBe("ignorado");
    expect(r.motivo).toBe("sem marcação");
  });

  it("não transforma marcação parcial em atraso de horas", () => {
    // Caso real do iPonto: bateu à tarde e o turno da manhã veio como Falta.
    const r = avaliarDia(dia("06/07", ["13:08", "17:28"], ["Falta"]), HORARIO);
    expect(r.situacao).toBe("inconsistente");
    expect(r.atrasoMin).toBe(0);
    expect(r.antecipacaoMin).toBe(0);
  });

  it("marca número ímpar de marcações como inconsistente", () => {
    const r = avaliarDia(dia("01/07", ["08:10", "12:00", "13:00"]), HORARIO);
    expect(r.situacao).toBe("inconsistente");
    expect(r.atrasoMin).toBe(0);
  });

  it("aplica a tolerância configurada em minutos", () => {
    const d = dia("01/07", ["08:05", "17:55"]);
    expect(avaliarDia(d, HORARIO, 0).atrasoMin).toBe(5);
    expect(avaliarDia(d, HORARIO, 5).atrasoMin).toBe(0);
    expect(avaliarDia(d, HORARIO, 5).antecipacaoMin).toBe(0);
    expect(avaliarDia(dia("01/07", ["08:11", "18:00"]), HORARIO, 10).atrasoMin).toBe(11);
  });

  it("acusa horário esperado inválido em vez de calcular errado", () => {
    const r = avaliarDia(dia("01/07", ["08:00", "18:00"]), { entrada: "", saida: "18:00" });
    expect(r.situacao).toBe("inconsistente");
  });
});

describe("agregarDias", () => {
  const dias = [
    dia("01/07", ["08:10", "18:00"]), // atraso 10
    dia("02/07", ["08:00", "17:30"]), // antecipação 30
    dia("03/07", ["08:25", "17:40"]), // atraso 25 + antecipação 20
    dia("04/07", [], ["Folga"]),
    dia("05/07", ["08:00", "18:00"]),
    dia("06/07", ["07:50", "18:10"]),
    dia("07/07", ["09:00"]), // inconsistente
  ];

  it("soma dias e minutos acumulados no mês, por tipo", () => {
    const r = agregarDias(dias, HORARIO);
    expect(r.diasAtraso).toBe(2);
    expect(r.minutosAtraso).toBe(35);
    expect(r.diasAntecipacao).toBe(2);
    expect(r.minutosAntecipacao).toBe(50);
    expect(r.diasAvaliados).toBe(5);
    expect(r.diasInconsistentes).toBe(1);
  });

  it("conta o mesmo dia nos dois totais quando houve atraso e saída antecipada", () => {
    const r = agregarDias([dia("03/07", ["08:25", "17:40"])], HORARIO);
    expect(r.diasAtraso).toBe(1);
    expect(r.diasAntecipacao).toBe(1);
    expect(r.minutosAtraso).toBe(25);
    expect(r.minutosAntecipacao).toBe(20);
  });

  it("zera o mês quando a tolerância cobre todas as diferenças", () => {
    const r = agregarDias([dia("01/07", ["08:03", "17:58"])], HORARIO, 5);
    expect(r.diasAtraso).toBe(0);
    expect(r.minutosAtraso).toBe(0);
    expect(r.diasAntecipacao).toBe(0);
  });

  it("mês inteiro sem trabalho (férias) não gera ranking", () => {
    const ferias = Array.from({ length: 30 }, (_, i) => dia(`${i + 1}/07`, [], ["Férias"]));
    const r = agregarDias(ferias, HORARIO);
    expect(r.diasAvaliados).toBe(0);
    expect(r.minutosAtraso).toBe(0);
    expect(r.minutosAntecipacao).toBe(0);
  });
});

describe("rankings", () => {
  const resumos = [
    resumo({
      funcionarioId: "a",
      nome: "ANA",
      diasAtraso: 3,
      minutosAtraso: 40,
      diasAntecipacao: 1,
      minutosAntecipacao: 15,
    }),
    resumo({ funcionarioId: "b", nome: "BRUNO", diasAtraso: 1, minutosAtraso: 120 }),
    resumo({ funcionarioId: "c", nome: "CARLA", diasAntecipacao: 4, minutosAntecipacao: 200 }),
    resumo({ funcionarioId: "d", nome: "DANIEL" }),
  ];

  it("ordena atrasos por minutos e exclui quem não teve atraso", () => {
    expect(rankingAtrasos(resumos)).toEqual([
      { funcionarioId: "b", nome: "BRUNO", dias: 1, minutos: 120 },
      { funcionarioId: "a", nome: "ANA", dias: 3, minutos: 40 },
    ]);
  });

  it("ordena saídas antecipadas separadamente", () => {
    expect(rankingSaidasAntecipadas(resumos)).toEqual([
      { funcionarioId: "c", nome: "CARLA", dias: 4, minutos: 200 },
      { funcionarioId: "a", nome: "ANA", dias: 1, minutos: 15 },
    ]);
  });

  it("o mesmo funcionário pode aparecer nos dois rankings", () => {
    const nos = (r: { funcionarioId: string | null }[]) => r.map((x) => x.funcionarioId);
    expect(nos(rankingAtrasos(resumos))).toContain("a");
    expect(nos(rankingSaidasAntecipadas(resumos))).toContain("a");
  });

  it("desempata por dias e depois por nome, para a ordem não variar", () => {
    const empate = [
      resumo({ funcionarioId: "y", nome: "ZILDA", diasAtraso: 2, minutosAtraso: 60 }),
      resumo({ funcionarioId: "x", nome: "ALICE", diasAtraso: 2, minutosAtraso: 60 }),
      resumo({ funcionarioId: "w", nome: "BEATRIZ", diasAtraso: 5, minutosAtraso: 60 }),
    ];
    expect(rankingAtrasos(empate).map((r) => r.nome)).toEqual(["BEATRIZ", "ALICE", "ZILDA"]);
  });
});

describe("identificarFuncionarioPonto", () => {
  const elenco = [
    funcionario(),
    funcionario({ id: "f2", nomeCompleto: "ADRIANA FERREIRA DO NASCIMENTO", cpf: "12037911602" }),
    funcionario({ id: "f3", nomeCompleto: "MARIA JULIA SOUZA LIMA", cpf: "" }),
  ];

  it("casa por CPF mesmo com nome divergente no PDF", () => {
    const r = identificarFuncionarioPonto(
      { nome: "ADRIANA FEREIRA DO NASCIMENTO", cpf: "120.379.116-02" },
      elenco,
    );
    expect(r?.funcionario.id).toBe("f2");
    expect(r?.origem).toBe("cpf");
  });

  it("cai para o nome quando o CPF do PDF é fictício", () => {
    const r = identificarFuncionarioPonto(
      { nome: "MARIA JULIA SOUZA LIMA", cpf: "00000000008" },
      elenco,
    );
    expect(r?.funcionario.id).toBe("f3");
    expect(r?.origem).toBe("nome");
  });

  it("não adivinha quando o nome do PDF vem truncado", () => {
    expect(identificarFuncionarioPonto({ nome: "MARIA JULIA", cpf: "" }, elenco)).toBeNull();
  });

  it("não casa por CPF duplicado no cadastro", () => {
    const duplicado = [funcionario({ id: "a" }), funcionario({ id: "b" })];
    expect(
      identificarFuncionarioPonto({ nome: "OUTRA PESSOA", cpf: "13028151642" }, duplicado),
    ).toBeNull();
  });
});

describe("linhasDeItens", () => {
  it("agrupa itens pela altura e ordena da esquerda para a direita", () => {
    const linhas = linhasDeItens([
      item("18:00", 250, 700),
      item("08:00", 160, 700),
      item("01/07/2026 - QUA", 40, 700),
      item("02/07/2026 - QUI", 40, 686),
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].texto).toBe("01/07/2026 - QUA 08:00 18:00");
    expect(linhas[1].texto).toBe("02/07/2026 - QUI");
  });

  it("devolve vazio quando a biblioteca entrega algo inesperado", () => {
    expect(linhasDeItens(undefined)).toEqual([]);
    expect(linhasDeItens(null)).toEqual([]);
    expect(linhasDeItens("texto")).toEqual([]);
    expect(linhasDeItens([null, 1, { str: 5 }, { str: "x" }])).toEqual([]);
  });
});

// Layout A — "Cartão de Ponto": previsto impresso na linha do dia e batidas
// sufixadas pela origem, "08:00 (C)".
function paginaCartaoPonto() {
  return [
    item("Cartão de Ponto", 40, 800),
    item("PERÍODO DE 01/07/2026 ATÉ 31/07/2026", 40, 790),
    item("NOME DO FUNCIONÁRIO:", 40, 770),
    item("ANA CAROLINA CORREIA BARBOSA", 95, 770),
    item("CPF DO FUNCIONÁRIO:", 300, 770),
    item("130.281.516-42", 400, 770),
    item("PREVISTO", 91, 750),
    item("NORMAIS", 288, 750),
    item("01/07/2026 - QUA", 40, 730),
    item("08:00-11:30 13:00-17:30", 91, 730),
    item("08:07 (C)", 161, 730),
    item("12:04 (C)", 192, 730),
    item("13:01 (C)", 224, 730),
    item("17:47 (C)", 256, 730),
    item("08:39", 288, 730),
    item("00:07", 320, 730),
    item("02/07/2026 - QUI", 40, 716),
    item("08:00-11:30 13:00-17:30", 91, 716),
    item("Folga", 161, 716),
  ];
}

// Layout B — iPonto: batidas à esquerda e colunas calculadas (H. Trab., H.
// Extra) à direita, ambas "HH:MM".
function paginaIponto() {
  return [
    item("Cartão de Ponto Calculado", 40, 800),
    item("Período de referência: de 01/07/2026 à 31/07/2026", 40, 790),
    item("Nome:", 40, 770),
    item("ADRIANA FEREIRA DO NASCIMENTO", 80, 770),
    item("CPF:120.379.116-02", 40, 758),
    item("Horário de Trabalho", 40, 740),
    item("07:20", 60, 726),
    item("13:00", 86, 726),
    item("14:00", 112, 726),
    item("18:10", 138, 726),
    item("Segunda", 200, 726),
    item("07:20", 60, 714),
    item("13:00", 86, 714),
    item("14:00", 112, 714),
    item("18:10", 138, 714),
    item("Quarta", 200, 714),
    item("H. Trab.", 354, 700),
    item("01/07 qua", 40, 680),
    item("140", 70, 680),
    item("07:19", 88, 680),
    item("12:52", 114, 680),
    item("14:00", 140, 680),
    item("18:10", 166, 680),
    item("07:21", 354, 680),
    item("01:27", 381, 680),
    item("02:00", 407, 680),
    item("02/07 qui", 40, 666),
    item("Falta", 88, 666),
    item("08:00", 354, 666),
  ];
}

describe("parsePaginaPonto", () => {
  it("reconhece o layout Cartão de Ponto e extrai nome, CPF, dias e previsto", () => {
    const linhas = linhasDeItens(paginaCartaoPonto());
    expect(detectarLayout(linhas)).toBe("cartao_ponto");
    const pagina = parsePaginaPonto(3, linhas);
    expect(pagina?.nome).toBe("ANA CAROLINA CORREIA BARBOSA");
    expect(pagina?.cpf).toBe("13028151642");
    expect(pagina?.dias).toHaveLength(2);
    expect(pagina?.dias[0]).toMatchObject({
      data: "01/07",
      marcacoes: ["08:07", "12:04", "13:01", "17:47"],
      previsto: { entrada: "08:00", saida: "17:30" },
    });
    expect(pagina?.dias[1]).toMatchObject({ data: "02/07", marcacoes: [], rotulos: ["FOLGA"] });
  });

  it("não confunde as colunas de totalização com marcações no Cartão de Ponto", () => {
    const pagina = parsePaginaPonto(1, linhasDeItens(paginaCartaoPonto()));
    expect(pagina?.dias[0].marcacoes).not.toContain("08:39");
    expect(pagina?.dias[0].marcacoes).not.toContain("00:07");
  });

  it("reconhece o layout iPonto e extrai nome, CPF e dias", () => {
    const linhas = linhasDeItens(paginaIponto());
    expect(detectarLayout(linhas)).toBe("iponto");
    const pagina = parsePaginaPonto(1, linhas);
    expect(pagina?.nome).toBe("ADRIANA FEREIRA DO NASCIMENTO");
    expect(pagina?.cpf).toBe("12037911602");
    expect(pagina?.dias[0]).toMatchObject({
      data: "01/07",
      marcacoes: ["07:19", "12:52", "14:00", "18:10"],
    });
    expect(pagina?.dias[1]).toMatchObject({ data: "02/07", marcacoes: [], rotulos: ["FALTA"] });
  });

  it("descarta as colunas H. Trab./H. Extra do iPonto, que também são HH:MM", () => {
    const pagina = parsePaginaPonto(1, linhasDeItens(paginaIponto()));
    // 01:27 é hora extra; virar marcação faria a saída ser 1h27 da manhã.
    expect(pagina?.dias[0].marcacoes).toEqual(["07:19", "12:52", "14:00", "18:10"]);
    const avaliado = avaliarDia(pagina!.dias[0], { entrada: "07:20", saida: "18:10" });
    expect(avaliado.saida).toBe("18:10");
    expect(avaliado.antecipacaoMin).toBe(0);
  });

  it("devolve null quando o layout não é reconhecido", () => {
    const linhas = linhasDeItens([item("Relatório qualquer", 40, 700), item("total", 40, 680)]);
    expect(detectarLayout(linhas)).toBeNull();
    expect(parsePaginaPonto(1, linhas)).toBeNull();
  });

  it("devolve null quando a página do layout conhecido não tem nenhum dia", () => {
    const linhas = linhasDeItens([
      item("Cartão de Ponto Calculado", 40, 800),
      item("Nome:", 40, 770),
      item("FULANO DE TAL", 80, 770),
    ]);
    expect(parsePaginaPonto(1, linhas)).toBeNull();
  });

  it("lê a competência impressa nos dois formatos", () => {
    expect(competenciaDoPdf(linhasDeItens(paginaCartaoPonto()))).toBe("2026-07");
    expect(competenciaDoPdf(linhasDeItens(paginaIponto()))).toBe("2026-07");
    expect(competenciaDoPdf(linhasDeItens([item("sem período", 10, 10)]))).toBeNull();
  });
});

describe("conferirFolha", () => {
  const paginas = [
    parsePaginaPonto(1, linhasDeItens(paginaCartaoPonto()))!,
    parsePaginaPonto(2, linhasDeItens(paginaIponto()))!,
  ];

  it("vincula por CPF e calcula contra o horário do cadastro, não o do PDF", () => {
    const elenco = [
      funcionario({ horarioInicio: "08:00", horarioFim: "17:30" }),
      funcionario({
        id: "f2",
        nomeCompleto: "ADRIANA FERREIRA DO NASCIMENTO",
        cpf: "12037911602",
        horarioInicio: "13:00",
        horarioFim: "18:00",
      }),
    ];
    const conferidas = conferirFolha(paginas, elenco);
    expect(conferidas[0]).toMatchObject({ status: "processada", origem: "cpf" });
    expect(conferidas[0].resumo.diasAtraso).toBe(1);
    expect(conferidas[0].resumo.minutosAtraso).toBe(7);
    // Cadastro 13:00–18:00 contra o previsto 07:20–18:10 impresso no PDF.
    expect(conferidas[1].esperado).toEqual({ entrada: "13:00", saida: "18:00" });
    expect(conferidas[1].previstoNoPdf).toEqual({ entrada: "07:20", saida: "18:10" });
    expect(resumirFolha(conferidas).horarioDivergente).toBe(1);
  });

  it("sinaliza página sem correspondência e a mantém fora do ranking", () => {
    const conferidas = conferirFolha(paginas, [
      funcionario({ nomeCompleto: "PESSOA SEM RELAÇÃO NENHUMA", cpf: "99999999999" }),
    ]);
    expect(conferidas.map((c) => c.status)).toEqual(["sem_correspondencia", "sem_correspondencia"]);
    expect(resumosProcessados(conferidas)).toEqual([]);
    expect(rankingAtrasos(resumosProcessados(conferidas))).toEqual([]);
    expect(resumirFolha(conferidas).semCorrespondencia).toBe(2);
  });

  it("sinaliza funcionário sem horário cadastrado sem calcular nada", () => {
    const conferida = conferirPagina(paginas[0], [funcionario({ horarioInicio: "" })]);
    expect(conferida.status).toBe("sem_horario");
    expect(conferida.resumo.diasAtraso).toBe(0);
    expect(conferida.resumo.dias).toEqual([]);
  });

  it("vínculo manual força o funcionário escolhido e recalcula a página", () => {
    const conferidas = conferirFolha(paginas, []);
    expect(conferidas[0].status).toBe("sem_correspondencia");
    const revinculadas = revincularPagina(
      conferidas,
      paginas,
      1,
      funcionario({ id: "manual", nomeCompleto: "OUTRA PESSOA", cpf: "00000000000" }),
    );
    expect(revinculadas[0]).toMatchObject({
      status: "processada",
      origem: "manual",
      funcionarioId: "manual",
    });
    expect(revinculadas[0].resumo.diasAntecipacao).toBe(1);
    expect(revinculadas[0].resumo.minutosAntecipacao).toBe(13);
    expect(revinculadas[1].status).toBe("sem_correspondencia");
  });

  it("desvincular uma página a remove do cálculo", () => {
    const conferidas = conferirFolha(paginas, [funcionario()]);
    const soltas = revincularPagina(conferidas, paginas, 1, null);
    expect(soltas[0].status).toBe("sem_correspondencia");
    expect(resumosProcessados(soltas)).toEqual([]);
  });
});
