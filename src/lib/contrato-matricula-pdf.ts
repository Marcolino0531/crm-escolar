// Desenho do Contrato de Matrícula em PDF (A4 retrato) a partir do
// `ContratoMatriculaDocumento` já montado pela lógica pura. A logo do cabeçalho
// é a da unidade do aluno (Dados dos Colégios), passada por quem chama.

import { cabecalhoTimbrado, CONTEUDO, LARGURA, MARGEM, type LogoRecibo } from "@/lib/documento-pdf";
import type { ColegioRecibo } from "@/lib/recibos";
import type { ContratoMatriculaDocumento } from "@/lib/contrato-matricula";

type Doc = import("jspdf").jsPDF;

const RODAPE_Y = 275;
const ALTURA_LINHA = 4.6;

function garantirEspaco(doc: Doc, y: number, necessario: number): number {
  if (y + necessario <= RODAPE_Y) return y;
  doc.addPage();
  return MARGEM;
}

// O jsPDF só calcula o espaçamento entre palavras (operador Tw) quando recebe
// várias linhas numa única chamada de text(); linha a linha, Tw fica sempre 0.
// Por isso as linhas de uma mesma página são desenhadas juntas. O jsPDF deixa
// a última linha do bloco sem justificar (convenção do fim de parágrafo); quando
// o bloco é cortado por quebra de página, uma linha vazia no fim faz todas as
// linhas reais receberem Tw.
function paragrafo(doc: Doc, texto: string, y: number, negrito = false): number {
  doc.setFont("helvetica", negrito ? "bold" : "normal");
  const linhas = doc.splitTextToSize(texto, CONTEUDO) as string[];
  const fatorLinha = ALTURA_LINHA / (doc.getFontSize() / doc.internal.scaleFactor);
  let bloco: string[] = [];
  let yBloco = y;
  const desenharBloco = (fimDoParagrafo: boolean) => {
    if (bloco.length === 0) return;
    const conteudo = fimDoParagrafo ? bloco : [...bloco, ""];
    doc.text(conteudo.join("\n"), MARGEM, yBloco, {
      align: "justify",
      maxWidth: CONTEUDO,
      lineHeightFactor: fatorLinha,
    });
    bloco = [];
  };
  linhas.forEach((linha) => {
    if (y + ALTURA_LINHA > RODAPE_Y) {
      desenharBloco(false);
      y = garantirEspaco(doc, y, ALTURA_LINHA);
      yBloco = y;
    }
    bloco.push(linha);
    y += ALTURA_LINHA;
  });
  desenharBloco(true);
  doc.setFont("helvetica", "normal");
  return y;
}

function linhaAssinatura(doc: Doc, y: number, papel: string, nome: string, cpf: string): number {
  y = garantirEspaco(doc, y, 26);
  y += 12;
  doc.setDrawColor(90);
  doc.setLineWidth(0.3);
  doc.line(MARGEM, y, MARGEM + 90, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(papel, MARGEM, y + 4.5, { maxWidth: CONTEUDO });
  doc.setFont("helvetica", "normal");
  doc.text(nome, MARGEM, y + 9, { maxWidth: CONTEUDO });
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  doc.text(`CPF: ${cpf}`, MARGEM, y + 13);
  doc.setTextColor(0);
  return y + 16;
}

export interface TimbreContrato {
  colegio: ColegioRecibo;
  enderecoColegio: string;
  contatoColegio: string;
}

export async function gerarPdfContratoMatricula(
  contrato: ContratoMatriculaDocumento,
  timbre: TimbreContrato,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = cabecalhoTimbrado(doc, timbre, logo);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text(contrato.titulo, LARGURA / 2, y, { align: "center", maxWidth: CONTEUDO });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(timbre.colegio.unidade, MARGEM, y + 7);
  y += 12;

  doc.setFontSize(9.5);
  for (const p of contrato.paragrafos) {
    if (p.tipo === "titulo") {
      y = garantirEspaco(doc, y + 2, 12);
      y = paragrafo(doc, p.texto, y, true);
      continue;
    }
    y = paragrafo(doc, p.texto, y);
    y += 1.5;
  }

  y = garantirEspaco(doc, y + 4, 16);
  doc.text(contrato.fecho, LARGURA - MARGEM, y, { align: "right" });
  y += 4;

  for (const a of contrato.assinaturas) {
    y = linhaAssinatura(doc, y, a.papel, a.nome, a.cpf);
  }

  return doc;
}
