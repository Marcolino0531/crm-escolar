// Manipulação do PDF de contracheques no client.
//
// Extração de texto com pdfjs (mesmo padrão do parser de boletos) e recorte de
// cada página em um PDF individual protegido por senha. Roda no navegador de
// propósito: o arquivo de salários nunca é gravado em storage e o servidor só
// recebe a página já cifrada do funcionário que vai recebê-la.

import type { PaginaPdf } from "./contracheques";

// pdfjs e o gerador de PDF cifrado só existem no navegador; import dinâmico
// mantém os dois fora do bundle de SSR.
async function carregarPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc as string;
  return pdfjsLib;
}

export async function extrairPaginasPdf(file: File): Promise<PaginaPdf[]> {
  const pdfjsLib = await carregarPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

  const paginas: PaginaPdf[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const linhas: string[] = [];
    let ultimoY: number | null = null;

    for (const item of content.items as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      if (!("str" in item) || !("transform" in item)) continue;
      const it = item as { str: string; transform: number[] };
      if (!it.str.trim()) continue;

      const y = Math.round(it.transform[5]);
      // Itens do pdfjs vêm soltos; agrupar por Y reconstrói as linhas, que é o
      // que o usuário vê na conferência.
      if (ultimoY !== null && Math.abs(y - ultimoY) <= 2) {
        linhas[linhas.length - 1] = `${linhas[linhas.length - 1]} ${it.str.trim()}`;
      } else {
        linhas.push(it.str.trim());
        ultimoY = y;
      }
    }

    paginas.push({ pagina: p, texto: linhas.join("\n") });
  }

  return paginas;
}

// Recorta a página (1-based) do PDF original em um documento novo, cifrado com
// `senha` tanto para abrir quanto como senha de permissões — sem senha de dono
// separada o arquivo poderia ser aberto por qualquer leitor que ignore o user
// password.
export async function recortarPaginaProtegida(
  arquivo: File,
  pagina: number,
  senha: string,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib-plus-encrypt");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const origem = await PDFDocument.load(bytes);
  const destino = await PDFDocument.create();
  const [copiada] = await destino.copyPages(origem, [pagina - 1]);
  destino.addPage(copiada);

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
