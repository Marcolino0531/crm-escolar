import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  permitidas: null as string[] | null,
  escolas: { "id-cec": "CEC", "id-baby": "CEC Baby" } as Record<string, string>,
}));

vi.mock("@/lib/sponte.functions", () => ({
  allowedSponteUnidades: async () => estado.permitidas,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: estado.escolas[id] ? { name: estado.escolas[id] } : null,
          }),
        }),
      }),
    }),
  },
}));

import {
  MENSAGEM_SEM_UNIDADE,
  exigirEscolaDoUsuario,
  exigirUnidadeDoUsuario,
  unidadeLiberada,
  unidadesDoUsuario,
} from "@/lib/unidade-acesso.server";

describe("unidadeLiberada (regra pura)", () => {
  it("admin passa, inclusive sem unidade", () => {
    expect(unidadeLiberada(null, "CEC")).toBe(true);
    expect(unidadeLiberada(null, "")).toBe(true);
    expect(unidadeLiberada(null, null)).toBe(true);
  });
  it("colégio liberado passa; não liberado, vazio e nulo recusam", () => {
    expect(unidadeLiberada(["CEC"], "CEC")).toBe(true);
    expect(unidadeLiberada(["CEC"], "CEC Baby")).toBe(false);
    expect(unidadeLiberada(["CEC"], "")).toBe(false);
    expect(unidadeLiberada(["CEC"], "  ")).toBe(false);
    expect(unidadeLiberada(["CEC"], null)).toBe(false);
    expect(unidadeLiberada(["CEC"], undefined)).toBe(false);
    expect(unidadeLiberada([], "CEC")).toBe(false);
  });
});

describe("exigirUnidadeDoUsuario / exigirEscolaDoUsuario / unidadesDoUsuario", () => {
  beforeEach(() => {
    estado.permitidas = ["CEC"];
  });

  it("admin passa e unidadesDoUsuario devolve null", async () => {
    estado.permitidas = null;
    expect(await unidadesDoUsuario("u")).toBeNull();
    await expect(exigirUnidadeDoUsuario("u", "CEC Baby")).resolves.toBeUndefined();
    await expect(exigirUnidadeDoUsuario("u", null)).resolves.toBeUndefined();
    await expect(exigirEscolaDoUsuario("u", "id-baby")).resolves.toBeUndefined();
  });

  it("colégio liberado passa", async () => {
    expect(await unidadesDoUsuario("u")).toEqual(["CEC"]);
    await expect(exigirUnidadeDoUsuario("u", "CEC")).resolves.toBeUndefined();
    await expect(exigirEscolaDoUsuario("u", "id-cec")).resolves.toBeUndefined();
  });

  it("colégio não liberado, vazio e nulo recusam com a mensagem padrão", async () => {
    await expect(exigirUnidadeDoUsuario("u", "CEC Baby")).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
    await expect(exigirUnidadeDoUsuario("u", "")).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
    await expect(exigirUnidadeDoUsuario("u", null)).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
    await expect(exigirEscolaDoUsuario("u", "id-baby")).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
    await expect(exigirEscolaDoUsuario("u", "id-inexistente")).rejects.toThrow(
      MENSAGEM_SEM_UNIDADE,
    );
    await expect(exigirEscolaDoUsuario("u", "")).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
    await expect(exigirEscolaDoUsuario("u", null)).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
    expect(MENSAGEM_SEM_UNIDADE).toBe("Sem permissão para esta unidade.");
  });

  it("usuário sem colégio recusa tudo", async () => {
    estado.permitidas = [];
    await expect(exigirUnidadeDoUsuario("u", "CEC")).rejects.toThrow(MENSAGEM_SEM_UNIDADE);
  });
});
