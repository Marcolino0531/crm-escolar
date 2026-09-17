import { describe, expect, it } from "vitest";
import {
  ORDENACAO_PADRAO,
  alternarOrdenacao,
  ordenarFuncionarios,
  type FuncionarioOrdenavel,
} from "./rh-ordenacao";

const base: FuncionarioOrdenavel[] = [
  {
    nomeCompleto: "Maria Souza",
    cpf: "222.222.222-22",
    cargo: "Professora",
    dataAdmissao: "2024-03-01",
    horarioTrabalhoInicio: "13:00",
    horarioTrabalhoFim: "18:00",
  },
  {
    nomeCompleto: "Ana Lima",
    cpf: "111.111.111-11",
    cargo: "Auxiliar de Limpeza",
    dataAdmissao: "",
    horarioTrabalhoInicio: "07:00",
    horarioTrabalhoFim: "16:00",
    dataRescisao: "2026-02-10",
  },
  {
    nomeCompleto: "Élcio Prado",
    cpf: "",
    cargo: "Coordenador",
    dataAdmissao: "2020-01-15",
    horarioTrabalhoInicio: "08:00",
    horarioTrabalhoFim: "17:00",
  },
  {
    nomeCompleto: "bruno alves",
    cpf: "333.333.333-33",
    cargo: undefined,
    dataAdmissao: "2022-06-30",
    horarioTrabalhoInicio: "08:00",
    horarioTrabalhoFim: "12:00",
    dataRescisao: "2025-11-01",
  },
];

const nomes = (l: FuncionarioOrdenavel[]) => l.map((f) => f.nomeCompleto);

describe("ordenarFuncionarios — lista de Funcionários (Ativos/Desligados)", () => {
  it("ordem inicial é Nome A-Z, ignorando caixa e acento, para qualquer aba", () => {
    expect(ORDENACAO_PADRAO).toEqual({ coluna: "nome", direcao: "asc" });
    expect(nomes(ordenarFuncionarios(base, ORDENACAO_PADRAO))).toEqual([
      "Ana Lima",
      "bruno alves",
      "Élcio Prado",
      "Maria Souza",
    ]);
    const desligados = base.filter((f) => f.dataRescisao);
    expect(nomes(ordenarFuncionarios(desligados, ORDENACAO_PADRAO))).toEqual([
      "Ana Lima",
      "bruno alves",
    ]);
  });

  it("Nome Z-A inverte a ordem", () => {
    expect(nomes(ordenarFuncionarios(base, { coluna: "nome", direcao: "desc" }))).toEqual([
      "Maria Souza",
      "Élcio Prado",
      "bruno alves",
      "Ana Lima",
    ]);
  });

  it("Admissão: cronológica, com valor em branco sempre no fim (asc e desc)", () => {
    expect(nomes(ordenarFuncionarios(base, { coluna: "admissao", direcao: "asc" }))).toEqual([
      "Élcio Prado",
      "bruno alves",
      "Maria Souza",
      "Ana Lima",
    ]);
    expect(nomes(ordenarFuncionarios(base, { coluna: "admissao", direcao: "desc" }))).toEqual([
      "Maria Souza",
      "bruno alves",
      "Élcio Prado",
      "Ana Lima",
    ]);
  });

  it("CPF e Cargo: compara o valor e joga vazio para o fim", () => {
    expect(nomes(ordenarFuncionarios(base, { coluna: "cpf", direcao: "asc" }))).toEqual([
      "Ana Lima",
      "Maria Souza",
      "bruno alves",
      "Élcio Prado",
    ]);
    expect(nomes(ordenarFuncionarios(base, { coluna: "cargo", direcao: "desc" }))).toEqual([
      "Maria Souza",
      "Élcio Prado",
      "Ana Lima",
      "bruno alves",
    ]);
  });

  it("Rescisão (desligamento) continua disponível como opção, mais recente primeiro em desc", () => {
    const desligados = base.filter((f) => f.dataRescisao);
    expect(nomes(ordenarFuncionarios(desligados, { coluna: "rescisao", direcao: "desc" }))).toEqual(
      ["Ana Lima", "bruno alves"],
    );
  });

  it("Horário e Status: ordena pelo início do turno e pelo rótulo, empate por nome", () => {
    expect(nomes(ordenarFuncionarios(base, { coluna: "horario", direcao: "asc" }))).toEqual([
      "Ana Lima",
      "bruno alves",
      "Élcio Prado",
      "Maria Souza",
    ]);
    expect(nomes(ordenarFuncionarios(base, { coluna: "status", direcao: "asc" }))).toEqual([
      "Élcio Prado",
      "Maria Souza",
      "Ana Lima",
      "bruno alves",
    ]);
  });

  it("não altera a lista original", () => {
    const copia = [...base];
    ordenarFuncionarios(base, { coluna: "cargo", direcao: "asc" });
    expect(base).toEqual(copia);
  });
});

describe("alternarOrdenacao — clique no cabeçalho", () => {
  it("mesma coluna alterna asc/desc; outra coluna começa em asc", () => {
    const a = alternarOrdenacao(ORDENACAO_PADRAO, "nome");
    expect(a).toEqual({ coluna: "nome", direcao: "desc" });
    expect(alternarOrdenacao(a, "nome")).toEqual({ coluna: "nome", direcao: "asc" });
    expect(alternarOrdenacao(a, "admissao")).toEqual({ coluna: "admissao", direcao: "asc" });
  });
});
