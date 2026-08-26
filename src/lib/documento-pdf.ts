// Peças comuns aos PDFs do módulo Documentos (A4 retrato): papel timbrado do
// colégio, bloco de assinatura e carregamento da logo. Recibo e declaração
// dividem o mesmo desenho para sair com a mesma identidade visual.

import type { ColegioRecibo } from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

export const MARGEM = 18;
export const LARGURA = 210;
export const CONTEUDO = LARGURA - MARGEM * 2;

// Logo do colégio como data URL (PNG/JPEG) — opcional.
export interface LogoRecibo {
  dataUrl: string;
  largura: number;
  altura: number;
}

export interface Timbre {
  colegio: ColegioRecibo;
  enderecoColegio: string;
  contatoColegio: string;
}

/** Cabeçalho timbrado; devolve o Y onde o corpo começa. */
export function cabecalhoTimbrado(doc: Doc, timbre: Timbre, logo: LogoRecibo | null): number {
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

  const c = timbre.colegio;
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
    timbre.enderecoColegio,
    timbre.contatoColegio,
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

/** Data por extenso à direita + linha de assinatura do colégio. */
export function assinatura(doc: Doc, colegio: ColegioRecibo, dataExtenso: string, y: number): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (dataExtenso) doc.text(dataExtenso, LARGURA - MARGEM, y, { align: "right" });
  y += 22;

  const meio = LARGURA / 2;
  doc.setDrawColor(90);
  doc.setLineWidth(0.3);
  doc.line(meio - 40, y, meio + 40, y);
  doc.setFontSize(9.5);
  doc.text(colegio.assinanteNome || colegio.razaoSocial, meio, y + 5, { align: "center" });
  if (colegio.assinanteCargo) {
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(colegio.assinanteCargo, meio, y + 9.5, { align: "center" });
    doc.setTextColor(0);
  }
  return y + 20;
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
