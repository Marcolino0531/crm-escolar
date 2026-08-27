// Desenho do Termo de Confissão de Dívida e Outras Avenças em PDF (A4 retrato),
// a partir do `TermoConfissaoDocumento` já montado pela lógica pura — nada é
// calculado nem redigido aqui, para que reimprimir do histórico produza o mesmo
// documento que foi enviado para assinatura.

import { cabecalhoTimbrado, CONTEUDO, LARGURA, MARGEM, type LogoRecibo } from "@/lib/documento-pdf";
import { nomeArquivoTermoConfissao, type TermoConfissaoDocumento } from "@/lib/confissao-divida";
import { formatarBRL, formatarDataBR } from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

const ALTURA_LINHA = 7;
const RODAPE_Y = 272;

interface Segmento {
  texto: string;
  negrito: boolean;
}

/** Quebra `a **b** c` em palavras, cada uma com seus trechos em negrito. */
function palavrasRicas(texto: string): Segmento[][] {
  const partes = texto.split("**").map((t, i) => ({ texto: t, negrito: i % 2 === 1 }));
  const palavras: Segmento[][] = [];
  let atual: Segmento[] = [];
  for (const parte of partes) {
    if (!parte.texto) continue;
    for (const pedaco of parte.texto.split(/(\s+)/)) {
      if (!pedaco) continue;
      if (/^\s+$/.test(pedaco)) {
        if (atual.length) palavras.push(atual);
        atual = [];
        continue;
      }
      // Pontuação depois de um trecho em negrito continua na mesma palavra,
      // para não sair "DEVEDOR , JOÃO".
      atual.push({ texto: pedaco, negrito: parte.negrito });
    }
  }
  if (atual.length) palavras.push(atual);
  return palavras;
}

function larguraPalavra(doc: Doc, palavra: Segmento[]): number {
  let total = 0;
  for (const seg of palavra) {
    doc.setFont("helvetica", seg.negrito ? "bold" : "normal");
    total += doc.getTextWidth(seg.texto);
  }
  return total;
}

/** Rodapé de continuação e nova página quando o espaço restante acaba. */
function garantirEspaco(doc: Doc, y: number, necessario: number): number {
  if (y + necessario <= RODAPE_Y) return y;
  doc.addPage();
  return MARGEM;
}

/**
 * Parágrafo com negrito nos termos jurídicos, quebrando linha na largura útil e
 * paginando sozinho. Devolve o Y após o parágrafo.
 */
function paragrafoRico(doc: Doc, texto: string, y: number, alturaLinha = 5): number {
  const palavras = palavrasRicas(texto);
  doc.setFont("helvetica", "normal");
  const espaco = doc.getTextWidth(" ");
  let linha: Segmento[][] = [];
  let larguraLinha = 0;

  const imprimir = (atual: Segmento[][], yLinha: number) => {
    let x = MARGEM;
    for (let i = 0; i < atual.length; i++) {
      if (i > 0) x += espaco;
      for (const seg of atual[i]) {
        doc.setFont("helvetica", seg.negrito ? "bold" : "normal");
        doc.text(seg.texto, x, yLinha);
        x += doc.getTextWidth(seg.texto);
      }
    }
  };

  for (const palavra of palavras) {
    const w = larguraPalavra(doc, palavra);
    const projetada = linha.length === 0 ? w : larguraLinha + espaco + w;
    if (projetada > CONTEUDO && linha.length > 0) {
      y = garantirEspaco(doc, y, alturaLinha);
      imprimir(linha, y);
      y += alturaLinha;
      linha = [palavra];
      larguraLinha = w;
      continue;
    }
    linha.push(palavra);
    larguraLinha = projetada;
  }
  if (linha.length) {
    y = garantirEspaco(doc, y, alturaLinha);
    imprimir(linha, y);
    y += alturaLinha;
  }
  doc.setFont("helvetica", "normal");
  return y;
}

function quadroParcelas(doc: Doc, termo: TermoConfissaoDocumento, y: number): number {
  if (termo.parcelas.length === 0) return y;
  const colunas = [MARGEM + 2, MARGEM + 40, LARGURA - MARGEM - 2] as const;

  const cabecalho = (yAtual: number): number => {
    doc.setFillColor(240, 240, 240);
    doc.rect(MARGEM, yAtual, CONTEUDO, ALTURA_LINHA, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text("Parcela", colunas[0], yAtual + 5);
    doc.text("Vencimento", colunas[1], yAtual + 5);
    doc.text("Valor", colunas[2], yAtual + 5, { align: "right" });
    doc.setFont("helvetica", "normal");
    return yAtual + ALTURA_LINHA;
  };

  y = garantirEspaco(doc, y + 3, ALTURA_LINHA * 3);
  y = cabecalho(y);
  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
  doc.setFontSize(9.5);
  for (const p of termo.parcelas) {
    if (y + ALTURA_LINHA * 2 > RODAPE_Y) {
      doc.addPage();
      y = cabecalho(MARGEM);
      doc.setFontSize(9.5);
    }
    doc.text(`${p.numero}/${termo.parcelas.length}`, colunas[0], y + 5);
    doc.text(formatarDataBR(p.vencimento), colunas[1], y + 5);
    doc.text(formatarBRL(p.valor), colunas[2], y + 5, { align: "right" });
    doc.line(MARGEM, y + ALTURA_LINHA, LARGURA - MARGEM, y + ALTURA_LINHA);
    y += ALTURA_LINHA;
  }

  doc.setFont("helvetica", "bold");
  doc.setFillColor(240, 240, 240);
  doc.rect(MARGEM, y, CONTEUDO, ALTURA_LINHA, "F");
  doc.text("Total confessado", colunas[0], y + 5);
  doc.text(termo.valorFormatado, colunas[2], y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  return y + ALTURA_LINHA + 6;
}

/** Uma linha de assinatura centralizada, com nome e legendas abaixo. */
function linhaAssinatura(doc: Doc, y: number, nome: string, legendas: string[]): number {
  y = garantirEspaco(doc, y, 24);
  const meio = LARGURA / 2;
  y += 14;
  doc.setDrawColor(90);
  doc.setLineWidth(0.3);
  doc.line(meio - 45, y, meio + 45, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(nome, meio, y + 5, { align: "center", maxWidth: 100 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  let ly = y + 9.5;
  for (const legenda of legendas.filter(Boolean)) {
    doc.text(legenda, meio, ly, { align: "center", maxWidth: 110 });
    ly += 4;
  }
  doc.setTextColor(0);
  return ly + 2;
}

export async function gerarPdfTermoConfissao(
  termo: TermoConfissaoDocumento,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = cabecalhoTimbrado(
    doc,
    {
      colegio: termo.colegio,
      enderecoColegio: termo.enderecoColegio,
      contatoColegio: termo.contatoColegio,
    },
    logo,
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text("TERMO DE CONFISSÃO DE DÍVIDA E OUTRAS AVENÇAS", LARGURA / 2, y, {
    align: "center",
    maxWidth: CONTEUDO,
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${termo.numero}`, LARGURA - MARGEM, y + 7, { align: "right" });
  doc.text(termo.colegio.unidade, MARGEM, y + 7);
  y += 15;

  doc.setFontSize(10);
  y = paragrafoRico(doc, termo.abertura, y);
  y += 3;

  doc.setFont("helvetica", "bold");
  for (const linha of termo.linhasAlunos) {
    y = garantirEspaco(doc, y, 5);
    doc.text(`ALUNO (A): ${linha}`, MARGEM, y, { maxWidth: CONTEUDO });
    y += 5;
  }
  doc.setFont("helvetica", "normal");
  y += 4;

  for (const secao of termo.secoes) {
    y = garantirEspaco(doc, y, 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(secao.titulo, MARGEM, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y += 6;
    for (const paragrafo of secao.paragrafos) {
      y = paragrafoRico(doc, paragrafo, y);
      y += 3;
    }
    // O quadro de vencimentos ilustra a forma de pagamento da cláusula 2.
    if (secao.titulo.startsWith("2 –")) {
      y = quadroParcelas(doc, termo, y);
      doc.setFontSize(10);
    }
    y += 3;
  }

  y = garantirEspaco(doc, y + 6, 20);
  doc.setFontSize(10);
  if (termo.dataExtenso) doc.text(termo.dataExtenso, LARGURA - MARGEM, y, { align: "right" });
  y += 6;

  for (const d of termo.devedores) {
    y = linhaAssinatura(doc, y, d.nome.toUpperCase(), [
      d.cpf ? `CPF ${d.cpf}` : "",
      termo.plural && d.solidario ? "DEVEDOR SOLIDÁRIO" : "DEVEDOR",
    ]);
  }

  y = linhaAssinatura(doc, y, termo.colegio.razaoSocial || termo.colegio.nomeFantasia, [
    "CREDOR",
    [termo.representanteNome, termo.representanteOab ? `OAB-MG ${termo.representanteOab}` : ""]
      .filter(Boolean)
      .join(" · "),
  ]);

  if (termo.testemunhas.length > 0) {
    y = garantirEspaco(doc, y + 4, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("TESTEMUNHAS:", MARGEM, y);
    doc.setFont("helvetica", "normal");
    y += 2;
    for (const t of termo.testemunhas) {
      y = linhaAssinatura(doc, y, t.nome.toUpperCase(), [t.cpf ? `CPF ${t.cpf}` : ""]);
    }
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(
      `Termo de Confissão de Dívida nº ${termo.numero} · emitido em ${formatarDataBR(
        termo.dataDocumento,
      )} · ${termo.colegio.unidade} · página ${i} de ${paginas}`,
      MARGEM,
      285,
    );
    doc.setTextColor(0);
  }
  return doc;
}

export async function baixarPdfTermoConfissao(
  termo: TermoConfissaoDocumento,
  logo: LogoRecibo | null,
): Promise<void> {
  const doc = await gerarPdfTermoConfissao(termo, logo);
  doc.save(nomeArquivoTermoConfissao(termo));
}
