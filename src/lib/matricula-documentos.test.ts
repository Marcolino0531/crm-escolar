import { describe, expect, it } from "vitest";
import { DOCUMENTOS_MATRICULA } from "@/lib/matricula-form";
import {
  ORIGEM_FAMILIA_TEXTO,
  caminhoDaSubmissao,
  erroArquivoDocumento,
  montarListaDocumentosFicha,
  origemDocumentoTexto,
  rotuloDocumento,
} from "@/lib/matricula-documentos";

describe("montarListaDocumentosFicha", () => {
  it("lista todos os documentos do formulário na ordem, com pendentes, e os livres no fim", () => {
    const { padronizados, livres } = montarListaDocumentosFicha([
      { documento: "outro_1", nomeDocumento: "Laudo médico" },
      { documento: "comprovante_residencia" },
    ]);
    expect(padronizados.map((p) => p.chave)).toEqual(DOCUMENTOS_MATRICULA.map((d) => d.chave));
    expect(padronizados.filter((p) => p.doc !== null).map((p) => p.chave)).toEqual([
      "comprovante_residencia",
    ]);
    expect(livres.map((l) => rotuloDocumento(l))).toEqual(["Laudo médico"]);
  });
});

describe("origemDocumentoTexto", () => {
  it("família no formulário e secretaria com nome e data", () => {
    expect(origemDocumentoTexto({ documento: "certidao_ou_rg" })).toBe(ORIGEM_FAMILIA_TEXTO);
    expect(
      origemDocumentoTexto({
        documento: "certidao_ou_rg",
        origem: "secretaria",
        anexadoPorNome: "Izabela",
        anexadoEm: "2026-10-01T13:00:00Z",
      }),
    ).toBe("Anexado pela secretaria: Izabela, 01/10/2026");
  });
});

describe("regras do arquivo", () => {
  it("mesmos tipos e limite do formulário", () => {
    expect(erroArquivoDocumento("application/pdf", 1000)).toBeNull();
    expect(erroArquivoDocumento("text/plain", 1000)).not.toBeNull();
    expect(erroArquivoDocumento("image/png", 11 * 1024 * 1024)).not.toBeNull();
  });

  it("caminho precisa estar na pasta da submissão", () => {
    expect(caminhoDaSubmissao("secretaria/abc/uuid", "abc")).toBe(true);
    expect(caminhoDaSubmissao("secretaria/outra/uuid", "abc")).toBe(false);
    expect(caminhoDaSubmissao("pendentes/uuid/certidao_ou_rg", "abc")).toBe(false);
    expect(caminhoDaSubmissao("secretaria/abc/x/y", "abc")).toBe(false);
  });
});

describe("rotuloDocumento", () => {
  it("usa o nome da lista, o nome livre ou um rótulo genérico, nunca a chave técnica", () => {
    expect(rotuloDocumento({ documento: "certidao_ou_rg" })).toBe(
      DOCUMENTOS_MATRICULA.find((d) => d.chave === "certidao_ou_rg")?.rotulo,
    );
    expect(rotuloDocumento({ documento: "outro_abc", nomeDocumento: "Laudo médico" })).toBe(
      "Laudo médico",
    );
    expect(rotuloDocumento({ documento: "outro_abc", nomeDocumento: null })).toBe(
      "Outro documento",
    );
  });
});
