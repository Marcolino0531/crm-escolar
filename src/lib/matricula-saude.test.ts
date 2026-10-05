import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPCOES_SAUDE,
  PERGUNTAS_SAUDE,
  SAUDE_FORM_VAZIO,
  colunasSaude,
  padronizarSaudeForm,
  saudeFormDaLinha,
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

describe("saudeFormDaLinha — reabrir o questionário gravado (rematrícula)", () => {
  const completa = saudeCompleta({
    contatosEmergencia: [
      { nome: "Pessoa Ficticia Um", telefone: "(11) 90000-0001", parentesco: "Tia" },
      { nome: "Pessoa Ficticia Dois", telefone: "(11) 90000-0002", parentesco: "" },
    ],
    alergia: { opcao: "Sim", detalhe: "Amendoim" },
    pessoasAutorizadas: [
      {
        nome: "Pessoa Ficticia Tres",
        telefone: "(11) 90000-0003",
        parentesco: "Avó",
        cpf: "000.000.001-91",
      },
      { nome: "Pessoa Ficticia Quatro", telefone: "", parentesco: "Vizinho", cpf: "" },
    ],
    outrasInformacoes: "Usa óculos",
  });

  it("devolve o mesmo formulário que foi gravado por colunasSaude", () => {
    expect(saudeFormDaLinha(colunasSaude(completa))).toEqual(completa);
  });

  it("a resposta reaberta continua válida", () => {
    expect(validarSaudeForm(saudeFormDaLinha(colunasSaude(completa)))).toEqual({});
  });

  it("linha incompleta ou com opção desconhecida reabre em branco e é recusada", () => {
    const form = saudeFormDaLinha({ alergia: "Talvez", cor_raca: "" });
    expect(form.alergia.opcao).toBe("");
    expect(form.contatosEmergencia).toEqual([]);
    expect(validarSaudeForm(form)["saude.alergia"]).toBeDefined();
    expect(validarSaudeForm(form)["saude.corRaca"]).toBeDefined();
  });
});

describe("rematrícula — Questionário de Saúde obrigatório e por ano letivo", () => {
  const fonte = readFileSync(resolve(__dirname, "rematricula.functions.ts"), "utf8");
  const finalizar = fonte.slice(fonte.indexOf("export const finalizarRematricula"));
  const salvar = fonte.slice(
    fonte.indexOf("export const salvarSaudeRematricula"),
    fonte.indexOf("export const finalizarRematricula"),
  );

  it("finalizarRematricula recusa sem o questionário do ano salvo e válido", () => {
    expect(finalizar).toMatch(/erros\["saude"\] = "Salve o Questionário de Saúde/);
    expect(finalizar).toMatch(/validarSaudeForm\(saudeFormDaLinha\(saudeSalva\.data\)\)/);
  });

  it("grava com origem rematricula, ano letivo e submission_id próprio, após padronizar e validar", () => {
    expect(salvar).toMatch(/padronizarSaudeForm\(/);
    expect(salvar).toMatch(/validarSaudeForm\(saude\)/);
    expect(salvar).toMatch(/origem: "rematricula"/);
    expect(salvar).toMatch(/ano_letivo: anoLetivo/);
    expect(salvar).toMatch(/submission_id: submissionIdRematricula\(/);
    expect(salvar).toMatch(/onConflict: "submission_id"/);
  });

  it("não registra em log dado de saúde nem pessoal", () => {
    for (const linha of salvar.split("\n").filter((l) => /console\./.test(l))) {
      expect(linha).not.toMatch(/saude\.|aluno\.|data\./);
    }
  });
});
