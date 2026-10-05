import { describe, expect, it } from "vitest";
import {
  ENTRELINHA,
  LABEL_H,
  LABEL_W,
  RETICENCIAS,
  Y_BARRAS,
  Y_TEXTO,
  cortarComReticencias,
  drawLabel,
  quebrarLinhas,
} from "@/lib/biblioteca-etiqueta";

// Largura fictícia: 1 mm por caractere.
const medir = (t: string) => t.length;

type Texto = { texto: string; x: number; y: number; fonte: string };

function docFalso() {
  let fonte = "";
  const textos: Texto[] = [];
  const barras: { y: number; h: number }[] = [];
  const doc = {
    setTextColor: () => {},
    setFillColor: () => {},
    setFontSize: () => {},
    setFont: (_f: string, estilo: string) => {
      fonte = estilo;
    },
    splitTextToSize: (t: string) => [t],
    getTextWidth: (t: string) => t.length * 0.9,
    text: (texto: string, x: number, y: number) => textos.push({ texto, x, y, fonte }),
    rect: (_x: number, y: number, _w: number, h: number) => barras.push({ y, h }),
  };
  return { doc: doc as never, textos, barras };
}

const base = { codigo: "000000000017", unidade: "Unidade Teste" };

describe("cortarComReticencias", () => {
  it("mantém o que cabe e corta com … o que não cabe", () => {
    expect(cortarComReticencias("Autor Curto", 20, medir)).toBe("Autor Curto");
    const cortado = cortarComReticencias("Autor De Nome Muito Comprido", 10, medir);
    expect(cortado.endsWith(RETICENCIAS)).toBe(true);
    expect(medir(cortado)).toBeLessThanOrEqual(10);
  });
});

describe("quebrarLinhas", () => {
  it("título curto fica em uma linha", () => {
    expect(quebrarLinhas("Livro Curto", [20, 30], medir)).toEqual(["Livro Curto"]);
  });

  it("quebra em 2 linhas por palavras e corta a 2ª com …", () => {
    const linhas = quebrarLinhas(
      "Um título bem comprido que não cabe em duas linhas",
      [12, 15],
      medir,
    );
    expect(linhas).toHaveLength(2);
    expect(medir(linhas[0])).toBeLessThanOrEqual(12);
    expect(medir(linhas[1])).toBeLessThanOrEqual(15);
    expect(linhas[1].endsWith(RETICENCIAS)).toBe(true);
  });

  it("palavra maior que a linha é cortada por caracteres", () => {
    const linhas = quebrarLinhas("Supercalifragilístico", [8, 8], medir);
    expect(linhas.every((l) => medir(l) <= 8)).toBe(true);
  });
});

describe("drawLabel", () => {
  it("rótulos Título e Autor em negrito, texto em fonte normal", () => {
    const { doc, textos } = docFalso();
    drawLabel(doc, 0, 0, { ...base, titulo: "Livro Teste", autor: "Autor Teste" });
    expect(textos.find((t) => t.texto === "Título: ")?.fonte).toBe("bold");
    expect(textos.find((t) => t.texto === "Autor: ")?.fonte).toBe("bold");
    expect(textos.find((t) => t.texto === "Livro Teste")?.fonte).toBe("normal");
    expect(textos.find((t) => t.texto === "Autor Teste")?.fonte).toBe("normal");
  });

  it("sem autor cadastrado não imprime a linha Autor", () => {
    const { doc, textos } = docFalso();
    drawLabel(doc, 0, 0, { ...base, titulo: "Livro Teste", autor: "  " });
    expect(textos.some((t) => t.texto.startsWith("Autor"))).toBe(false);
  });

  it("título em 2 linhas + autor: nada sobre as barras nem fora da etiqueta", () => {
    const { doc, textos, barras } = docFalso();
    drawLabel(doc, 0, 0, {
      ...base,
      titulo: "Um título de livro muito comprido que certamente ocupa mais de duas linhas",
      autor: "Um autor com nome muito comprido que também não cabe",
    });
    const fimBarras = Math.max(...barras.map((b) => b.y + b.h));
    expect(Y_BARRAS).toBeLessThan(fimBarras);
    expect(Math.min(...barras.map((b) => b.h))).toBeGreaterThanOrEqual(7);
    const linhasTexto = textos.filter((t) => t.y >= Y_TEXTO);
    expect(new Set(linhasTexto.map((t) => t.y)).size).toBe(3);
    const ultima = Math.max(...linhasTexto.map((t) => t.y));
    expect(ultima).toBeCloseTo(Y_TEXTO + 2 * ENTRELINHA);
    expect(ultima + 0.8).toBeLessThan(LABEL_H);
    for (const t of linhasTexto) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.texto.length * 0.9).toBeLessThanOrEqual(LABEL_W - 2 + 1e-9);
    }
    // Código legível (courier) e texto começam abaixo das barras.
    expect(Math.min(...textos.filter((t) => t.y > Y_BARRAS).map((t) => t.y)) - 2.5).toBeGreaterThan(
      fimBarras,
    );
  });
});
