// Desenho da Declaração de Imposto de Renda em PDF (A4 retrato), a partir do
// `DeclaracaoIRDocumento` já montado pela lógica pura — nada é filtrado nem
// somado aqui, para que reimprimir do histórico produza o mesmo documento.

import {
  assinatura,
  cabecalhoTimbrado,
  CONTEUDO,
  LARGURA,
  MARGEM,
  type LogoRecibo,
} from "@/lib/documento-pdf";
import { nomeArquivoDeclaracaoIR, type DeclaracaoIRDocumento } from "@/lib/imposto-renda";
import { formatarBRL, formatarDataBR } from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

const ALTURA_LINHA = 7;
const RODAPE_Y = 275;

function cabecalhoTabela(doc: Doc, y: number, colunas: readonly number[]): number {
  doc.setFillColor(240, 240, 240);
  doc.rect(MARGEM, y, CONTEUDO, ALTURA_LINHA, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Data do pagamento", colunas[0], y + 5);
  doc.text("Categoria", colunas[1], y + 5);
  doc.text("Parcela", colunas[2], y + 5);
  doc.text("Valor pago", colunas[3], y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  return y + ALTURA_LINHA;
}

export async function gerarPdfDeclaracaoIR(
  declaracao: DeclaracaoIRDocumento,
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
  doc.setFontSize(13);
  doc.text("DECLARAÇÃO PARA FINS DE IMPOSTO DE RENDA", LARGURA / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${declaracao.numero}`, LARGURA - MARGEM, y + 7, { align: "right" });
  doc.text(
    `Exercício ${declaracao.anoIR} · ano-calendário ${declaracao.anoReferencia}`,
    MARGEM,
    y + 7,
  );
  y += 16;

  // Cabeçalho de identificação: aluno + responsável financeiro (dados do Sponte).
  doc.setFontSize(10);
  const identificacao = [
    `Aluno(a): ${declaracao.aluno.nome}`,
    `Responsável financeiro: ${declaracao.responsavelNome || "—"}`,
    `CPF do responsável financeiro: ${declaracao.responsavelCpf || "—"}`,
  ];
  for (const linha of identificacao) {
    doc.text(linha, MARGEM, y, { maxWidth: CONTEUDO });
    y += 5;
  }
  y += 4;

  doc.setFontSize(10.5);
  const linhasTexto = doc.splitTextToSize(declaracao.texto, CONTEUDO) as string[];
  doc.text(linhasTexto, MARGEM, y, { align: "justify", maxWidth: CONTEUDO });
  y += linhasTexto.length * 5 + 6;

  const xValor = LARGURA - MARGEM - 2;
  const colunas = [MARGEM + 2, MARGEM + 42, MARGEM + 100, xValor] as const;
  y = cabecalhoTabela(doc, y, colunas);

  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
  doc.setFontSize(9.5);
  for (const p of declaracao.pagamentos) {
    if (y > RODAPE_Y - 30) {
      doc.addPage();
      y = MARGEM;
      y = cabecalhoTabela(doc, y, colunas);
      doc.setFontSize(9.5);
    }
    doc.text(formatarDataBR(p.dataPagamento), colunas[0], y + 5);
    doc.text(p.categoria, colunas[1], y + 5);
    doc.text(p.parcela || "—", colunas[2], y + 5);
    doc.text(formatarBRL(p.valor), colunas[3], y + 5, { align: "right" });
    doc.line(MARGEM, y + ALTURA_LINHA, LARGURA - MARGEM, y + ALTURA_LINHA);
    y += ALTURA_LINHA;
  }

  doc.setFont("helvetica", "bold");
  doc.setFillColor(240, 240, 240);
  doc.rect(MARGEM, y, CONTEUDO, ALTURA_LINHA, "F");
  doc.text(`Total pago em ${declaracao.anoReferencia}`, colunas[0], y + 5);
  doc.text(declaracao.totalFormatado, colunas[3], y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += ALTURA_LINHA + 12;

  if (y > RODAPE_Y - 45) {
    doc.addPage();
    y = MARGEM;
  }
  assinatura(doc, declaracao.colegio, declaracao.dataExtenso, y);

  doc.setFontSize(7.5);
  doc.setTextColor(140);
  doc.text(
    `Declaração de IR nº ${declaracao.numero} · emitida em ${formatarDataBR(
      declaracao.dataDocumento,
    )} · ${declaracao.colegio.unidade}`,
    MARGEM,
    285,
  );
  doc.setTextColor(0);
  return doc;
}

export async function baixarPdfDeclaracaoIR(
  declaracao: DeclaracaoIRDocumento,
  logo: LogoRecibo | null,
): Promise<void> {
  const doc = await gerarPdfDeclaracaoIR(declaracao, logo);
  doc.save(nomeArquivoDeclaracaoIR(declaracao));
}
