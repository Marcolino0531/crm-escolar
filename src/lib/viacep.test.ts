import { describe, expect, it, vi } from "vitest";
import { completarUfPeloCep, type EnderecoViaCep } from "./viacep";

const viaCep = (uf: string): EnderecoViaCep => ({ logradouro: "", bairro: "", cidade: "", uf });

describe("completarUfPeloCep", () => {
  it("preenche a UF pelo CEP só de quem veio sem Estado", async () => {
    const buscar = vi.fn(async (cep: string) => (cep === "30.882-670" ? viaCep("mg") : null));
    const [aluno, mae, pai, sp] = await completarUfPeloCep(
      [
        { nome: "Aluno", cep: "30.882-670", uf: "" },
        { nome: "Mãe", cep: "30.882-670", uf: "" },
        { nome: "Pai", cep: "", uf: "" },
        { nome: "SP", cep: "01001-000", uf: "SP" },
      ],
      buscar,
    );
    expect(aluno.uf).toBe("MG");
    expect(mae.uf).toBe("MG");
    expect(pai.uf).toBe("");
    expect(sp.uf).toBe("SP");
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("mantém vazio quando o ViaCEP não conhece o CEP ou falha", async () => {
    const [semRetorno, semUf] = await completarUfPeloCep(
      [
        { cep: "99999-999", uf: "" },
        { cep: "30.882-670", uf: "" },
      ],
      async (cep) => (cep === "99999-999" ? null : viaCep("")),
    );
    expect(semRetorno.uf).toBe("");
    expect(semUf.uf).toBe("");
  });

  it("não consulta CEP incompleto", async () => {
    const buscar = vi.fn(async () => viaCep("MG"));
    const [r] = await completarUfPeloCep([{ cep: "3088", uf: "" }], buscar);
    expect(r.uf).toBe("");
    expect(buscar).not.toHaveBeenCalled();
  });
});
