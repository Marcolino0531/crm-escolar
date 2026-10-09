import { afterEach, describe, expect, it, vi } from "vitest";

const updateOpts: unknown[] = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: (_v: unknown, opts?: unknown) => {
        updateOpts.push(opts);
        const q = {
          eq: () => q,
          lte: () => q,
          // O banco informa quantas linhas mudaram; nenhuma linha volta no corpo.
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, count: 2500, error: null }).then(resolve),
        };
        return q;
      },
    }),
  },
}));
vi.mock("@/lib/cobranca-acordo.server", () => ({
  sincronizarAcordosDiario: async () => ({ sincronizados: 0, encerrados: 0, falhas: 0 }),
}));
vi.mock("@/lib/cobranca-casos.functions", () => ({
  carregarCasoRow: async () => null,
  hojeYMD: () => "2026-10-09",
}));

import { handleReceivablesApi } from "./receivables.api";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron de recebíveis", () => {
  it("conta no banco os 2500 liberados (sem depender das linhas devolvidas)", async () => {
    vi.stubEnv("CRON_SECRET", "segredo-de-teste");
    const res = await handleReceivablesApi(
      new Request("http://x/api/receivables/cron", {
        headers: { Authorization: "Bearer segredo-de-teste" },
      }),
    );
    const body = (await res!.json()) as { ok: boolean; liberados: number };
    expect(body.ok).toBe(true);
    expect(body.liberados).toBe(2500);
    expect(updateOpts).toEqual([{ count: "exact" }]);
  });
});
