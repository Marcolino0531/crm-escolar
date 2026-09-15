// Endpoint nativo do Diário do Aluno.
// Montado a partir do server entry (`src/server.ts`), antes do roteador da app.
//
//   GET /api/diario/cron  — sincronização diária com o Sponte (Vercel Cron)
//
// Executa a MESMA rotina do botão manual "Sincronizar com Sponte", por ano
// letivo: o ano vigente e o seguinte (rematrículas já processadas), ou só o
// ano informado em ?ano=. Atualiza diario_classes, diario_students e os
// vínculos aluno × ano (diario_matriculas_ano) ao fim do expediente.
// Agendado no vercel.json para 00:00 UTC (= 21:00 no horário de Brasília).

import { runDiarioSponteSync, type DiarioSyncResult } from "@/lib/sponte.functions";
import { runAuditoriaDiarioSponte } from "@/lib/diario-auditoria.functions";
import { anoVigenteConfigurado } from "@/lib/rematricula.functions";

// Auditoria diária Plano do Diário × Sponte: uma execução por unidade
// (?unidade=…), agendada em horários distintos no vercel.json para caber no
// tempo de uma função.
const UNIDADES_AUDITORIA = ["CEC", "CEC Baby", "Núcleo Belvedere", "Núcleo Vale do Sereno"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function handleDiarioApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/api/diario/")) return null;

  if (pathname === "/api/diario/cron" && request.method === "GET") {
    // A Vercel envia "Authorization: Bearer <CRON_SECRET>" quando a env existe.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    try {
      const anoParam = url.searchParams.get("ano");
      const anos = anoParam
        ? [Number(anoParam)]
        : await anoVigenteConfigurado().then((v) => [v, v + 1]);
      const resultados: DiarioSyncResult[] = [];
      for (const ano of anos) {
        const res = await runDiarioSponteSync(ano);
        if (res.error) throw new Error(`${ano}: ${res.error}`);
        console.log(
          `[diario] cron ${ano}: ${res.alunos} aluno(s), ${res.turmas} turma(s), ${res.inativados} inativado(s).`,
        );
        resultados.push(res);
      }
      return json({ ok: true, anos: resultados });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[diario] cron falhou:", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  if (pathname === "/api/diario/auditoria" && request.method === "GET") {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && bearer(request) !== cronSecret) {
      return json({ ok: false, error: "não autorizado" }, 401);
    }
    const unidade = url.searchParams.get("unidade") ?? "";
    if (!UNIDADES_AUDITORIA.includes(unidade)) {
      return json({ ok: false, error: "Unidade inválida." }, 400);
    }
    try {
      const res = await runAuditoriaDiarioSponte(unidade, "cron");
      console.log(
        `[diario] auditoria ${unidade}: ${res.alunosAuditados} auditado(s), ${res.alunosComInconsistencia} com inconsistência, ${res.alunosComErro} com erro.`,
      );
      return json({ ok: true, ...res });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[diario] auditoria ${unidade} falhou:`, msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  return json({ ok: false, error: "Rota não encontrada." }, 404);
}
