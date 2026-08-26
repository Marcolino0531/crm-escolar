// Desenho da Declaração de Inexistência de Débitos em PDF (A4 retrato), a
// partir do `DeclaracaoDocumento` já montado pela lógica pura — nada é
// calculado aqui, para que reimprimir do histórico produza o mesmo documento.

import {
  nomeArquivoDeclaracao,
  type DeclaracaoDocumento,
} from "@/lib/declaracoes";
import {
  assinatura,
  cabecalhoTimbrado,
  CONTEUDO,
  LARGURA,
  MARGEM,
  type LogoRecibo,
} from "@/lib/documento-pdf";
import { formatarDataBR } from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

export async function gerarPdfDeclaracao(
  declaracao: DeclaracaoDocumento,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = cabecalhoTimbrado(
    doc,
    {
      colegio: declaracao.colegio,
      enderecoColegio: declaracao.enderecoColegio,
      contatoColegio: declaracao.contatoColegio,
    },
    logo,
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("DECLARAÇÃO DE INEXISTÊNCIA DE DÉBITOS", LARGURA / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${declaracao.numero}`, LARGURA - MARGEM, y + 8, { align: "right" });
  y += 20;

  doc.setFontSize(11);
  const linhas = doc.splitTextToSize(declaracao.texto, CONTEUDO) as string[];
  doc.text(linhas, MARGEM, y, { align: "justify", maxWidth: CONTEUDO });
  y += linhas.length * 6 + 10;

  assinatura(doc, declaracao.colegio, declaracao.dataExtenso, y);

  doc.setFontSize(7.5);
  doc.setTextColor(140);
  doc.text(
    `Declaração nº ${declaracao.numero} · emitida em ${formatarDataBR(declaracao.dataDocumento)} · ${
      declaracao.colegio.unidade
    }`,
    MARGEM,
    285,
  );
  doc.setTextColor(0);
  return doc;
}

export async function baixarPdfDeclaracao(
  declaracao: DeclaracaoDocumento,
  logo: LogoRecibo | null,
): Promise<void> {
  const doc = await gerarPdfDeclaracao(declaracao, logo);
  doc.save(nomeArquivoDeclaracao(declaracao));
}
