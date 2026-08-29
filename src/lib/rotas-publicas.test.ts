import { describe, expect, it } from "vitest";

import { ehRotaPublica } from "@/lib/rotas-publicas";

describe("rotas públicas dos portais", () => {
  it("libera /rematricula sem sessão de administrador", () => {
    expect(ehRotaPublica("/rematricula")).toBe(true);
    expect(ehRotaPublica("/rematricula/")).toBe(true);
  });

  it("libera a verificação do link mágico enviado por email", () => {
    expect(ehRotaPublica("/rematricula/verificar")).toBe(true);
  });

  it("libera os demais portais dos pais", () => {
    expect(ehRotaPublica("/portal-cantina")).toBe(true);
    expect(ehRotaPublica("/matricula")).toBe(true);
  });

  it("mantém o login interno nos painéis administrativos equivalentes", () => {
    expect(ehRotaPublica("/rematricula-acompanhamento")).toBe(false);
    expect(ehRotaPublica("/matriculas")).toBe(false);
    expect(ehRotaPublica("/")).toBe(false);
    expect(ehRotaPublica("/configuracoes")).toBe(false);
  });
});
