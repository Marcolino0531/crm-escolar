// Desenho do Documento livre em PDF (A4 retrato), a partir do
// `DocumentoLivreDocumento` já montado pela lógica pura — nada é calculado
// aqui, para que reimprimir do histórico produza o mesmo documento.
// Texto longo continua nas páginas seguintes (cabeçalho timbrado só na
// primeira); a assinatura nunca fica sozinha numa página sem texto.

import { nomeArquivoDocumentoLivre, type DocumentoLivreDocumento } from "@/lib/documento-livre";
import {
  assinatura,
  cabecalhoTimbrado,
  CONTEUDO,
  LARGURA,
  MARGEM,
  type LogoRecibo,
} from "@/lib/documento-pdf";

type Doc = import("jspdf").jsPDF;

const ENTRELINHA = 6;
const ESPACO_PARAGRAFO = 3;
/** Último Y em que uma linha de texto pode ser escrita (rodapé em 285). */
const LIMITE_TEXTO = 272;
/** Espaço entre o texto e a data + bloco de assinatura (ver `assinatura`). */
const ESPACO_ANTES_ASSINATURA = 10;
const ALTURA_ASSINATURA = 34;
const TOPO_CONTINUACAO = MARGEM + 4;

export async function gerarPdfDocumentoLivre(
  documento: DocumentoLivreDocumento,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = cabecalhoTimbrado(
    doc,
    {
      colegio: documento.colegio,
      enderecoColegio: documento.enderecoColegio,
      contatoColegio: documento.contatoColegio,
    },
    logo,
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const linhasTitulo = doc.splitTextToSize(documento.titulo, CONTEUDO) as string[];
  doc.text(linhasTitulo, LARGURA / 2, y, { align: "center" });
  y += (linhasTitulo.length - 1) * 6.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${documento.numero}`, LARGURA - MARGEM, y + 8, { align: "right" });
  y += 20;

  // Cada parágrafo vira linhas já quebradas na largura do conteúdo; a última
  // linha de cada trecho (fim de parágrafo ou quebra simples) não é justificada.
  doc.setFontSize(11);
  const linhas: { texto: string; justificar: boolean; fimParagrafo: boolean }[] = [];
  for (const paragrafo of documento.paragrafos) {
    const trechos = paragrafo.split("\n");
    trechos.forEach((trecho, ti) => {
      const quebradas = trecho.trim() ? (doc.splitTextToSize(trecho, CONTEUDO) as string[]) : [""];
      quebradas.forEach((texto, li) => {
        const ultimaDoTrecho = li === quebradas.length - 1;
        linhas.push({
          texto,
          justificar: !ultimaDoTrecho,
          fimParagrafo: ultimaDoTrecho && ti === trechos.length - 1,
        });
      });
    });
  }

  linhas.forEach((linha, i) => {
    const ultima = i === linhas.length - 1;
    // A última linha só entra nesta página se a assinatura couber logo abaixo;
    // senão vai junto com a assinatura para a página seguinte.
    const precisa = ultima ? y + ESPACO_ANTES_ASSINATURA + ALTURA_ASSINATURA : y;
    if (precisa > LIMITE_TEXTO) {
      doc.addPage();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      y = TOPO_CONTINUACAO;
    }
    if (linha.justificar) {
      doc.text(linha.texto, MARGEM, y, { align: "justify", maxWidth: CONTEUDO });
    } else if (linha.texto) {
      doc.text(linha.texto, MARGEM, y);
    }
    y += ENTRELINHA + (linha.fimParagrafo && !ultima ? ESPACO_PARAGRAFO : 0);
  });
  y += ESPACO_ANTES_ASSINATURA - ENTRELINHA + 4;

  assinatura(
    doc,
    {
      ...documento.colegio,
      assinanteNome: documento.assinanteNome,
      assinanteCargo: documento.assinanteCargo,
    },
    documento.dataExtenso,
    y,
  );

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(
      `Documento nº ${documento.numero} · emitido em ${documento.dataEmissao} · ${
        documento.colegio.unidade
      } · página ${p} de ${total}`,
      MARGEM,
      285,
    );
    doc.setTextColor(0);
  }
  return doc;
}

export async function baixarPdfDocumentoLivre(
  documento: DocumentoLivreDocumento,
  logo: LogoRecibo | null,
): Promise<void> {
  const doc = await gerarPdfDocumentoLivre(documento, logo);
  doc.save(nomeArquivoDocumentoLivre(documento));
}
