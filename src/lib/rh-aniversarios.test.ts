import { describe, expect, it } from "vitest";
import { aniversariantesDoMes, mesAtual } from "./rh-aniversarios";

const base = [
  { id: "a", nomeCompleto: "Ana", cargo: "Professora", dataNascimento: "1990-03-25" },
  { id: "b", nomeCompleto: "Bruno", cargo: "Auxiliar", dataNascimento: "1975-03-02" },
  { id: "c", nomeCompleto: "Carla", cargo: "Coordenadora", dataNascimento: "2001-03-10" },
  { id: "d", nomeCompleto: "Dora", dataNascimento: "1980-04-01" },
  { id: "e", nomeCompleto: "Edu", dataNascimento: "" },
  { id: "f", nomeCompleto: "Fábio" },
  {
    id: "g",
    nomeCompleto: "Gil",
    dataNascimento: "1960-03-01",
    dataRescisao: "2025-12-31",
  },
];

describe("aniversariantesDoMes", () => {
  it("ordena pelo dia do mês, não pelo ano de nascimento", () => {
    const lista = aniversariantesDoMes(base, 3);
    expect(lista.map((a) => a.nome)).toEqual(["Bruno", "Carla", "Ana"]);
    expect(lista[0]).toMatchObject({ dia: 2, mes: 3, data: "02/03", cargo: "Auxiliar" });
  });

  it("ignora quem não tem data de nascimento", () => {
    const ids = aniversariantesDoMes(base, 3).map((a) => a.id);
    expect(ids).not.toContain("e");
    expect(ids).not.toContain("f");
  });

  it("ignora quem tem rescisão preenchida", () => {
    expect(aniversariantesDoMes(base, 3).map((a) => a.id)).not.toContain("g");
  });

  it("mês sem aniversariantes devolve lista vazia", () => {
    expect(aniversariantesDoMes(base, 7)).toEqual([]);
  });

  it("desempata o mesmo dia por nome", () => {
    const lista = aniversariantesDoMes(
      [
        { id: "1", nomeCompleto: "Zeca", dataNascimento: "1999-05-15" },
        { id: "2", nomeCompleto: "Alice", dataNascimento: "1980-05-15" },
      ],
      5,
    );
    expect(lista.map((a) => a.nome)).toEqual(["Alice", "Zeca"]);
  });

  it("mesAtual é 1–12", () => {
    expect(mesAtual(new Date(2026, 0, 10))).toBe(1);
    expect(mesAtual(new Date(2026, 11, 10))).toBe(12);
  });
});
