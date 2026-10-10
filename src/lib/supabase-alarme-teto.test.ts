import { afterEach, describe, expect, it, vi } from "vitest";
import {
  avisoDeTeto,
  fetchComAlarmeDeTeto,
  linhasDoContentRange,
  origemDaChamada,
} from "@/lib/supabase-alarme-teto";

const BASE = "https://exemplo.supabase.co/rest/v1/";

function resposta(contentRange: string | null) {
  const headers = new Headers();
  if (contentRange) headers.set("content-range", contentRange);
  return new Response("[]", { status: 200, headers });
}

function montar(contentRange: string | null) {
  const res = resposta(contentRange);
  const base = vi.fn(async () => res);
  return { res, base, f: fetchComAlarmeDeTeto(base as unknown as typeof fetch) };
}

afterEach(() => vi.restoreAllMocks());

describe("alarme do teto de 1000 linhas", () => {
  it("conta as linhas do Content-Range", () => {
    expect(linhasDoContentRange("0-999/*")).toBe(1000);
    expect(linhasDoContentRange("0-999/2500")).toBe(1000);
    expect(linhasDoContentRange("0-998/*")).toBe(999);
    expect(linhasDoContentRange("*/0")).toBeNull();
    expect(linhasDoContentRange(null)).toBeNull();
  });

  it("avisa leitura sem paginação com exatamente 1000 linhas, com a tabela e a URL sem query", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { f, res } = montar("0-999/*");
    const r = await f(`${BASE}tasks?select=id&cpf=eq.12345678900`, { method: "GET" });
    expect(r).toBe(res);
    expect(r.bodyUsed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("tasks");
    expect(msg).toContain("https://exemplo.supabase.co/rest/v1/tasks");
    expect(msg).not.toContain("cpf");
    expect(msg).not.toContain("12345678900");
  });

  it("avisa RPC (POST) que devolve 1000 linhas", () => {
    expect(avisoDeTeto(`${BASE}rpc/listar_coisas`, "POST", new Headers(), "0-999/*")).toContain(
      "rpc/listar_coisas",
    );
  });

  it("não avisa leituras do selectAll/fetchAllRows nem as paginadas explicitamente", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { f } = montar("0-999/*");
    await f(`${BASE}tasks?select=id&order=id.asc&offset=0&limit=1000`);
    await f(`${BASE}tasks?select=id&order=id.asc&offset=1000&limit=1000`);
    await f(`${BASE}tasks?select=id&limit=1000`);
    await f(`${BASE}tasks?select=id`, { headers: { Range: "0-999" } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("não avisa abaixo do teto, escrita, contagem ou fora do PostgREST", () => {
    const h = new Headers();
    expect(avisoDeTeto(`${BASE}tasks?select=id`, "GET", h, "0-998/*")).toBeNull();
    expect(avisoDeTeto(`${BASE}tasks?select=id`, "POST", h, "0-999/*")).toBeNull();
    expect(avisoDeTeto(`${BASE}tasks?select=id`, "PATCH", h, "0-999/*")).toBeNull();
    expect(avisoDeTeto(`${BASE}tasks?select=id`, "HEAD", h, "*/2500")).toBeNull();
    expect(avisoDeTeto("https://exemplo.supabase.co/auth/v1/user", "GET", h, "0-999/*")).toBeNull();
  });

  it("engole erro do próprio alarme e devolve a resposta normal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console quebrado");
    });
    const { f, res } = montar("0-999/*");
    await expect(f(`${BASE}tasks?select=id`)).resolves.toBe(res);
    const { f: f2, res: res2 } = montar("0-999/*");
    await expect(f2(null as unknown as string)).resolves.toBe(res2);
  });

  it("não engole erro da própria requisição", async () => {
    const f = fetchComAlarmeDeTeto((async () => {
      throw new TypeError("rede");
    }) as unknown as typeof fetch);
    await expect(f(`${BASE}tasks`)).rejects.toThrow("rede");
  });

  it("acha a função de origem na pilha, fora do supabase-js", () => {
    const pilha = [
      "Error",
      "    at fetchComAlarmeDeTeto (/app/src/lib/supabase-alarme-teto.ts:40:5)",
      "    at PostgrestBuilder.then (/app/node_modules/@supabase/postgrest-js/dist/index.mjs:10:1)",
      "    at async carregarTarefas (/app/src/routes/tasks.tsx:120:7)",
    ].join("\n");
    expect(origemDaChamada(pilha)).toBe("async carregarTarefas (/app/src/routes/tasks.tsx:120:7)");
    expect(origemDaChamada(undefined)).toBeNull();
  });
});
