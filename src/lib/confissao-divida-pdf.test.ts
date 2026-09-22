import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { espacoJustificado, gerarPdfTermoConfissao } from "@/lib/confissao-divida-pdf";
import { montarTermoConfissao } from "@/lib/confissao-divida";
import { CONTEUDO, MARGEM } from "@/lib/documento-pdf";

const MM_PARA_PT = 72 / 25.4;

const colegio = {
  unidade: "CEC",
  razaoSocial: "Centro Educacional Ltda",
  nomeFantasia: "CEC",
  cnpj: "00.000.000/0001-00",
  inscricaoMunicipal: "",
  endereco: "Rua A",
  numero: "1",
  complemento: "",
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "30000-000",
  telefone: "",
  email: "",
  site: "",
  assinanteNome: "",
  assinanteCargo: "",
  observacao: "",
  representanteNome: "Sérgio Marcolino",
  representanteOab: "",
};

const devedor = {
  id: "d1",
  nome: "Maria Silva",
  cpf: "529.982.247-25",
  dataNascimento: "",
  endereco: "Rua B",
  numero: "2",
  complemento: "",
  bairro: "Bairro",
  cidade: "Belo Horizonte",
  uf: "MG",
  cep: "30000-000",
  email: "",
  telefone: "",
  solidario: false,
  origem: "manual" as const,
};

export function termoDeTeste() {
  return montarTermoConfissao({
    numero: 7,
    dataDocumento: "2026-08-29",
    colegio,
    alunos: [{ alunoId: "1", matricula: "1", nome: "Aluno Teste" }],
    devedores: [devedor],
    testemunhas: [],
    anoLetivo: "2026",
    formaPagamento: "boleto",
    valorTotal: 1200,
    parcelas: [
      { numero: 1, valor: 600, vencimento: "2026-09-10" },
      { numero: 2, valor: 600, vencimento: "2026-10-10" },
    ],
  });
}

interface LinhaPdf {
  y: number;
  esquerda: number;
  direita: number;
}

/** Agrupa os itens de texto da 1ª página por linha (mesmo Y), em pt. */
async function linhasDaPrimeiraPagina(buffer: ArrayBuffer): Promise<LinhaPdf[]> {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(1);
  const conteudo = await page.getTextContent();
  const porY = new Map<number, LinhaPdf>();
  for (const it of conteudo.items) {
    if (!("str" in it) || it.str.trim() === "") continue;
    const x = it.transform[4];
    const y = Math.round(it.transform[5] * 10) / 10;
    const linha = porY.get(y) ?? { y, esquerda: x, direita: x };
    linha.esquerda = Math.min(linha.esquerda, x);
    linha.direita = Math.max(linha.direita, x + it.width);
    porY.set(y, linha);
  }
  return [...porY.values()].sort((a, b) => b.y - a.y);
}

describe("espacoJustificado", () => {
  it("distribui a sobra igualmente entre os intervalos das linhas internas", () => {
    // 4 palavras → 3 intervalos; sobra de 30 → +10 em cada.
    expect(espacoJustificado(140, 4, 2, false, 170)).toBe(12);
  });

  it("última linha e linha de uma palavra ficam com o espaço normal", () => {
    expect(espacoJustificado(140, 4, 2, true, 170)).toBe(2);
    expect(espacoJustificado(40, 1, 2, false, 170)).toBe(2);
  });

  it("linha já cheia (ou um fio maior) não encolhe o espaço", () => {
    expect(espacoJustificado(170, 4, 2, false, 170)).toBe(2);
    expect(espacoJustificado(170.4, 4, 2, false, 170)).toBe(2);
  });
});

describe("gerarPdfTermoConfissao — justificação", () => {
  it("linhas internas dos parágrafos terminam na margem direita; última linha não", async () => {
    const doc = await gerarPdfTermoConfissao(termoDeTeste(), null);
    const linhas = await linhasDaPrimeiraPagina(doc.output("arraybuffer") as ArrayBuffer);

    const esquerda = MARGEM * MM_PARA_PT;
    const direita = (MARGEM + CONTEUDO) * MM_PARA_PT;
    // Linhas de parágrafo: começam na margem esquerda e ocupam boa parte da
    // coluna (títulos, "ALUNO (A)" e cabeçalho são bem mais curtos).
    const paragrafo = linhas.filter(
      (l) =>
        Math.abs(l.esquerda - esquerda) < 0.5 &&
        l.direita - l.esquerda > 0.7 * (direita - esquerda),
    );
    expect(paragrafo.length).toBeGreaterThan(8);

    const justificadas = paragrafo.filter((l) => Math.abs(l.direita - direita) < 0.6);
    const curtas = paragrafo.filter((l) => direita - l.direita > 5);
    // A maioria das linhas de parágrafo fecha exatamente na coluna; as que sobram
    // são as últimas de cada parágrafo (mais curtas, sem esticar).
    expect(justificadas.length).toBeGreaterThan(paragrafo.length / 2);
    expect(curtas.length).toBeGreaterThan(0);
    expect(justificadas.length + curtas.length).toBe(paragrafo.length);
  });
});
