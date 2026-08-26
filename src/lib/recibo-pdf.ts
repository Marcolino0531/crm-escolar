// Desenho do recibo em PDF (A4 retrato), a partir do `ReciboDocumento` já
// montado pela lógica pura. Nada é calculado aqui: o total, o valor por extenso
// e a data já vêm resolvidos, para que reimprimir do histórico produza
// exatamente o mesmo documento.

import {
  assinatura,
  cabecalhoTimbrado,
  carregarLogo,
  CONTEUDO,
  LARGURA,
  MARGEM,
  type LogoRecibo,
} from "@/lib/documento-pdf";
import {
  formatarBRL,
  formatarDataBR,
  nomeArquivoRecibo,
  type ReciboDocumento,
} from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

export { carregarLogo };
export type { LogoRecibo };

function titulo(doc: Doc, recibo: ReciboDocumento, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("RECIBO", LARGURA / 2, y, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${recibo.numero}`, LARGURA - MARGEM, y - 4, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(recibo.totalFormatado, LARGURA - MARGEM, y + 2, { align: "right" });
  return y + 12;
}

function corpo(doc: Doc, recibo: ReciboDocumento, y: number): number {
  const r = recibo.responsavel;
  const a = recibo.aluno;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  const texto =
    `Recebemos de ${r.nome}${r.cpf ? `, CPF ${r.cpf}` : ""}` +
    `${r.parentesco ? ` (${r.parentesco})` : ""}, a quantia de ${recibo.totalFormatado} ` +
    `(${recibo.totalExtenso}), referente ao(s) item(ns) discriminado(s) abaixo, ` +
    `relativo(s) ao aluno ${a.nome}` +
    `${a.matricula ? `, matrícula ${a.matricula}` : ""}${a.turma ? `, turma ${a.turma}` : ""}.`;

  const linhas = doc.splitTextToSize(texto, CONTEUDO) as string[];
  doc.text(linhas, MARGEM, y);
  y += linhas.length * 5 + 4;

  if (recibo.enderecoResponsavel) {
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(`Endereço do responsável: ${recibo.enderecoResponsavel}`, MARGEM, y, {
      maxWidth: CONTEUDO,
    });
    doc.setTextColor(0);
    y += 7;
  }
  return y + 2;
}

function tabelaItens(doc: Doc, recibo: ReciboDocumento, y: number): number {
  const alturaLinha = 8;
  const xValor = LARGURA - MARGEM - 2;

  doc.setFillColor(240, 240, 240);
  doc.rect(MARGEM, y, CONTEUDO, alturaLinha, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Discriminação", MARGEM + 2, y + 5.5);
  doc.text("Valor", xValor, y + 5.5, { align: "right" });
  y += alturaLinha;

  doc.setFont("helvetica", "normal");
  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
  for (const item of recibo.itens) {
    doc.text(item.descricao, MARGEM + 2, y + 5.5);
    doc.text(formatarBRL(item.valor), xValor, y + 5.5, { align: "right" });
    doc.line(MARGEM, y + alturaLinha, LARGURA - MARGEM, y + alturaLinha);
    y += alturaLinha;
  }

  doc.setFont("helvetica", "bold");
  doc.setFillColor(240, 240, 240);
  doc.rect(MARGEM, y, CONTEUDO, alturaLinha, "F");
  doc.text("Total", MARGEM + 2, y + 5.5);
  doc.text(recibo.totalFormatado, xValor, y + 5.5, { align: "right" });
  return y + alturaLinha + 12;
}

function rodape(doc: Doc, recibo: ReciboDocumento, y: number): void {
  const c = recibo.colegio;
  y = assinatura(doc, c, recibo.dataExtenso, y);

  if (c.observacao) {
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize(c.observacao, CONTEUDO) as string[], MARGEM, y);
    doc.setTextColor(0);
  }

  doc.setFontSize(7.5);
  doc.setTextColor(140);
  doc.text(
    `Recibo nº ${recibo.numero} · emitido em ${formatarDataBR(recibo.dataRecibo)} · ${c.unidade}`,
    MARGEM,
    285,
  );
  doc.setTextColor(0);
}

/** Constrói o PDF do recibo. */
export async function gerarPdfRecibo(
  recibo: ReciboDocumento,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = cabecalhoTimbrado(
    doc,
    {
      colegio: recibo.colegio,
      enderecoColegio: recibo.enderecoColegio,
      contatoColegio: recibo.contatoColegio,
    },
    logo,
  );
  y = titulo(doc, recibo, y);
  y = corpo(doc, recibo, y);
  y = tabelaItens(doc, recibo, y);
  rodape(doc, recibo, y);
  return doc;
}

/** Gera e baixa o PDF do recibo. */
export async function baixarPdfRecibo(
  recibo: ReciboDocumento,
  logo: LogoRecibo | null,
): Promise<void> {
  const doc = await gerarPdfRecibo(recibo, logo);
  doc.save(nomeArquivoRecibo(recibo));
}
