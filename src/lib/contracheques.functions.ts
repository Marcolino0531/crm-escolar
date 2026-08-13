// Server functions do envio de contracheques (RH).
//
// O recorte e a cifragem da página acontecem no navegador (o PDF de salários
// não passa por storage); aqui o servidor só valida a permissão, dispara o
// email pela Resend com o anexo já protegido e grava o histórico. A API key da
// Resend nunca vai ao cliente.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getResendConfig, sendEmail } from "@/lib/agenda.email";
import {
  assuntoEmailContracheque,
  corpoEmailContracheque,
  nomeArquivoContracheque,
} from "@/lib/contracheques";

async function assertCanEditRh(userId: string) {
  const { data, error } = await supabaseAdmin.rpc(
    "can_edit_module" as never,
    { _user_id: userId, _module: "rh" } as never,
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem permissão para enviar contracheques.");
}

async function nomeDoUsuario(userId: string): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const nome =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  return nome || (data?.user?.email ?? "");
}

const EnviarInputSchema = z.object({
  employeeId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida."),
  pagina: z.number().int().min(1),
  // PDF de uma página, já protegido por senha no navegador.
  pdfBase64: z.string().min(1).max(15_000_000),
});

export interface EnviarContrachequeResult {
  ok: boolean;
  email?: string;
  error?: string;
}

type FuncionarioRow = {
  id: string;
  school_id: string | null;
  nome_completo: string;
  email: string | null;
};

export const enviarContracheque = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EnviarInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnviarContrachequeResult> => {
    await assertCanEditRh(context.userId);

    const cfg = getResendConfig();
    if (!cfg) {
      return {
        ok: false,
        error: "Envio de email não configurado (defina RESEND_API_KEY e RESEND_FROM).",
      };
    }

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("funcionarios")
      .select("id, school_id, nome_completo, email")
      .eq("id", data.employeeId)
      .maybeSingle();
    if (rowErr) return { ok: false, error: rowErr.message };

    const funcionario = row as unknown as FuncionarioRow | null;
    if (!funcionario) return { ok: false, error: "Funcionário não encontrado." };

    // O email vem do cadastro no servidor, não do payload: quem dispara escolhe
    // a página, não o destinatário.
    const destino = (funcionario.email ?? "").trim();
    if (!destino) {
      return { ok: false, error: `${funcionario.nome_completo} está sem email cadastrado.` };
    }

    const corpo = corpoEmailContracheque({
      nome: funcionario.nome_completo,
      competencia: data.competencia,
    });
    const enviadoPorNome = await nomeDoUsuario(context.userId);

    const registrar = async (status: "enviado" | "falha", extra: Record<string, unknown>) => {
      await supabaseAdmin.from("hr_payslip_sends" as never).insert({
        school_id: funcionario.school_id,
        employee_id: funcionario.id,
        employee_nome: funcionario.nome_completo,
        email: destino,
        competencia: data.competencia,
        pagina: data.pagina,
        status,
        enviado_por: context.userId,
        enviado_por_nome: enviadoPorNome,
        ...extra,
      } as never);
    };

    try {
      const { id } = await sendEmail(cfg, {
        to: [destino],
        subject: assuntoEmailContracheque(data.competencia),
        html: corpo.html,
        text: corpo.text,
        attachments: [
          {
            filename: nomeArquivoContracheque(funcionario.nome_completo, data.competencia),
            content: data.pdfBase64,
          },
        ],
      });
      await registrar("enviado", { provider_message_id: id });
      return { ok: true, email: destino };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await registrar("falha", { erro: msg });
      return { ok: false, email: destino, error: msg };
    }
  });
