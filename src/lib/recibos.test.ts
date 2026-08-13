import { describe, expect, it } from "vitest";
import {
  calcularTotalRecibo,
  dataPorExtenso,
  enderecoLinha,
  formatarNumeroRecibo,
  itensDoRecibo,
  montarRecibo,
  nomeArquivoRecibo,
  validarRecibo,
  valorPorExtenso,
  type AlunoRecibo,
  type ColegioRecibo,
  type ResponsavelRecibo,
} from "./recibos";

const COLEGIO: ColegioRecibo = {
  unidade: "CEC",
  razaoSocial: "Centro Educacional Castelo Ltda",
  nomeFantasia: "CEC",
  cnpj: "12.345.678/0001-99",
  inscricaoMunicipal: "0987654",
  endereco: "Rua Castelo Rodrigo",
  numero: "155",
  complemento: "",
  bairro: "Castelo",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "31.330-160",
  telefone: "(31) 3333-4444",
  email: "contato@cec.com",
  site: "cec.com.br",
  assinanteNome: "Sérgio Ribeiro",
  assinanteCargo: "Diretor Financeiro",
  observacao: "Documento válido para fins de imposto de renda.",
};

const ALUNO: AlunoRecibo = {
  alunoId: "672",
  nome: "Bento Ferreira Santos",
  cpf: "177.237.336-23",
  turma: "09 - 3º Ano M",
  matricula: "20250880",
};

const RESPONSAVEL: ResponsavelRecibo = {
  responsavelId: "1062",
  nome: "Dayane Maria Gomes Ferreira",
  cpf: "106.875.516-41",
  parentesco: "Mãe",
  endereco: "Rua Castelo Rodrigo",
  numero: "155",
  bairro: "Castelo",
  cidade: "Belo Horizonte",
  cep: "31.330-160",
  email: "dayane@example.com",
  telefone: "(31) 98657-8378",
  financeiro: true,
};

describe("itensDoRecibo", () => {
  it("inclui só os tópicos preenchidos, na ordem do formulário", () => {
    const itens = itensDoRecibo({ material_pedagogico: 480.5, mensalidade: 1200 });
    expect(itens.map((i) => i.id)).toEqual(["mensalidade", "material_pedagogico"]);
    expect(itens[1].descricao).toBe("Material Pedagógico");
  });

  it("descarta zerados, negativos e não numéricos", () => {
    const itens = itensDoRecibo({
      mensalidade: 0,
      matricula: -100,
      uniforme: Number.NaN,
      outros: 25,
    });
    expect(itens).toEqual([{ id: "outros", descricao: "Outros", valor: 25 }]);
  });

  it("recibo sem nenhum valor preenchido não tem itens", () => {
    expect(itensDoRecibo({})).toEqual([]);
  });
});

describe("calcularTotalRecibo", () => {
  it("soma os itens preenchidos", () => {
    const itens = itensDoRecibo({ mensalidade: 1200, material_pedagogico: 480.5, uniforme: 199.9 });
    expect(calcularTotalRecibo(itens)).toBe(1880.4);
  });

  it("não acumula erro de ponto flutuante", () => {
    const itens = itensDoRecibo({ mensalidade: 0.1, matricula: 0.2 });
    expect(calcularTotalRecibo(itens)).toBe(0.3);
  });

  it("total de recibo vazio é zero", () => {
    expect(calcularTotalRecibo([])).toBe(0);
  });

  it("arredonda centavos digitados com mais de duas casas", () => {
    const itens = itensDoRecibo({ mensalidade: 100.005, matricula: 33.333 });
    expect(calcularTotalRecibo(itens)).toBe(133.34);
  });
});

describe("valorPorExtenso", () => {
  it.each([
    [0, "zero reais"],
    [1, "um real"],
    [1.01, "um real e um centavo"],
    [0.5, "cinquenta centavos"],
    [100, "cem reais"],
    [1200, "mil e duzentos reais"],
    [1880.4, "mil oitocentos e oitenta reais e quarenta centavos"],
    [2150, "dois mil cento e cinquenta reais"],
    [16856.87, "dezesseis mil oitocentos e cinquenta e seis reais e oitenta e sete centavos"],
  ])("%s → %s", (valor, extenso) => {
    expect(valorPorExtenso(valor)).toBe(extenso);
  });
});

describe("data e numeração", () => {
  it("data por extenso a partir do ISO, sem deslocar por fuso", () => {
    expect(dataPorExtenso("2026-08-14")).toBe("14 de agosto de 2026");
    expect(dataPorExtenso("2026-03-01")).toBe("1 de março de 2026");
  });

  it("número sequencial com o ano da data escolhida", () => {
    expect(formatarNumeroRecibo(7, "2026-08-14")).toBe("00007/2026");
    expect(formatarNumeroRecibo(1234, "2025-12-31")).toBe("01234/2025");
  });
});

describe("enderecoLinha", () => {
  it("monta rua, bairro, cidade/UF e CEP", () => {
    expect(enderecoLinha(COLEGIO)).toBe(
      "Rua Castelo Rodrigo, 155 — Castelo, Belo Horizonte/MG — CEP 31.330-160",
    );
  });

  it("omite os campos que o Sponte não devolveu", () => {
    expect(enderecoLinha({ endereco: "Rua A", cidade: "Nova Lima" })).toBe("Rua A — Nova Lima");
  });
});

describe("montarRecibo", () => {
  const doc = montarRecibo({
    numero: 7,
    dataRecibo: "2026-08-14",
    colegio: COLEGIO,
    aluno: ALUNO,
    responsavel: RESPONSAVEL,
    valores: { mensalidade: 1200, material_pedagogico: 480.5, uniforme: 199.9, matricula: 0 },
  });

  it("leva os dados do colégio cadastrado para o documento", () => {
    expect(doc.colegio.razaoSocial).toBe("Centro Educacional Castelo Ltda");
    expect(doc.colegio.cnpj).toBe("12.345.678/0001-99");
    expect(doc.enderecoColegio).toContain("Rua Castelo Rodrigo, 155");
    expect(doc.contatoColegio).toBe("(31) 3333-4444 · contato@cec.com · cec.com.br");
    expect(doc.colegio.assinanteNome).toBe("Sérgio Ribeiro");
  });

  it("leva os dados do aluno e do responsável escolhido", () => {
    expect(doc.aluno).toEqual(ALUNO);
    expect(doc.responsavel.nome).toBe("Dayane Maria Gomes Ferreira");
    expect(doc.responsavel.cpf).toBe("106.875.516-41");
    expect(doc.responsavel.parentesco).toBe("Mãe");
    expect(doc.enderecoResponsavel).toContain("Castelo, Belo Horizonte");
  });

  it("lista apenas os tópicos preenchidos, com o total somado e por extenso", () => {
    expect(doc.itens.map((i) => [i.descricao, i.valor])).toEqual([
      ["Mensalidade", 1200],
      ["Material Pedagógico", 480.5],
      ["Uniforme", 199.9],
    ]);
    expect(doc.total).toBe(1880.4);
    expect(doc.totalFormatado).toBe("R$ 1.880,40");
    expect(doc.totalExtenso).toBe("mil oitocentos e oitenta reais e quarenta centavos");
  });

  it("usa a data escolhida e a cidade do colégio no local e data", () => {
    expect(doc.numero).toBe("00007/2026");
    expect(doc.dataRecibo).toBe("2026-08-14");
    expect(doc.dataExtenso).toBe("Belo Horizonte, 14 de agosto de 2026");
  });

  it("nomeia o arquivo pelo número e pelo aluno, sem acento", () => {
    expect(nomeArquivoRecibo(doc)).toBe("recibo-00007-2026-Bento-Ferreira-Santos.pdf");
  });

  it("responsável não financeiro é aceito no documento", () => {
    const outro = montarRecibo({
      numero: 8,
      dataRecibo: "2026-08-14",
      colegio: COLEGIO,
      aluno: ALUNO,
      responsavel: {
        ...RESPONSAVEL,
        responsavelId: "1061",
        nome: "Luiz Cláudio Viana dos Santos",
        cpf: "098.131.236-56",
        parentesco: "Pai",
        financeiro: false,
      },
      valores: { mensalidade: 1200 },
    });
    expect(outro.responsavel.nome).toBe("Luiz Cláudio Viana dos Santos");
    expect(outro.responsavel.financeiro).toBe(false);
    expect(outro.total).toBe(1200);
  });
});

describe("validarRecibo", () => {
  const base = {
    colegio: COLEGIO,
    aluno: ALUNO,
    responsavel: RESPONSAVEL,
    itens: itensDoRecibo({ mensalidade: 1200 }),
    dataRecibo: "2026-08-14",
  };

  it("recibo completo não tem impedimento", () => {
    expect(validarRecibo(base)).toEqual([]);
  });

  it("exige colégio cadastrado, aluno, responsável, data e ao menos um valor", () => {
    const erros = validarRecibo({
      colegio: { ...COLEGIO, razaoSocial: "", cnpj: "" },
      aluno: null,
      responsavel: null,
      itens: [],
      dataRecibo: "",
    });
    expect(erros).toHaveLength(6);
    expect(erros[0]).toContain("razão social");
    expect(erros.at(-1)).toContain("pelo menos um tópico");
  });
});
