import { describe, expect, it } from "vitest";

import {
  anoIRPadrao,
  anoReferenciaIR,
  anosIRDisponiveis,
  categoriaDedutivel,
  montarDeclaracaoIR,
  pagamentosIR,
  totalPagamentosIR,
  validarDeclaracaoIR,
  type ParcelaIR,
} from "@/lib/imposto-renda";
import type { AlunoRecibo, ColegioRecibo } from "@/lib/recibos";

function parcela(p: Partial<ParcelaIR>): ParcelaIR {
  return {
    categoria: "Mensalidade",
    numeroParcela: "1/12",
    valorPago: 1000,
    dataPagamento: "2025-03-10",
    ...p,
  };
}

const COLEGIO: ColegioRecibo = {
  unidade: "CEC",
  razaoSocial: "Centro Educacional Continuado Ltda",
  nomeFantasia: "CEC",
  cnpj: "12.345.678/0001-90",
  inscricaoMunicipal: "",
  endereco: "Rua das Flores",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "30000-000",
  telefone: "",
  email: "contato@cec.com.br",
  site: "",
  assinanteNome: "Diretora",
  assinanteCargo: "Direção",
  observacao: "",
};

const ALUNO: AlunoRecibo = {
  alunoId: "672",
  nome: "Bento Ribeiro",
  cpf: "111.111.111-11",
  turma: "3º ano",
  matricula: "2025-672",
};

describe("ano de referência do IR", () => {
  it("IR do ano X declara os pagamentos do ano X-1", () => {
    expect(anoReferenciaIR(2027)).toBe(2026);
    expect(anoReferenciaIR(2026)).toBe(2025);
    expect(anoReferenciaIR(2025)).toBe(2024);
  });

  it("oferece o exercício atual, o próximo e os anteriores", () => {
    expect(anosIRDisponiveis("2026-08-18", 3)).toEqual([2027, 2026, 2025]);
    expect(anoIRPadrao("2026-08-18")).toBe(2026);
  });
});

describe("filtro por data de pagamento", () => {
  it("inclui só pagamentos baixados dentro do ano civil de referência", () => {
    const parcelas = [
      parcela({ dataPagamento: "2024-12-31", valorPago: 900 }),
      parcela({ dataPagamento: "2025-01-01", valorPago: 100 }),
      parcela({ dataPagamento: "2025-12-31", valorPago: 200 }),
      parcela({ dataPagamento: "2026-01-01", valorPago: 800 }),
    ];

    const linhas = pagamentosIR(parcelas, 2026);

    expect(linhas.map((l) => l.dataPagamento)).toEqual(["2025-01-01", "2025-12-31"]);
    expect(totalPagamentosIR(linhas)).toBe(300);
  });

  it("ignora o vencimento: quem manda é a data de pagamento", () => {
    // Mensalidade de dezembro/2025 paga em janeiro/2026 entra no IR 2027.
    const atrasada = parcela({ dataPagamento: "2026-01-08", valorPago: 1500 });
    expect(pagamentosIR([atrasada], 2026)).toEqual([]);
    expect(pagamentosIR([atrasada], 2027)).toHaveLength(1);
  });

  it("descarta parcela sem data de pagamento válida", () => {
    const linhas = pagamentosIR(
      [
        parcela({ dataPagamento: "" }),
        parcela({ dataPagamento: "0000-00-00" }),
        parcela({ dataPagamento: "10/03/2025" }),
      ],
      2026,
    );
    expect(linhas).toEqual([]);
  });
});

describe("filtro por categoria", () => {
  it("aceita apenas Matrícula e Mensalidade, pelo nome inteiro", () => {
    expect(categoriaDedutivel("Matrícula")).toBe("Matrícula");
    expect(categoriaDedutivel("MENSALIDADE")).toBe("Mensalidade");
    expect(categoriaDedutivel("matricula")).toBe("Matrícula");
    expect(categoriaDedutivel("Material Pedagógico")).toBeNull();
    expect(categoriaDedutivel("Mensalidade Esportes")).toBeNull();
    expect(categoriaDedutivel("Cantina")).toBeNull();
    expect(categoriaDedutivel("Evento")).toBeNull();
  });

  it("exclui as demais categorias da tabela e do total", () => {
    const parcelas = [
      parcela({ categoria: "Matrícula", numeroParcela: "1/1", valorPago: 500 }),
      parcela({ categoria: "Mensalidade", valorPago: 1200 }),
      parcela({ categoria: "Material Pedagógico", valorPago: 700 }),
      parcela({ categoria: "Cantina", valorPago: 50 }),
      parcela({ categoria: "Evento", valorPago: 80 }),
    ];

    const linhas = pagamentosIR(parcelas, 2026);

    expect(linhas.map((l) => l.categoria)).toEqual(["Matrícula", "Mensalidade"]);
    expect(totalPagamentosIR(linhas)).toBe(1700);
  });
});

describe("parcelas não pagas", () => {
  it("exclui parcela em aberto (sem valor pago), mesmo com data no ano", () => {
    const linhas = pagamentosIR(
      [
        parcela({ valorPago: 0 }),
        parcela({ valorPago: -10 }),
        parcela({ valorPago: 1000, dataPagamento: "2025-05-05" }),
      ],
      2026,
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0].valor).toBe(1000);
  });
});

describe("total do ano", () => {
  it("soma exatamente as linhas listadas, sem arraste de centavos", () => {
    const parcelas = [
      parcela({ dataPagamento: "2025-02-05", valorPago: 1234.56 }),
      parcela({ dataPagamento: "2025-03-05", valorPago: 0.1 }),
      parcela({ dataPagamento: "2025-04-05", valorPago: 0.2 }),
      parcela({ dataPagamento: "2024-04-05", valorPago: 999 }),
    ];

    const linhas = pagamentosIR(parcelas, 2026);
    const total = totalPagamentosIR(linhas);

    expect(linhas).toHaveLength(3);
    expect(total).toBe(1234.86);
    expect(total).toBe(linhas.reduce((acc, l) => acc + Math.round(l.valor * 100), 0) / 100);
  });
});

describe("montagem do documento", () => {
  it("usa a unidade do aluno, o responsável financeiro e o total do ano", () => {
    const doc = montarDeclaracaoIR({
      numero: 7,
      anoIR: 2026,
      dataDocumento: "2026-03-15",
      colegio: COLEGIO,
      aluno: ALUNO,
      responsavelNome: "Maria Ribeiro",
      responsavelCpf: "222.222.222-22",
      parcelas: [
        parcela({ categoria: "Matrícula", numeroParcela: "1/1", valorPago: 800 }),
        parcela({ dataPagamento: "2025-04-10", valorPago: 1200 }),
        parcela({ categoria: "Cantina", dataPagamento: "2025-04-11", valorPago: 60 }),
        parcela({ dataPagamento: "2026-02-10", valorPago: 1300 }),
      ],
    });

    expect(doc.anoReferencia).toBe(2025);
    expect(doc.pagamentos.map((p) => p.dataPagamento)).toEqual(["2025-03-10", "2025-04-10"]);
    expect(doc.total).toBe(2000);
    expect(doc.colegio.cnpj).toBe("12.345.678/0001-90");
    expect(doc.texto).toContain("Maria Ribeiro");
    expect(doc.texto).toContain("222.222.222-22");
    expect(doc.texto).toContain("Bento Ribeiro");
    expect(doc.texto).toContain("2025");
  });

  it("bloqueia a emissão sem pagamentos no ano ou sem CNPJ da unidade", () => {
    expect(
      validarDeclaracaoIR({
        colegio: COLEGIO,
        aluno: ALUNO,
        dataDocumento: "2026-03-15",
        pagamentos: [],
      }),
    ).toContain("Nenhum pagamento de Matrícula ou Mensalidade no ano selecionado.");

    const erros = validarDeclaracaoIR({
      colegio: { ...COLEGIO, cnpj: "" },
      aluno: ALUNO,
      dataDocumento: "2026-03-15",
      pagamentos: pagamentosIR([parcela({})], 2026),
    });
    expect(erros).toEqual(["Cadastre o CNPJ do colégio em Configurações → Dados dos Colégios."]);
  });
});
