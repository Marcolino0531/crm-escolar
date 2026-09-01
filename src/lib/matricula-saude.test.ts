import { describe, expect, it } from "vitest";
import {
  OPCOES_SAUDE,
  PERGUNTAS_SAUDE,
  SAUDE_FORM_VAZIO,
  padronizarSaudeForm,
  textoContatosEmergencia,
  textoPessoasAutorizadas,
  validarSaudeForm,
  type SaudeForm,
} from "@/lib/matricula-form";

function saudeCompleta(patch: Partial<SaudeForm> = {}): SaudeForm {
  return {
    ...SAUDE_FORM_VAZIO,
    alergia: { opcao: "Não", detalhe: "" },
    problemaSaude: { opcao: "Não", detalhe: "" },
    medicamentoContinuo: { opcao: "Não", detalhe: "" },
    planoSaude: { opcao: "Não", detalhe: "" },
    corRaca: "Parda",
    ...patch,
  };
}

describe("opções das perguntas de saúde", () => {
  it("oferece apenas Sim e Não", () => {
    expect([...OPCOES_SAUDE]).toEqual(["Sim", "Não"]);
  });
});

describe("validarSaudeForm — detalhamento condicional", () => {
  it("aprova o questionário com todas as respostas em Não", () => {
    expect(validarSaudeForm(saudeCompleta())).toEqual({});
  });

  for (const { campo, pergunta } of PERGUNTAS_SAUDE) {
    it(`exige detalhe quando "${pergunta}" é Sim`, () => {
      const erros = validarSaudeForm(
        saudeCompleta({ [campo]: { opcao: "Sim", detalhe: "  " } } as Partial<SaudeForm>),
      );
      expect(erros[`saude.${campo}.detalhe`]).toBeDefined();
    });

    it(`aceita "${pergunta}" com Sim e detalhe preenchido`, () => {
      const erros = validarSaudeForm(
        saudeCompleta({ [campo]: { opcao: "Sim", detalhe: "Amendoim" } } as Partial<SaudeForm>),
      );
      expect(erros).toEqual({});
    });

    it(`não exige detalhe quando "${pergunta}" é Não`, () => {
      const erros = validarSaudeForm(
        saudeCompleta({ [campo]: { opcao: "Não", detalhe: "" } } as Partial<SaudeForm>),
      );
      expect(erros[`saude.${campo}.detalhe`]).toBeUndefined();
    });

    it(`ainda exige uma escolha em "${pergunta}"`, () => {
      const erros = validarSaudeForm(
        saudeCompleta({ [campo]: { opcao: "", detalhe: "" } } as Partial<SaudeForm>),
      );
      expect(erros[`saude.${campo}`]).toBeDefined();
    });
  }
});

describe("validarSaudeForm — listas opcionais", () => {
  it("não bloqueia o avanço com as duas listas vazias", () => {
    const erros = validarSaudeForm(
      saudeCompleta({ contatosEmergencia: [], pessoasAutorizadas: [] }),
    );
    expect(erros["saude.contatoEmergencia"]).toBeUndefined();
    expect(erros["saude.pessoasAutorizadas"]).toBeUndefined();
    expect(erros).toEqual({});
  });

  it("continua exigindo cor/raça", () => {
    expect(validarSaudeForm(saudeCompleta({ corRaca: "" }))["saude.corRaca"]).toBeDefined();
  });
});

describe("serialização das listas", () => {
  it("grava uma pessoa por linha e descarta linhas em branco", () => {
    expect(
      textoContatosEmergencia([
        { nome: "Maria Silva", telefone: "(31) 99999-0000", parentesco: "Tia" },
        { nome: "", telefone: "", parentesco: "" },
      ]),
    ).toBe("Maria Silva — Tia — (31) 99999-0000");

    expect(
      textoPessoasAutorizadas([
        {
          nome: "João Souza",
          telefone: "(31) 98888-0000",
          parentesco: "Avô",
          cpf: "123.456.789-09",
        },
      ]),
    ).toBe("João Souza — Avô — (31) 98888-0000 — 123.456.789-09");
  });

  it("lista vazia vira texto vazio", () => {
    expect(textoContatosEmergencia([])).toBe("");
    expect(textoPessoasAutorizadas([])).toBe("");
  });
});

describe("padronizarSaudeForm", () => {
  it("capitaliza nome e parentesco sem alterar telefone e CPF", () => {
    const padronizado = padronizarSaudeForm(
      saudeCompleta({
        contatosEmergencia: [
          { nome: "maria silva", telefone: "(31) 99999-0000", parentesco: "tia" },
        ],
        pessoasAutorizadas: [
          {
            nome: "JOÃO SOUZA",
            telefone: "(31) 98888-0000",
            parentesco: "AVÔ",
            cpf: "123.456.789-09",
          },
        ],
      }),
    );

    expect(padronizado.contatosEmergencia[0]).toEqual({
      nome: "Maria Silva",
      telefone: "(31) 99999-0000",
      parentesco: "Tia",
    });
    expect(padronizado.pessoasAutorizadas[0]).toEqual({
      nome: "João Souza",
      telefone: "(31) 98888-0000",
      parentesco: "Avô",
      cpf: "123.456.789-09",
    });
  });
});
