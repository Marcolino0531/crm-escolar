import { describe, expect, it } from "vitest";
import { montarSecoesDetalhe, type EntradaDetalhe } from "@/lib/matricula-detalhe";

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
      "2020-03-15",
      "111.222.333-96",
      "MG-12.345.678",
      "Belo Horizonte",
      "Brasileira",
      "aluno@example.com",
      "31990000000",
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
