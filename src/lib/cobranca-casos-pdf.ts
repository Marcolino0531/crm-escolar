// PDFs da régua manual de cobrança (A4 retrato, jsPDF): Demonstrativo do
// débito, Notificação Extrajudicial e Dossiê (capa + linha do tempo + anexos
// mesclados com pdf-lib). Nada é calculado aqui — o débito vem pronto de
// `montarDemonstrativo` e o texto de `montarNotificacao`.

import {
  enderecoResponsavelLinha,
  formatarBRL,
  formatarCpf,
  formatarDataBR,
  LABEL_CATEGORIA,
  labelEtapa,
  NOTA_REGRA_CALCULO,
  type AlunoCaso,
  type AnexoCaso,
  type CasoCompleto,
  type DemonstrativoDebito,
  type EnderecoResponsavel,
  type EtapaCaso,
  type EventoTimeline,
} from "@/lib/cobranca-casos";
import { cabecalhoTimbrado, CONTEUDO, LARGURA, MARGEM, type LogoRecibo } from "@/lib/documento-pdf";
import type { NotificacaoDocumento } from "@/lib/notificacao-extrajudicial";
import { dataPorExtenso, enderecoLinha, type ColegioRecibo } from "@/lib/recibos";

type Doc = import("jspdf").jsPDF;

const RODAPE_Y = 280;
const ALTURA_LINHA = 6.5;

function timbre(colegio: ColegioRecibo) {
  return {
    colegio,
    enderecoColegio: enderecoLinha(colegio),
    contatoColegio: [colegio.telefone, colegio.email, colegio.site].filter(Boolean).join(" · "),
  };
}

function diasAtraso(vencimentoYMD: string, dataBaseYMD: string): number {
  const v = new Date(`${vencimentoYMD}T00:00:00Z`).getTime();
  const b = new Date(`${dataBaseYMD}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - v) / 86_400_000));
}

function novaPaginaSeNecessario(doc: Doc, y: number, altura: number): number {
  if (y + altura <= RODAPE_Y) return y;
  doc.addPage();
  return MARGEM;
}

interface ColunaTabela {
  titulo: string;
  x: number;
  largura: number;
  align?: "left" | "right";
}

function cabecalhoTabela(doc: Doc, y: number, colunas: readonly ColunaTabela[]): number {
  doc.setFillColor(235, 235, 235);
  doc.rect(MARGEM, y, CONTEUDO, ALTURA_LINHA, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  for (const c of colunas) {
    doc.text(c.titulo, c.align === "right" ? c.x + c.largura : c.x, y + 4.5, {
      align: c.align ?? "left",
    });
  }
  doc.setFont("helvetica", "normal");
  return y + ALTURA_LINHA;
}

/** Tabela genérica com quebra de página; devolve o Y após a última linha. */
function tabela(
  doc: Doc,
  y: number,
  colunas: readonly ColunaTabela[],
  linhas: readonly string[][],
  fonte = 8.5,
): number {
  y = novaPaginaSeNecessario(doc, y, ALTURA_LINHA * 3);
  y = cabecalhoTabela(doc, y, colunas);
  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
  doc.setFontSize(fonte);
  for (const linha of linhas) {
    const celulas = colunas.map(
      (c, i) => doc.splitTextToSize(linha[i] ?? "", c.largura - 1.5) as string[],
    );
    const nLinhas = Math.max(1, ...celulas.map((c) => c.length));
    const altura = 2 + nLinhas * 4.2;
    if (y + altura > RODAPE_Y) {
      doc.addPage();
      y = cabecalhoTabela(doc, MARGEM, colunas);
      doc.setFontSize(fonte);
    }
    colunas.forEach((c, i) => {
      doc.text(celulas[i], c.align === "right" ? c.x + c.largura : c.x, y + 4.4, {
        align: c.align ?? "left",
      });
    });
    y += altura;
    doc.line(MARGEM, y, LARGURA - MARGEM, y);
  }
  return y;
}

function paragrafos(doc: Doc, y: number, textos: readonly string[], fonte = 10.5): number {
  doc.setFontSize(fonte);
  const alturaLinha = fonte * 0.5;
  for (const t of textos) {
    const linhas = doc.splitTextToSize(t, CONTEUDO) as string[];
    y = novaPaginaSeNecessario(doc, y, linhas.length * alturaLinha + 3);
    doc.text(linhas, MARGEM, y, { align: "justify", maxWidth: CONTEUDO });
    y += linhas.length * alturaLinha + 3;
  }
  return y;
}

function rodape(doc: Doc, texto: string) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(texto, MARGEM, 288);
    doc.text(`${i}/${total}`, LARGURA - MARGEM, 288, { align: "right" });
    doc.setTextColor(0);
  }
}

// ─── Demonstrativo do débito ────────────────────────────────────────────────

export interface DemonstrativoPdfInput {
  colegio: ColegioRecibo;
  responsavel: {
    nome: string;
    cpf: string | null;
    telefone: string | null;
    endereco: EnderecoResponsavel | null;
  };
  alunos: readonly AlunoCaso[];
  demonstrativo: DemonstrativoDebito;
}

export async function gerarPdfDemonstrativo(
  input: DemonstrativoPdfInput,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { demonstrativo: d } = input;

  let y = cabecalhoTimbrado(doc, timbre(input.colegio), logo);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("DEMONSTRATIVO DE DÉBITO ATUALIZADO", LARGURA / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Data-base: ${formatarDataBR(d.dataBase)}`, LARGURA - MARGEM, y + 7, { align: "right" });
  y += 16;

  doc.setFontSize(10);
  const identificacao = [
    `Responsável financeiro: ${input.responsavel.nome}`,
    `CPF: ${formatarCpf(input.responsavel.cpf) || "—"}` +
      (input.responsavel.telefone ? `   Telefone: ${input.responsavel.telefone}` : ""),
    `Endereço: ${enderecoResponsavelLinha(input.responsavel.endereco) || "—"}`,
    `Aluno(s): ${input.alunos.map((a) => a.nome).join(", ")}`,
  ];
  for (const linha of identificacao) {
    const ls = doc.splitTextToSize(linha, CONTEUDO) as string[];
    doc.text(ls, MARGEM, y);
    y += ls.length * 5;
  }
  y += 4;

  const x = MARGEM;
  const colunas: ColunaTabela[] = [
    { titulo: "Aluno", x, largura: 30 },
    { titulo: "Descrição", x: x + 30, largura: 40 },
    { titulo: "Vencimento", x: x + 70, largura: 18 },
    { titulo: "Original", x: x + 88, largura: 20, align: "right" },
    { titulo: "Dias", x: x + 108, largura: 10, align: "right" },
    { titulo: "Multa 2%", x: x + 118, largura: 17, align: "right" },
    { titulo: "Juros 1% a.m.", x: x + 135, largura: 19, align: "right" },
    { titulo: "Atualizado", x: x + 154, largura: 20, align: "right" },
  ];
  y = tabela(
    doc,
    y,
    colunas,
    d.parcelas.map((p) => [
      p.aluno,
      p.descricao,
      formatarDataBR(p.vencimento),
      formatarBRL(p.original),
      String(diasAtraso(p.vencimento, d.dataBase)),
      formatarBRL(p.multa),
      formatarBRL(p.juros),
      formatarBRL(p.atualizado),
    ]),
    8,
  );

  y = novaPaginaSeNecessario(doc, y, ALTURA_LINHA + 30);
  doc.setFont("helvetica", "bold");
  doc.setFillColor(240, 240, 240);
  doc.rect(MARGEM, y, CONTEUDO, ALTURA_LINHA, "F");
  doc.setFontSize(9.5);
  doc.text(`Total atualizado em ${formatarDataBR(d.dataBase)}`, MARGEM + 1.5, y + 4.6);
  doc.text(formatarBRL(d.total), LARGURA - MARGEM - 1.5, y + 4.6, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += ALTURA_LINHA + 8;

  y = paragrafos(doc, y, [NOTA_REGRA_CALCULO], 8.5);
  y = paragrafos(
    doc,
    y,
    [
      `Parcelas em aberto conforme o sistema acadêmico-financeiro (Sponte) na data de emissão. Documento emitido em ${dataPorExtenso(d.dataBase)}.`,
    ],
    8.5,
  );

  rodape(
    doc,
    `Demonstrativo de débito · ${input.colegio.unidade} · data-base ${formatarDataBR(d.dataBase)}`,
  );
  return doc;
}

// ─── Notificação Extrajudicial ──────────────────────────────────────────────

export async function gerarPdfNotificacao(
  notificacao: NotificacaoDocumento,
  colegio: ColegioRecibo,
  numero: number,
  logo: LogoRecibo | null,
): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = cabecalhoTimbrado(doc, timbre(colegio), logo);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(notificacao.titulo, LARGURA / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${numero}`, LARGURA - MARGEM, y + 7, { align: "right" });
  y += 16;

  y = paragrafos(doc, y, notificacao.qualificacao, 10);
  y += 2;
  y = paragrafos(doc, y, [notificacao.saudacao, ...notificacao.paragrafosAntes]);

  const x = MARGEM;
  const colunas: ColunaTabela[] = [
    { titulo: "Descrição", x, largura: 60 },
    { titulo: "Vencimento", x: x + 60, largura: 20 },
    { titulo: "Valor original", x: x + 80, largura: 24, align: "right" },
    { titulo: "Multa", x: x + 104, largura: 20, align: "right" },
    { titulo: "Juros", x: x + 124, largura: 20, align: "right" },
    { titulo: "Valor atualizado", x: x + 144, largura: 30, align: "right" },
  ];
  y = tabela(
    doc,
    y + 1,
    colunas,
    notificacao.tabela.map((l) => [
      l.descricao,
      l.vencimento,
      l.original,
      l.multa,
      l.juros,
      l.atualizado,
    ]),
  );
  y = novaPaginaSeNecessario(doc, y, ALTURA_LINHA + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(notificacao.linhaTotal, LARGURA - MARGEM, y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += ALTURA_LINHA + 6;

  y = paragrafos(doc, y, notificacao.paragrafosDepois);
  y += 4;

  y = novaPaginaSeNecessario(doc, y, 40);
  doc.setFontSize(10.5);
  doc.text(notificacao.fecho, LARGURA - MARGEM, y, { align: "right" });
  y += 22;
  const meio = LARGURA / 2;
  doc.setDrawColor(60);
  doc.setLineWidth(0.3);
  doc.line(meio - 40, y, meio + 40, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(notificacao.assinatura[0], meio, y + 5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  notificacao.assinatura.slice(1).forEach((l, i) => {
    doc.text(l, meio, y + 10 + i * 4.5, { align: "center" });
  });

  rodape(doc, `Notificação extrajudicial nº ${numero} · ${colegio.unidade}`);
  return doc;
}

// ─── Dossiê ──────────────────────────────────────────────────────────────────

export interface DossieInput {
  caso: CasoCompleto;
  etapa: EtapaCaso;
  timeline: readonly EventoTimeline[];
  /** Anexos na ordem da linha do tempo, com URL assinada para download. */
  anexos: readonly (AnexoCaso & { url: string | null })[];
  /** Prints das mensagens, na ordem das mensagens. */
  prints: readonly { titulo: string; url: string; tipo: string }[];
  colegio: ColegioRecibo | null;
  logo: LogoRecibo | null;
  geradoEm: string; // YYYY-MM-DD
}

async function capaETimeline(input: DossieInput): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { caso } = input;

  let y = input.colegio ? cabecalhoTimbrado(doc, timbre(input.colegio), input.logo) : MARGEM + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("DOSSIÊ DE COBRANÇA", LARGURA / 2, y + 10, { align: "center" });
  y += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const linhas = [
    ["Unidade", caso.unidade],
    ["Responsável financeiro", caso.responsavel_nome],
    ["CPF", formatarCpf(caso.responsavel_cpf) || "—"],
    ["Aluno(s)", caso.alunos.map((a) => a.nome).join(", ")],
    ["Valor inicial", formatarBRL(caso.valor_inicial)],
    ["Etapa atual", labelEtapa(input.etapa)],
    ["Início da cobrança", formatarDataBR(caso.iniciado_em.slice(0, 10))],
    ["Gerado em", dataPorExtenso(input.geradoEm)],
  ];
  for (const [k, v] of linhas) {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, MARGEM, y);
    doc.setFont("helvetica", "normal");
    const vs = doc.splitTextToSize(v, CONTEUDO - 50) as string[];
    doc.text(vs, MARGEM + 50, y);
    y += vs.length * 5.5 + 1.5;
  }

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Débito no início da cobrança", MARGEM, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  const x = MARGEM;
  y = tabela(
    doc,
    y,
    [
      { titulo: "Aluno", x, largura: 34 },
      { titulo: "Descrição", x: x + 34, largura: 46 },
      { titulo: "Vencimento", x: x + 80, largura: 20 },
      { titulo: "Original", x: x + 100, largura: 22, align: "right" },
      { titulo: "Multa", x: x + 122, largura: 16, align: "right" },
      { titulo: "Juros", x: x + 138, largura: 16, align: "right" },
      { titulo: "Atualizado", x: x + 154, largura: 20, align: "right" },
    ],
    caso.debito_inicial.map((p) => [
      p.aluno,
      p.descricao,
      formatarDataBR(p.vencimento),
      formatarBRL(p.original),
      formatarBRL(p.multa),
      formatarBRL(p.juros),
      formatarBRL(p.atualizado),
    ]),
    8,
  );

  doc.addPage();
  y = MARGEM;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Linha do tempo", MARGEM, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  y = tabela(
    doc,
    y,
    [
      { titulo: "Data", x, largura: 26 },
      { titulo: "Evento", x: x + 26, largura: 60 },
      { titulo: "Detalhe", x: x + 86, largura: 88 },
    ],
    input.timeline.map((e) => [
      formatarDataBR(e.quando.slice(0, 10)) + (e.futuro ? " (previsto)" : ""),
      e.titulo,
      e.detalhe ?? "",
    ]),
    8.5,
  );

  const anexosOrdenados = input.anexos;
  if (anexosOrdenados.length > 0 || input.prints.length > 0) {
    y += 8;
    y = novaPaginaSeNecessario(doc, y, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Anexos (na ordem da linha do tempo)", MARGEM, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    const itens = [
      ...input.prints.map((p, i) => [String(i + 1), p.titulo, ""]),
      ...anexosOrdenados.map((a, i) => [
        String(input.prints.length + i + 1),
        a.nome_personalizado || LABEL_CATEGORIA[a.categoria],
        `${a.nome_arquivo} · ${formatarDataBR(a.created_at.slice(0, 10))}`,
      ]),
    ];
    y = tabela(
      doc,
      y,
      [
        { titulo: "#", x, largura: 10 },
        { titulo: "Documento", x: x + 10, largura: 84 },
        { titulo: "Arquivo", x: x + 94, largura: 80 },
      ],
      itens,
      8.5,
    );
  }

  rodape(doc, `Dossiê de cobrança · ${caso.unidade} · ${caso.responsavel_nome}`);
  return new Uint8Array(doc.output("arraybuffer"));
}

async function separador(titulo: string, subtitulo: string): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(doc.splitTextToSize(titulo, CONTEUDO) as string[], LARGURA / 2, 130, {
    align: "center",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(doc.splitTextToSize(subtitulo, CONTEUDO) as string[], LARGURA / 2, 145, {
    align: "center",
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Converte imagem (qualquer formato que o navegador decodifique) em PNG. */
async function imagemParaPng(bytes: Uint8Array, tipo: string): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: tipo }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/**
 * Dossiê único: capa + linha do tempo (jsPDF) e, na sequência, cada anexo —
 * PDFs mesclados página a página, imagens como página inteira (pdf-lib).
 */
export async function gerarDossie(input: DossieInput): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib-plus-encrypt");
  const saida = await PDFDocument.create();

  const anexar = async (bytes: Uint8Array) => {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const paginas = await saida.copyPages(src, src.getPageIndices());
    for (const p of paginas) saida.addPage(p);
  };

  await anexar(await capaETimeline(input));

  const itens: { titulo: string; subtitulo: string; url: string | null; tipo: string }[] = [
    ...input.prints.map((p) => ({
      titulo: p.titulo,
      subtitulo: "Print do envio",
      url: p.url,
      tipo: p.tipo,
    })),
    ...input.anexos.map((a) => ({
      titulo: a.nome_personalizado || LABEL_CATEGORIA[a.categoria],
      subtitulo: `${a.nome_arquivo} · ${formatarDataBR(a.created_at.slice(0, 10))}`,
      url: a.url,
      tipo: a.tipo_arquivo,
    })),
  ];

  for (const item of itens) {
    await anexar(await separador(item.titulo, item.subtitulo));
    if (!item.url) continue;
    let bytes: Uint8Array;
    try {
      const resp = await fetch(item.url);
      if (!resp.ok) throw new Error(String(resp.status));
      bytes = new Uint8Array(await resp.arrayBuffer());
    } catch {
      await anexar(await separador("Arquivo indisponível", item.subtitulo));
      continue;
    }
    if (item.tipo === "application/pdf") {
      try {
        await anexar(bytes);
      } catch {
        await anexar(await separador("PDF não pôde ser lido", item.subtitulo));
      }
      continue;
    }
    let img: Awaited<ReturnType<typeof saida.embedPng>> | null = null;
    try {
      if (item.tipo === "image/png") img = await saida.embedPng(bytes);
      else if (item.tipo === "image/jpeg") img = await saida.embedJpg(bytes);
      else {
        const png = await imagemParaPng(bytes, item.tipo);
        if (png) img = await saida.embedPng(png);
      }
    } catch {
      img = null;
    }
    if (!img) {
      await anexar(await separador("Imagem não pôde ser convertida", item.subtitulo));
      continue;
    }
    // A4 em pontos: 595.28 × 841.89, margem de 36pt.
    const pagina = saida.addPage([595.28, 841.89]);
    const maxW = 595.28 - 72;
    const maxH = 841.89 - 72;
    const escala = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * escala;
    const h = img.height * escala;
    pagina.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
  }

  return saida.save();
}

export function baixarBytes(bytes: Uint8Array, nomeArquivo: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function nomeArquivoSeguro(base: string): string {
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
