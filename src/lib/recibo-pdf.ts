// Desenho do recibo em PDF (A4 retrato), a partir do `ReciboDocumento` já
// montado pela lógica pura. Nada é calculado aqui: o total, o valor por extenso
// e a data já vêm resolvidos, para que reimprimir do histórico produza
// exatamente o mesmo documento.

import {
  formatarBRL,
  formatarDataBR,
  nomeArquivoRecibo,
  type ReciboDocumento,
} from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

const MARGEM = 18;
const LARGURA = 210;
const CONTEUDO = LARGURA - MARGEM * 2;

// Logo do colégio como data URL (PNG/JPEG) — opcional.
export interface LogoRecibo {
  dataUrl: string;
  largura: number;
  altura: number;
}

function cabecalho(doc: Doc, recibo: ReciboDocumento, logo: LogoRecibo | null): number {
  let y = MARGEM;
  let textoX = MARGEM;

  if (logo) {
    const alturaMax = 20;
    const escala = Math.min(alturaMax / logo.altura, 32 / logo.largura);
    const w = logo.largura * escala;
    const h = logo.altura * escala;
    doc.addImage(logo.dataUrl, "PNG", MARGEM, y, w, h);
    textoX = MARGEM + w + 6;
  }

  const c = recibo.colegio;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(c.nomeFantasia || c.razaoSocial, textoX, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const linhas = [
    c.nomeFantasia ? c.razaoSocial : "",
    [c.cnpj ? `CNPJ ${c.cnpj}` : "", c.inscricaoMunicipal ? `IM ${c.inscricaoMunicipal}` : ""]
      .filter(Boolean)
      .join(" · "),
    recibo.enderecoColegio,
    recibo.contatoColegio,
  ].filter(Boolean);
  let ly = y + 10;
  for (const linha of linhas) {
    doc.text(linha, textoX, ly, { maxWidth: LARGURA - textoX - MARGEM });
    ly += 4;
  }

  y = Math.max(ly + 2, MARGEM + 26);
  doc.setDrawColor(120);
  doc.setLineWidth(0.4);
  doc.line(MARGEM, y, LARGURA - MARGEM, y);
  return y + 10;
}

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
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (recibo.dataExtenso) doc.text(recibo.dataExtenso, LARGURA - MARGEM, y, { align: "right" });
  y += 22;

  const meio = LARGURA / 2;
  doc.setDrawColor(90);
  doc.setLineWidth(0.3);
  doc.line(meio - 40, y, meio + 40, y);
  doc.setFontSize(9.5);
  const c = recibo.colegio;
  doc.text(c.assinanteNome || c.razaoSocial, meio, y + 5, { align: "center" });
  if (c.assinanteCargo) {
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(c.assinanteCargo, meio, y + 9.5, { align: "center" });
    doc.setTextColor(0);
  }
  y += 20;

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
  let y = cabecalho(doc, recibo, logo);
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

/** Carrega a logo (URL assinada do storage) como data URL para o jsPDF. */
export async function carregarLogo(url: string): Promise<LogoRecibo | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo"));
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo"));
      img.src = dataUrl;
    });
    // O jsPDF só desenha PNG/JPEG: SVG e WEBP são rasterizados antes.
    if (/^data:image\/(png|jpe?g);/i.test(dataUrl)) {
      return { dataUrl, largura: img.naturalWidth || 200, altura: img.naturalHeight || 100 };
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 400;
    canvas.height = img.naturalHeight || 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      largura: canvas.width,
      altura: canvas.height,
    };
  } catch {
    return null;
  }
}
