import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { gerarPdfContratoMatricula } from "@/lib/contrato-matricula-pdf";
import {
  extrasDoContrato,
  montarContratoMatricula,
  type MontarContratoInput,
} from "@/lib/contrato-matricula";

// PNG 1x1 vermelho, para o cabeçalho receber uma logo de verdade.
const LOGO_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function entrada(): MontarContratoInput {
  return {
    numeroContrato: "2027-CECB-555",
    anoLetivo: 2027,
    colegio: {
      unidade: "CEC Baby",
      razaoSocial: "CEC Baby Educação Infantil Ltda",
      nomeFantasia: "CEC Baby",
      cnpj: "98.765.432/0001-10",
      endereco: "Rua Azul",
      numero: "10",
      complemento: "",
      bairro: "Bairro",
      cidade: "Belo Horizonte",
      uf: "MG",
      cep: "30.200-000",
      email: "baby@cec.com.br",
      representanteNome: "Ana Representante",
      representanteCpf: "222.333.444-55",
    },
    responsavel: {
      nome: "Carla Souza",
      cpf: "987.654.321-00",
      email: "carla@email.com",
      telefone: "31988880000",
      endereco: "Rua Verde",
      numero: "5",
      complemento: "",
      bairro: "Jardim",
      cidade: "Belo Horizonte",
      uf: "MG",
      cep: "30.300-000",
    },
    alunoNome: "Lia Souza",
    serie: "Maternal 3",
    matricula: { valor: 980, parcelas: 2, primeiroVencimento: "2026-11-05" },
    mensalidade: { valor: 1850.75, descontoPercentual: 10, vencimento: "2026-11-05" },
    material: null,
    extras: extrasDoContrato(
      [
        {
          categoria: "Hora Extra",
          vencimento: "2026-11-05",
          valor: 310.4,
          situacao: "Em aberto",
          quitada: false,
        },
        {
          categoria: "Jantar",
          vencimento: "2026-11-05",
          valor: 289.6,
          situacao: "Em aberto",
          quitada: false,
        },
      ],
      "2026-09-20",
    ),
    hojeISO: "2026-09-20",
  };
}

async function textoDoPdf(bytes: ArrayBuffer): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const partes: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const conteudo = await page.getTextContent();
    partes.push(
      conteudo.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  return partes.join("\n");
}

describe("gerarPdfContratoMatricula", () => {
  it("o PDF traz os valores monetários corretos, o fallback de material e a data", async () => {
    const contrato = montarContratoMatricula(entrada());
    const c = entrada().colegio;
    const doc = await gerarPdfContratoMatricula(
      contrato,
      {
        colegio: {
          unidade: c.unidade,
          razaoSocial: c.razaoSocial,
          nomeFantasia: c.nomeFantasia,
          cnpj: c.cnpj,
          inscricaoMunicipal: "",
          endereco: c.endereco,
          numero: c.numero,
          complemento: "",
          bairro: c.bairro,
          cidade: c.cidade,
          uf: c.uf,
          cep: c.cep,
          telefone: "",
          email: c.email,
          site: "",
          assinanteNome: "",
          assinanteCargo: "",
          observacao: "",
        },
        enderecoColegio: "Rua Azul, 10 — Bairro, Belo Horizonte/MG",
        contatoColegio: "baby@cec.com.br",
      },
      { dataUrl: LOGO_PNG, largura: 1, altura: 1 },
    );
    const texto = await textoDoPdf(doc.output("arraybuffer") as ArrayBuffer);

    expect(texto).toContain("CONTRATO PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS");
    expect(texto).toContain("N° DO CONTRATO: 2027-CECB-555");
    expect(texto).toContain("R$980,00 (novecentos e oitenta reais)");
    expect(texto).toContain("parcelada em 2x");
    expect(texto).toContain("R$1.850,75, com desconto de 10% aplicado");
    expect(texto).toMatch(
      /R\$1\.665,68 \(mil seiscentos e sessenta e cinco reais e sessenta e oito\s+centavos\)/,
    );
    expect(texto).toContain("todo dia 5 de cada mês");
    expect(texto).toContain("Não há material pedagógico contratado nesta matrícula.");
    expect(texto).toContain("EXTRAS: Hora Extra e Jantar");
    expect(texto).toContain("R$600,00");
    expect(texto).toContain("Bolsa de desconto: 10%");
    expect(texto).toContain("Belo Horizonte, 20 de setembro de 2026.");
    expect(texto).toContain("Ana Representante");
    expect(texto).toContain("CPF: 222.333.444-55");
    expect(texto).toContain("Márcia Regina Ribeiro Marcolino");
    expect(texto).toContain("CPF: 157.432.546-99");
    expect(texto).not.toMatch(/«|»/);
    // Cabeçalho timbrado da unidade do aluno (CEC Baby), não uma unidade fixa.
    expect(texto).toContain("CEC Baby");
    expect(texto).toContain("CNPJ 98.765.432/0001-10");
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
