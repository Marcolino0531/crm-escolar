import { describe, expect, it } from "vitest";
import { montarSecoesDetalhe, type EntradaDetalhe } from "@/lib/matricula-detalhe";
import { nomeArquivoFichaAluno } from "@/lib/matricula-detalhe-pdf";
import { DOCUMENTOS_MATRICULA, PERGUNTAS_SAUDE } from "@/lib/matricula-form";

function entradaCompleta(): EntradaDetalhe {
  return {
    submissao: {
      submissionId: "site-teste-1",
      unidade: "Núcleo Belvedere",
      alunoNome: "Aluno De Teste",
      alunoCpf: "111.222.333-96",
      status: "Erro no aluno",
      criadoEm: "01/09/2026 18:41",
      sponteAlunoId: null,
      erro: "Conversão inválida no Sponte",
      payload: {
        unidade: "Núcleo Belvedere",
        aluno: {
          nome: "Aluno De Teste",
          dataNascimento: "2020-03-15",
          cpf: "111.222.333-96",
          rg: "MG-12.345.678",
          sexo: "Masculino",
          naturalidade: "Belo Horizonte",
          nacionalidade: "Brasileira",
          email: "aluno@example.com",
          telefone: "3132000000",
          celular: "31990000000",
          observacao: "Chega sempre acompanhado da avó",
        },
        endereco: {
          cep: "30320-000",
          numero: "120",
          complemento: "Apto 302",
          logradouro: "Rua das Acácias",
          bairro: "Belvedere",
          cidade: "Belo Horizonte",
        },
        responsaveis: [
          {
            nome: "Mãe De Teste",
            parentesco: "Mãe",
            cpf: "222.333.444-05",
            rg: "MG-22.333.444",
            dataNascimento: "1990-01-10",
            sexo: "Feminino",
            profissao: "Arquiteta",
            email: "mae@example.com",
            telefone: "3132000001",
            celular: "31990000001",
            responsavelFinanceiro: true,
            responsavelDidatico: false,
          },
          {
            nome: "Pai De Teste",
            parentesco: "Pai",
            cpf: "333.444.555-14",
            profissao: "Engenheiro",
            email: "pai@example.com",
            celular: "31990000002",
            responsavelFinanceiro: false,
            responsavelDidatico: true,
          },
        ],
      },
    },
    rotina: {
      serie: "Infantil 3",
      origem: "matricula",
      anoLetivo: 2027,
      dataInicio: "2027-01-25",
      diasAtivos: [1, 2, 3],
      periodoManha: true,
      periodoTarde: false,
      horarioEstendido: false,
      horarios: [{ weekday: 1, entrada: "07:20", saida: "11:50" }],
      semRefeicoes: false,
      refeicoes: { breakfast: [1, 2], lunch: [1] },
    },
    saude: {
      contatoEmergencia: "Avó Materna · 31990000003 · Avó",
      alergia: "Sim",
      alergiaDetalhe: "Amendoim",
      problemaSaude: "Não",
      problemaSaudeDetalhe: "",
      medicamentoContinuo: "Sim",
      medicamentoContinuoDetalhe: "Bombinha para asma",
      planoSaude: "Sim",
      planoSaudeDetalhe: "Plano Exemplo",
      pessoasAutorizadas: "Tia De Teste · 31990000004 · Tia · 444.555.666-23",
      corRaca: "Parda",
      outrasInformacoes: "Dorme à tarde",
    },
    documentos: [
      {
        documento: "certidao_ou_rg",
        nomeArquivo: "certidao.pdf",
        tipoArquivo: "application/pdf",
        tamanhoBytes: 2048,
        url: "https://exemplo/assinado",
      },
      {
        documento: "carteira_vacinacao",
        nomeArquivo: "vacina.jpg",
        tipoArquivo: "image/jpeg",
        tamanhoBytes: 500,
        url: null,
      },
    ],
  };
}

function valores(secoes: ReturnType<typeof montarSecoesDetalhe>): string {
  return secoes
    .flatMap((s) => s.grupos.flatMap((g) => g.campos.map((c) => `${c.rotulo}=${c.valor}`)))
    .join("\n");
}

describe("montarSecoesDetalhe", () => {
  it("organiza a ficha nas quatro seções do formulário", () => {
    const secoes = montarSecoesDetalhe(entradaCompleta());
    expect(secoes.map((s) => s.titulo)).toEqual([
      "Dados do Aluno e Responsáveis",
      "Rotina Escolar",
      "Questionário de Saúde",
      "Documentos",
    ]);
  });

  it("carrega todos os campos salvos da submissão", () => {
    const texto = valores(montarSecoesDetalhe(entradaCompleta()));

    for (const esperado of [
      "Aluno De Teste",
      "15/03/2020",
      "111.222.333-96",
      "MG-12.345.678",
      "Belo Horizonte",
      "Brasileira",
      "Chega sempre acompanhado da avó",
      "Rua das Acácias",
      "Apto 302",
      "30320-000",
      "Mãe De Teste",
      "Responsável financeiro",
      "Arquiteta",
      "Pai De Teste",
      "Responsável didático",
      "Infantil 3",
      "2027",
      "Seg, Ter, Qua",
      "Manhã",
      "07:20 às 11:50",
      "Lanche da Manhã=Seg, Ter",
      "Almoço=Seg",
      "Avó Materna",
      "Sim — Amendoim",
      "Sim — Bombinha para asma",
      "Sim — Plano Exemplo",
      "Tia De Teste",
      "Parda",
      "Dorme à tarde",
      "certidao.pdf · 2 KB",
      "vacina.jpg · 500 B",
    ])
      expect(texto).toContain(esperado);
    for (const contatoDoAluno of ["aluno@example.com", "3132000000", "31990000000"])
      expect(texto).not.toContain(contatoDoAluno);
  });

  it("mostra as datas de nascimento e o início da rotina em dd/mm/aaaa", () => {
    const texto = valores(montarSecoesDetalhe(entradaCompleta()));
    expect(texto).toContain("Data de nascimento=15/03/2020");
    expect(texto).toContain("Data de nascimento=10/01/1990");
    expect(texto).toContain("Início=25/01/2027");
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("data vazia continua traço e valor que não é data válida aparece como está", () => {
    const entrada = entradaCompleta();
    const payload = entrada.submissao.payload as {
      aluno: { dataNascimento?: string };
      responsaveis: { dataNascimento?: string }[];
    };
    payload.aluno.dataNascimento = "2020-02-30";
    payload.responsaveis[0].dataNascimento = "";
    entrada.rotina = { ...entrada.rotina!, dataInicio: "a combinar" };
    const texto = valores(montarSecoesDetalhe(entrada));
    expect(texto).toContain("Data de nascimento=2020-02-30");
    expect(texto).toContain("Data de nascimento=—");
    expect(texto).toContain("Início=a combinar");
  });

  it("mantém o link assinado só nos documentos que têm arquivo disponível", () => {
    const documentos = montarSecoesDetalhe(entradaCompleta())[3].grupos[0].campos;
    expect(documentos[0].link).toBe("https://exemplo/assinado");
    expect(documentos[1].link).toBeUndefined();
  });

  it("abre a ficha de submissões que falharam antes de rotina, saúde e documentos", () => {
    const entrada = entradaCompleta();
    const texto = valores(
      montarSecoesDetalhe({ ...entrada, rotina: null, saude: null, documentos: [] }),
    );

    expect(texto).toContain("Aluno De Teste");
    expect(texto).toContain("Conversão inválida no Sponte");
    expect(texto).toContain("Rotina escolar=Não enviada");
    expect(texto).toContain("Questionário de saúde=Não enviado");
    expect(texto).toContain("Documentos=Nenhum documento anexado");
  });

  it("cai no que a submissão gravou quando o payload não bate com o formato esperado", () => {
    const entrada = entradaCompleta();
    const texto = valores(
      montarSecoesDetalhe({ ...entrada, submissao: { ...entrada.submissao, payload: "quebrado" } }),
    );

    expect(texto).toContain("Nome=Aluno De Teste");
    expect(texto).toContain("CPF=111.222.333-96");
  });
});

describe("montarSecoesDetalhe — ficha do aluno (rematrícula ou cadastro manual)", () => {
  function entradaFichaAluno(origem: string): EntradaDetalhe {
    const base = entradaCompleta();
    return {
      submissao: {
        ...base.submissao,
        submissionId: null,
        status: origem,
        criadoEm: "",
        erro: null,
      },
      rotina: null,
      saude: null,
      documentos: [],
      fichaAluno: {
        origem,
        anoLetivo: 2027,
        snapshot: {
          matricula_valor: null,
          matricula_parcelas: null,
          matricula_primeiro_vencimento: null,
          material_valor_anual: null,
          material_parcelas: null,
        },
        extras: null,
      },
    };
  }

  it("mostra a origem no topo, sem os campos da submissão", () => {
    for (const origem of ["Rematrícula 2027", "Cadastro manual no Sponte"]) {
      const topo = montarSecoesDetalhe(entradaFichaAluno(origem))[0].grupos[0];
      expect(topo.titulo).toBe("Ficha do aluno");
      expect(topo.campos.find((c) => c.rotulo === "Origem")?.valor).toBe(origem);
      expect(topo.campos.find((c) => c.rotulo === "Ano letivo")?.valor).toBe("2027");
      expect(topo.campos.some((c) => c.rotulo === "Protocolo")).toBe(false);
    }
  });

  it("sem rotina, saúde e documentos, as seções saem em branco para preencher à mão", () => {
    const secoes = montarSecoesDetalhe(entradaFichaAluno("Cadastro manual no Sponte"));
    expect(secoes.map((s) => s.titulo)).toEqual([
      "Dados do Aluno e Responsáveis",
      "Rotina Escolar",
      "Questionário de Saúde",
      "Documentos",
    ]);
    const texto = valores(secoes);
    expect(texto).not.toContain("Não enviad");
    expect(texto).not.toContain("Nenhum documento anexado");

    const rotina = secoes[1].grupos.flatMap((g) => g.campos);
    expect(rotina.find((c) => c.rotulo === "Série")?.valor).toMatch(/^_+$/);
    expect(rotina.find((c) => c.rotulo === "Períodos")?.valor).toContain("( ) Manhã");

    const saude = secoes[2].grupos.flatMap((g) => g.campos);
    for (const p of PERGUNTAS_SAUDE) {
      const v = saude.find((c) => c.rotulo === p.pergunta)?.valor ?? "";
      expect(v).toContain("( ) Sim  ( ) Não");
      expect(v).toMatch(/Qual\? _+/);
    }
    expect(saude.find((c) => c.rotulo === "Cor/raça")?.valor).toContain("( ) ");

    const docs = secoes[3].grupos.flatMap((g) => g.campos);
    expect(docs.map((c) => c.rotulo)).toEqual(DOCUMENTOS_MATRICULA.map((d) => d.rotulo));
    expect(docs.every((c) => c.valor === "( ) Entregue")).toBe(true);
  });

  it("usa a rotina, a saúde e os documentos que existirem", () => {
    const completa = entradaCompleta();
    const secoes = montarSecoesDetalhe({
      ...entradaFichaAluno("Rematrícula 2027"),
      rotina: completa.rotina,
      saude: completa.saude,
      documentos: completa.documentos,
    });
    const texto = valores(secoes);
    expect(texto).toContain("Série=Infantil 3");
    expect(texto).toContain("Bombinha para asma");
    expect(texto).toContain("certidao.pdf");
    expect(texto).not.toContain("( ) Entregue");
  });

  it("financeiro só aparece com as escolhas da rematrícula que existirem", () => {
    const entrada = entradaFichaAluno("Rematrícula 2027");
    entrada.fichaAluno!.snapshot = {
      matricula_valor: 500,
      matricula_parcelas: 2,
      matricula_primeiro_vencimento: "2026-11-10",
      material_valor_anual: null,
      material_parcelas: null,
    };
    entrada.fichaAluno!.extras = ["Almoço"];
    const titulos = montarSecoesDetalhe(entrada).map((s) => s.titulo);
    expect(titulos).toContain("Matrícula");
    expect(titulos).toContain("Extras");
    expect(titulos).not.toContain("Material pedagógico");
    expect(titulos).not.toContain("Mensalidades");
    expect(titulos).not.toContain("Integração");
  });

  it("a ficha do formulário continua como antes", () => {
    const completa = entradaCompleta();
    const texto = valores(
      montarSecoesDetalhe({ ...completa, rotina: null, saude: null, documentos: [] }),
    );
    expect(texto).toContain("Rotina escolar=Não enviada");
    expect(texto).toContain("Documentos=Nenhum documento anexado");
  });
});

describe("nomeArquivoFichaAluno", () => {
  it("gera ficha-aluno-<nome>.pdf sem acentos", () => {
    expect(nomeArquivoFichaAluno("Aluno Ção De Teste")).toBe("ficha-aluno-aluno-cao-de-teste.pdf");
    expect(nomeArquivoFichaAluno("")).toBe("ficha-aluno-aluno.pdf");
  });
});
