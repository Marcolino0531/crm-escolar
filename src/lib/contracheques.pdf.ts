// Manipulação do PDF de contracheques no client.
//
// Extração de texto com pdfjs (mesmo padrão do parser de boletos) e recorte de
// cada página em um PDF individual protegido por senha. Roda no navegador de
// propósito: o arquivo de salários nunca é gravado em storage e o servidor só
// recebe a página já cifrada do funcionário que vai recebê-la.

import {
  classificarErroPdf,
  mensagemFalhaPdf,
  type MotivoFalhaPdf,
  type PaginaPdf,
  textoDosItens,
} from "./contracheques";
import { lerItensDeTexto } from "./pdf-text";

// Teto do arquivo único da contabilidade. Acima disso o navegador começa a
// engasgar na leitura em memória, e é melhor dizer isso do que travar a aba.
export const TAMANHO_MAXIMO_PDF_MB = 50;

// Erro de leitura com motivo identificado — o componente mostra `message` direto
// ao usuário, em vez de um "não foi possível ler o PDF" genérico.
export class ErroLeituraPdf extends Error {
  readonly motivo: MotivoFalhaPdf;
  constructor(motivo: MotivoFalhaPdf, ctx?: Parameters<typeof mensagemFalhaPdf>[1]) {
    super(mensagemFalhaPdf(motivo, ctx));
    this.name = "ErroLeituraPdf";
    this.motivo = motivo;
  }
}

// pdfjs e o gerador de PDF cifrado só existem no navegador; import dinâmico
// mantém os dois fora do bundle de SSR.
//
// Build "legacy" de propósito: o build moderno do pdfjs 5.x usa
// `Uint8Array.prototype.toHex()` (proposta recente, ainda ausente na maioria dos
// navegadores) ao calcular o fingerprint do documento, e o worker quebra com
// "a.toHex is not a function" em QUALQUER PDF. O legacy traz o polyfill.
async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: workerSrc } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc as string;
  return pdfjsLib;
}

async function abrirDocumento(arquivo: File, senhaPdf?: string) {
  const mb = arquivo.size / (1024 * 1024);
  if (mb > TAMANHO_MAXIMO_PDF_MB) {
    throw new ErroLeituraPdf("tamanho", {
      tamanhoMaximoMb: TAMANHO_MAXIMO_PDF_MB,
      tamanhoMb: mb,
    });
  }

  const pdfjsLib = await carregarPdfjs();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  try {
    return await pdfjsLib.getDocument({
      data: bytes,
      ...(senhaPdf ? { password: senhaPdf } : {}),
    }).promise;
  } catch (erro) {
    throw new ErroLeituraPdf(classificarErroPdf(erro));
  }
}

export type ResultadoExtracao = {
  paginas: PaginaPdf[];
  // Páginas que abriram mas não têm camada de texto (típico de escaneado). Ficam
  // na conferência como "sem correspondência", com o aviso do motivo.
  paginasSemTexto: number[];
  // O PDF de origem exigiu senha para abrir: o recorte não pode copiar a página
  // cifrada e precisa rasterizar.
  protegido: boolean;
};

export async function extrairPaginasPdf(
  arquivo: File,
  senhaPdf?: string,
): Promise<ResultadoExtracao> {
  const pdf = await abrirDocumento(arquivo, senhaPdf);

  const paginas: PaginaPdf[] = [];
  const paginasSemTexto: number[] = [];

  const totalPaginas = typeof pdf.numPages === "number" ? pdf.numPages : 0;

  for (let p = 1; p <= totalPaginas; p++) {
    const page = await pdf.getPage(p);
    const texto = textoDosItens(await lerItensDeTexto(page));
    if (!texto.trim()) paginasSemTexto.push(p);
    paginas.push({ pagina: p, texto });
  }

  if (paginas.length === 0) throw new ErroLeituraPdf("invalido");
  // Sem texto em nenhuma página não dá conferência nenhuma: é escaneado.
  if (paginasSemTexto.length === paginas.length) {
    throw new ErroLeituraPdf("sem_texto", { paginas: paginas.length });
  }

  return { paginas, paginasSemTexto, protegido: Boolean(senhaPdf) };
}

// Rasteriza a página: usada quando o PDF de origem está cifrado, caso em que
// copiar o objeto da página produziria um arquivo ilegível (o pdf-lib não
// decifra conteúdo). O resultado é a imagem fiel da página.
async function paginaComoImagem(
  arquivo: File,
  pagina: number,
  senhaPdf?: string,
): Promise<{ jpeg: Uint8Array; largura: number; altura: number }> {
  const pdf = await abrirDocumento(arquivo, senhaPdf);
  const page = await pdf.getPage(pagina);
  const viewport = page.getViewport({ scale: 2 });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ErroLeituraPdf("desconhecido");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new ErroLeituraPdf("desconhecido");
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    largura: viewport.width,
    altura: viewport.height,
  };
}

// Recorta a página (1-based) do PDF original em um documento novo, cifrado com
// `senha` tanto para abrir quanto como senha de permissões — sem senha de dono
// separada o arquivo poderia ser aberto por qualquer leitor que ignore o user
// password.
export async function recortarPaginaProtegida(
  arquivo: File,
  pagina: number,
  senha: string,
  senhaPdf?: string,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib-plus-encrypt");
  const destino = await PDFDocument.create();

  if (senhaPdf) {
    const { jpeg, largura, altura } = await paginaComoImagem(arquivo, pagina, senhaPdf);
    const imagem = await destino.embedJpg(jpeg);
    const folha = destino.addPage([largura, altura]);
    folha.drawImage(imagem, { x: 0, y: 0, width: largura, height: altura });
  } else {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const origem = await PDFDocument.load(bytes);
    const [copiada] = await destino.copyPages(origem, [pagina - 1]);
    destino.addPage(copiada);
  }

  destino.encrypt({
    userPassword: senha,
    ownerPassword: senha,
    permissions: { printing: "highResolution", copying: false, modifying: false },
  });

  return destino.save();
}

export function paraBase64(bytes: Uint8Array): string {
  let binario = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binario += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binario);
}
