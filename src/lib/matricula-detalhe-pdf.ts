// PDF da ficha de matrícula (A4 retrato) a partir das seções já montadas pela
// lógica pura, para a secretaria imprimir e arquivar. Os anexos entram como
// nome do arquivo: o link do documento é assinado e expira em minutos.

import { MARGEM, CONTEUDO, LARGURA } from "@/lib/documento-pdf";
import type { SecaoDetalhe } from "@/lib/matricula-detalhe";

type Doc = import("jspdf").jsPDF;

const ALTURA_PAGINA = 297;
const RODAPE = 285;
const LARGURA_ROTULO = 58;

export function nomeArquivoFichaMatricula(alunoNome: string | null, protocolo: string | null) {
  const base = (alunoNome ?? protocolo ?? "matricula")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `ficha-matricula-${base || "submissao"}.pdf`;
}

function novaPaginaSePreciso(doc: Doc, y: number, altura: number): number {
  if (y + altura <= RODAPE) return y;
  doc.addPage();
  return MARGEM;
}

export async function gerarPdfFichaMatricula(
  titulo: string,
  subtitulo: string,
  secoes: SecaoDetalhe[],
  nomeArquivo: string,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(titulo, MARGEM, MARGEM + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(subtitulo, MARGEM, MARGEM + 10, { maxWidth: CONTEUDO });
  let y = MARGEM + 18;

  for (const secao of secoes) {
    y = novaPaginaSePreciso(doc, y, 16);
    doc.setFillColor(238, 238, 238);
    doc.rect(MARGEM, y, CONTEUDO, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(secao.titulo, MARGEM + 2, y + 5.5);
    y += 12;

    for (const grupo of secao.grupos) {
      if (grupo.titulo !== null) {
        y = novaPaginaSePreciso(doc, y, 8);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.text(grupo.titulo, MARGEM, y);
        y += 5;
      }

      doc.setFontSize(9.5);
      for (const campo of grupo.campos) {
        const linhas: string[] = doc.splitTextToSize(
          campo.valor,
          CONTEUDO - LARGURA_ROTULO,
        ) as string[];
        const altura = Math.max(linhas.length * 4.6, 5);
        y = novaPaginaSePreciso(doc, y, altura);
        doc.setFont("helvetica", "bold");
        doc.text(campo.rotulo, MARGEM, y, { maxWidth: LARGURA_ROTULO - 3 });
        doc.setFont("helvetica", "normal");
        doc.text(linhas, MARGEM + LARGURA_ROTULO, y);
        y += altura + 0.8;
      }
      y += 2;
    }
    y += 3;
  }

  const paginas = doc.getNumberOfPages();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (let p = 1; p <= paginas; p += 1) {
    doc.setPage(p);
    doc.text(`Página ${p} de ${paginas}`, LARGURA - MARGEM, ALTURA_PAGINA - 8, { align: "right" });
  }

  doc.save(nomeArquivo);
}
