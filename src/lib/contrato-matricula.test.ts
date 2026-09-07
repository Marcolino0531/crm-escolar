import { describe, expect, it } from "vitest";
import {
  CAMPOS_CONTRATO,
  TEXTO_SEM_EXTRAS,
  TEXTO_SEM_MATERIAL,
  extrasDoContrato,
  listarComE,
  montarCamposContrato,
  montarContratoMatricula,
  numeroBR,
  numeroContrato,
  preencherModelo,
  validarContrato,
  valorComDesconto,
  type MontarContratoInput,
  type TituloExtras,
} from "@/lib/contrato-matricula";
import { MODELO_CONTRATO } from "@/lib/contrato-matricula-modelo";

const HOJE = "2026-09-14";
const ANO = 2026;

function titulo(over: Partial<TituloExtras>): TituloExtras {
  return {
    categoria: "Almoço",
    vencimento: "2026-10-10",
    valor: 100,
    situacao: "Em aberto",
    quitada: false,
    ...over,
  };
}

function entrada(over: Partial<MontarContratoInput> = {}): MontarContratoInput {
  return {
    numeroContrato: "2027-CEC-4321",
    anoLetivo: 2027,
    colegio: {
      unidade: "CEC",
      razaoSocial: "Centro Educacional Cidadão Ltda",
      nomeFantasia: "CEC",
      cnpj: "12.345.678/0001-90",
      endereco: "Rua das Flores",
      numero: "100",
      complemento: "",
      bairro: "Centro",
      cidade: "Belo Horizonte",
      uf: "MG",
      cep: "30.000-000",
      email: "contato@cec.com.br",
      representanteNome: "Maria Diretora",
      representanteCpf: "111.222.333-44",
    },
    responsavel: {
      nome: "João da Silva",
      cpf: "123.456.789-00",
      email: "joao@email.com",
      telefone: "31999990000",
      endereco: "Av. Brasil",
      numero: "200",
      complemento: "Apto 301",
      bairro: "Savassi",
      cidade: "Belo Horizonte",
      uf: "MG",
      cep: "30.100-000",
    },
    alunoNome: "Pedro da Silva",
    serie: "3º Ano",
    matricula: { valor: 1250.5, parcelas: 3, primeiroVencimento: "2026-10-10" },
    mensalidade: { valor: 2000, descontoPercentual: 30, vencimento: "2026-10-10" },
    material: {
      itens: ["Coleção Principal (Bernoulli)", "Robótica"],
      valorTotal: 3439.1,
      parcelas: 8,
    },
    extras: extrasDoContrato(
      [
        titulo({ categoria: "Hora Extra", valor: 350 }),
        titulo({ categoria: "Almoço", valor: 420.5 }),
      ],
      ANO,
    ),
    hojeISO: HOJE,
    ...over,
  };
}

describe("extrasDoContrato (retrato do contas a receber do Sponte)", () => {
  it("aceita só as cinco categorias recorrentes e ignora o resto", () => {
    const r = extrasDoContrato(
      [
        titulo({ categoria: "Mensalidade", valor: 2000 }),
        titulo({ categoria: "Material Pedagógico", valor: 400 }),
        titulo({ categoria: "Hora Extra", valor: 300 }),
        titulo({ categoria: "Lanche da Manhã", valor: 90 }),
        titulo({ categoria: "Almoço", valor: 400 }),
        titulo({ categoria: "Lanche da Tarde", valor: 95 }),
        titulo({ categoria: "Jantar", valor: 380 }),
        titulo({ categoria: "Recarga Cantina", valor: 50 }),
      ],
      ANO,
    );
    expect(r.categorias).toEqual([
      "Hora Extra",
      "Lanche da Manhã",
      "Almoço",
      "Lanche da Tarde",
      "Jantar",
    ]);
    expect(r.valorMensal).toBe(1265);
    expect(r.lista).toBe("Hora Extra, Lanche da Manhã, Almoço, Lanche da Tarde e Jantar");
  });

  it("não repete categoria: a primeira parcela do ano por categoria entra na soma", () => {
    const r = extrasDoContrato(
      [
        titulo({ categoria: "Almoço", vencimento: "2026-09-10", valor: 400 }),
        titulo({ categoria: "Almoço", vencimento: "2026-10-10", valor: 420 }),
        titulo({ categoria: "Almoço", vencimento: "2026-11-10", valor: 420 }),
        titulo({ categoria: "Jantar", vencimento: "2026-10-10", valor: 380 }),
      ],
      ANO,
    );
    expect(r.categorias).toEqual(["Almoço", "Jantar"]);
    expect(r.valorMensal).toBe(780);
    expect(r.lista).toBe("Almoço e Jantar");
  });

  it("usa a primeira parcela do ano letivo, mesmo já vencida", () => {
    const r = extrasDoContrato(
      [
        titulo({ categoria: "Hora Extra", vencimento: "2026-06-10", valor: 300 }),
        titulo({ categoria: "Hora Extra", vencimento: "2026-08-10", valor: 330 }),
      ],
      ANO,
    );
    expect(r.valorMensal).toBe(300);
  });

  it("só entram títulos do ano letivo do contrato (caso Ryan: Hora Extra quitada de 2025 fora)", () => {
    const r = extrasDoContrato(
      [
        titulo({
          categoria: "Hora Extra",
          vencimento: "2025-03-10",
          valor: 160,
          situacao: "Quitada",
          quitada: true,
        }),
        titulo({
          categoria: "Hora Extra",
          vencimento: "2025-04-10",
          valor: 160,
          situacao: "Quitada",
          quitada: true,
        }),
        titulo({ categoria: "Almoço", vencimento: "2026-10-10", valor: 90 }),
        titulo({ categoria: "Almoço", vencimento: "2027-02-05", valor: 100 }),
        titulo({ categoria: "Almoço", vencimento: "2027-03-05", valor: 100 }),
        titulo({ categoria: "Lanche da Tarde", vencimento: "2027-02-05", valor: 150 }),
      ],
      2027,
    );
    expect(r.categorias).toEqual(["Almoço", "Lanche da Tarde"]);
    expect(r.valorMensal).toBe(250);
    expect(r.lista).toBe("Almoço e Lanche da Tarde");

    const r2026 = extrasDoContrato(
      [
        titulo({ categoria: "Almoço", vencimento: "2026-10-10", valor: 90 }),
        titulo({ categoria: "Almoço", vencimento: "2027-02-05", valor: 100 }),
      ],
      2026,
    );
    expect(r2026.valorMensal).toBe(90);
  });

  it("ignora parcelas canceladas/estornadas e valores zerados", () => {
    const r = extrasDoContrato(
      [
        titulo({ categoria: "Jantar", situacao: "Cancelada" }),
        titulo({ categoria: "Almoço", valor: 0 }),
        titulo({ categoria: "Hora Extra", situacao: "Estornada" }),
      ],
      ANO,
    );
    expect(r.categorias).toEqual([]);
    expect(r.valorMensal).toBe(0);
    expect(r.lista).toBe(TEXTO_SEM_EXTRAS);
  });

  it("casa a categoria sem depender de acento/caixa", () => {
    const r = extrasDoContrato([titulo({ categoria: "LANCHE DA MANHA", valor: 90 })], ANO);
    expect(r.categorias).toEqual(["Lanche da Manhã"]);
  });

  it("fallback exato quando não há extras", () => {
    expect(extrasDoContrato([], ANO).lista).toBe(
      "Não há serviços extras contratados nesta rematrícula.",
    );
  });

  it("soma em centavos sem erro de ponto flutuante", () => {
    const r = extrasDoContrato(
      [titulo({ categoria: "Almoço", valor: 0.1 }), titulo({ categoria: "Jantar", valor: 0.2 })],
      ANO,
    );
    expect(r.valorMensal).toBe(0.3);
  });
});

describe("listarComE", () => {
  it("formata 1, 2 e 3+ itens", () => {
    expect(listarComE(["A"])).toBe("A");
    expect(listarComE(["A", "B"])).toBe("A e B");
    expect(listarComE(["A", "B", "C"])).toBe("A, B e C");
  });
});

describe("montarCamposContrato — valores monetários", () => {
  const campos = montarCamposContrato(entrada());

  it("preenche todos os campos do modelo, sem lacunas", () => {
    for (const nome of CAMPOS_CONTRATO) {
      expect(campos[nome], nome).not.toBe("");
    }
  });

  it("matrícula: valor, extenso, parcelas e 1º vencimento", () => {
    expect(campos.ValorMatricula).toBe("1.250,50");
    expect(campos.ValorMatriculaExtenso).toBe(
      "mil duzentos e cinquenta reais e cinquenta centavos",
    );
    expect(campos.NumeroParcelasMatricula).toBe("3");
    expect(campos.DataVencimento1aParcelaMatricula).toBe("10 de outubro de 2026");
  });

  it("mensalidade: integral, desconto e valor com desconto (extenso)", () => {
    expect(campos.ValorMensalidade).toBe("2.000,00");
    expect(campos.ValorMensalidadeExtenso).toBe("dois mil reais");
    expect(campos.PercentualDesconto).toBe("30");
    expect(campos.ValorMensalidadeComDesconto).toBe("1.400,00");
    expect(campos.ValorMensalidadeComDescontoExtenso).toBe("mil e quatrocentos reais");
    expect(campos.DiaVencimentoMensalidade).toBe("10");
    expect(campos.PercentualBolsaMensalidade).toBe("30%");
  });

  it("material: lista, total e parcelas", () => {
    expect(campos.ListaMaterialPedagogicoSelecionado).toBe(
      "Coleção Principal (Bernoulli) e Robótica",
    );
    expect(campos.ValorTotalMaterialPedagogico).toBe("3.439,10");
    expect(campos.NumeroParcelasMaterialPedagogico).toBe("8");
  });

  it("extras: lista e soma mensal do retrato do Sponte", () => {
    expect(campos.ListaExtrasSelecionados).toBe("Hora Extra e Almoço");
    expect(campos.ValorTotalExtrasMensal).toBe("770,50");
  });

  it("colégio e representante legal (CPF, não OAB)", () => {
    expect(campos.RazaoSocialColegio).toBe("Centro Educacional Cidadão Ltda");
    expect(campos.EnderecoColegio).toBe("Rua das Flores, 100, Centro, Belo Horizonte/MG");
    expect(campos.NomeRepresentanteLegal).toBe("Maria Diretora");
    expect(campos.CPFRepresentanteLegal).toBe("111.222.333-44");
  });

  it("data da geração por extenso", () => {
    expect(campos.DiaAtual).toBe("14");
    expect(campos.MesAtualExtenso).toBe("setembro");
    expect(campos.AnoAtual).toBe("2026");
  });

  it("sem desconto: 0% e 'Não há bolsa de desconto'", () => {
    const c = montarCamposContrato(
      entrada({ mensalidade: { valor: 1500, descontoPercentual: 0, vencimento: "2026-10-05" } }),
    );
    expect(c.PercentualDesconto).toBe("0");
    expect(c.ValorMensalidadeComDesconto).toBe("1.500,00");
    expect(c.PercentualBolsaMensalidade).toBe("Não há bolsa de desconto");
    expect(c.DiaVencimentoMensalidade).toBe("5");
  });

  it("desconto fracionário arredonda em centavos", () => {
    expect(valorComDesconto(1999.99, 7.5)).toBe(1849.99);
    expect(numeroBR(1849.99)).toBe("1.849,99");
  });
});

describe("montarContratoMatricula — texto do modelo", () => {
  it("todos os «campos» do modelo são substituídos", () => {
    const doc = montarContratoMatricula(entrada());
    const texto = doc.paragrafos.map((p) => p.texto).join("\n");
    expect(texto).not.toMatch(/«|»/);
    expect(texto).toContain("MATRÍCULA: R$1.250,50 (mil duzentos e cinquenta reais");
    expect(texto).toContain(
      "MENSALIDADE: R$2.000,00, com desconto de 30% aplicado, resultando no valor mensal de R$1.400,00 (mil e quatrocentos reais)",
    );
    expect(texto).toContain("EXTRAS: Hora Extra e Almoço, no valor mensal total de R$770,50");
    expect(texto).not.toContain("este bloco é substituído por");
    expect(doc.fecho).toBe("Belo Horizonte, 14 de setembro de 2026.");
  });

  it("preserva a estrutura do modelo (mesma quantidade de parágrafos e títulos)", () => {
    const doc = montarContratoMatricula(entrada());
    expect(doc.paragrafos).toHaveLength(MODELO_CONTRATO.length);
    expect(doc.paragrafos.filter((p) => p.tipo === "titulo")).toHaveLength(
      MODELO_CONTRATO.filter((p) => p.tipo === "titulo").length,
    );
    expect(doc.paragrafos.at(-1)?.texto).toMatch(/^Eu abaixo assinado/);
  });

  it("sem material e sem extras: blocos trocados pelos textos de fallback", () => {
    const doc = montarContratoMatricula(
      entrada({ material: null, extras: extrasDoContrato([], ANO) }),
    );
    const texto = doc.paragrafos.map((p) => p.texto).join("\n");
    expect(texto).toContain(`MATERIAL PEDAGÓGICO: ${TEXTO_SEM_MATERIAL}`);
    expect(texto).toContain(`EXTRAS: ${TEXTO_SEM_EXTRAS}`);
    expect(texto).not.toContain("no valor total de R$0,00");
  });

  it("assinaturas: contratante, contratado (CPF do representante) e testemunhas fixas", () => {
    const doc = montarContratoMatricula(entrada());
    expect(doc.assinaturas.map((a) => a.nome)).toEqual([
      "João da Silva",
      "Maria Diretora",
      "Márcia Regina Ribeiro Marcolino",
      "Anna Clara Marcolino Ribeiro",
    ]);
    expect(doc.assinaturas[1].cpf).toBe("111.222.333-44");
    expect(doc.assinaturas[2].cpf).toBe("631.466.656-20");
    expect(doc.assinaturas[3].cpf).toBe("157.432.546-99");
  });

  it("os extras do documento são um retrato: mudar o Sponte depois não altera o contrato montado", () => {
    const titulos = [titulo({ categoria: "Almoço", valor: 400 })];
    const doc = montarContratoMatricula(entrada({ extras: extrasDoContrato(titulos, ANO) }));
    titulos.push(titulo({ categoria: "Jantar", valor: 380 }));
    expect(doc.campos.ListaExtrasSelecionados).toBe("Almoço");
    expect(doc.campos.ValorTotalExtrasMensal).toBe("400,00");
  });
});

describe("validarContrato / numeroContrato / preencherModelo", () => {
  it("aponta o que falta antes de gerar", () => {
    const e = entrada();
    e.colegio.representanteCpf = "";
    e.responsavel.email = "";
    e.mensalidade.valor = 0;
    expect(validarContrato(e)).toEqual([
      "CPF do representante legal (Dados dos Colégios)",
      "E-mail do responsável financeiro (signatário)",
      "Mensalidade vigente no Sponte",
    ]);
    expect(validarContrato(entrada())).toEqual([]);
  });

  it("número do contrato por unidade/aluno/ano", () => {
    expect(numeroContrato("CEC", "4321", 2027)).toBe("2027-CEC-4321");
    expect(numeroContrato("CEC Baby", "7", 2027)).toBe("2027-CECB-7");
    expect(numeroContrato("Núcleo Belvedere", "9", 2027)).toBe("2027-NBV-9");
    expect(numeroContrato("Núcleo Vale do Sereno", "9", 2027)).toBe("2027-NVS-9");
  });

  it("campo desconhecido fica visível em vez de sumir", () => {
    const campos = montarCamposContrato(entrada());
    expect(preencherModelo("x «NaoExiste» «NomeAluno»", campos)).toBe(
      "x «NaoExiste» Pedro da Silva",
    );
  });
});
