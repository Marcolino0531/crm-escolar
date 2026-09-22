import { describe, expect, it } from "vitest";

import {
  preencherSignatario,
  signatariosCadastradosDaUnidade,
} from "@/lib/signatarios-cadastrados";
import type { TestemunhaDocumento } from "@/lib/testemunhas";

const colegios = [
  {
    unidade: "CEC",
    representante_nome: "Sérgio Ribeiro",
    representante_cpf: "111.222.333-44",
    representante_email: "sergio@cec.com",
    representante_celular: "(31) 99999-0000",
  },
  {
    unidade: "CEC Baby",
    representante_nome: "",
    representante_cpf: "",
    representante_email: "",
    representante_celular: "",
  },
];

const testemunhas: TestemunhaDocumento[] = [
  {
    unidade: "CEC",
    ordem: 2,
    nome: "Anna Clara",
    cpf: "157.432.546-99",
    email: "anna@x.com",
    celular: "(31) 98888-0000",
    ativa: true,
  },
  {
    unidade: "CEC",
    ordem: 1,
    nome: "Márcia Regina",
    cpf: "631.466.656-20",
    email: "marcia@x.com",
    celular: "(31) 97777-0000",
    ativa: true,
  },
  {
    unidade: "CEC",
    ordem: 3,
    nome: "Inativa",
    cpf: "000",
    email: "",
    celular: "",
    ativa: false,
  },
  {
    unidade: "Núcleo Belvedere",
    ordem: 1,
    nome: "Outra Unidade",
    cpf: "999",
    email: "",
    celular: "",
    ativa: true,
  },
  {
    unidade: "CEC Baby",
    ordem: 1,
    nome: "",
    cpf: "",
    email: "",
    celular: "",
    ativa: true,
  },
];

describe("signatariosCadastradosDaUnidade", () => {
  it("lista representante e testemunhas ativas da unidade, por ordem", () => {
    const lista = signatariosCadastradosDaUnidade("CEC", colegios, testemunhas);
    expect(lista.map((p) => [p.papel, p.nome, p.completo])).toEqual([
      ["Representante Legal", "Sérgio Ribeiro", true],
      ["Testemunha 1", "Márcia Regina", true],
      ["Testemunha 2", "Anna Clara", true],
    ]);
  });

  it("não traz testemunhas de outra unidade nem inativas", () => {
    const nomes = signatariosCadastradosDaUnidade("CEC", colegios, testemunhas).map((p) => p.nome);
    expect(nomes).not.toContain("Outra Unidade");
    expect(nomes).not.toContain("Inativa");
  });

  it("marca como incompleto quando faltam nome/CPF (opção desabilitada)", () => {
    const lista = signatariosCadastradosDaUnidade("CEC Baby", colegios, testemunhas);
    expect(lista).toHaveLength(2);
    expect(lista.every((p) => !p.completo)).toBe(true);
  });

  it("unidade sem colégio cadastrado devolve representante incompleto", () => {
    const [rep] = signatariosCadastradosDaUnidade("Núcleo Vale do Sereno", colegios, testemunhas);
    expect(rep.papel).toBe("Representante Legal");
    expect(rep.completo).toBe(false);
  });
});

describe("preencherSignatario", () => {
  it("copia nome, CPF, email e celular para o formulário do signatário", () => {
    const [rep] = signatariosCadastradosDaUnidade("CEC", colegios, testemunhas);
    expect(preencherSignatario(rep)).toEqual({
      nome: "Sérgio Ribeiro",
      cpf: "111.222.333-44",
      email: "sergio@cec.com",
      telefone: "(31) 99999-0000",
    });
  });
});
