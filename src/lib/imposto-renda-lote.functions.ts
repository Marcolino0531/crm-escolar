// Server function do envio em lote da Declaração de IR.
//
// O PDF é gerado no navegador (mesmo gerador do documento individual) e chega
// aqui em base64. O servidor faz o que o cliente não pode fazer: confere a
// permissão de Documentos, descobre no Sponte para QUAL email aquele aluno deve
// ser enviado — o destinatário nunca vem do cliente — e dispara pela Resend com
// a API key que só existe no servidor.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getResendConfig, sendEmail } from "@/lib/agenda.email";
import { anoReferenciaIR } from "@/lib/imposto-renda";
import {
  assuntoEmailIR,
  corpoEmailIR,
  emailValido,
  nomeAnexoDeclaracaoIR,
} from "@/lib/imposto-renda-lote";
import { emailResponsavelFinanceiroLoteIR } from "@/lib/sponte.functions";

const EnvioInputSchema = z.object({
  unidade: z.string().min(1),
  alunoId: z.string().regex(/^\d+$/, "AlunoID inválido."),
  alunoNome: z.string().min(1).max(200),
  anoIR: z.number().int().min(2000).max(2100),
  nomeColegio: z.string().max(200),
  pdfBase64: z.string().min(1),
});

export type EnvioDeclaracaoIRResult = {
  ok: boolean;
  email: string;
  error?: string;
};

export const enviarDeclaracaoIREmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EnvioInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnvioDeclaracaoIRResult> => {
    const { data: pode, error: permErro } = await supabaseAdmin.rpc(
      "can_edit_module" as never,
      { _user_id: context.userId, _module: "documentos" } as never,
    );
    if (permErro) return { ok: false, email: "", error: permErro.message };
    if (!pode) {
      return { ok: false, email: "", error: "Você não tem permissão para emitir documentos." };
    }

    const cfg = getResendConfig();
    if (!cfg) {
      return {
        ok: false,
        email: "",
        error: "Envio de email não configurado (defina RESEND_API_KEY e RESEND_FROM).",
      };
    }

    const { responsavel, error } = await emailResponsavelFinanceiroLoteIR(
      context.userId,
      data.unidade,
      data.alunoId,
    );
    if (error) return { ok: false, email: "", error };
    const destino = (responsavel?.responsavelEmail ?? "").trim();
    if (!emailValido(destino)) {
      return { ok: false, email: destino, error: "Responsável financeiro sem email no Sponte." };
    }

    const corpo = corpoEmailIR({
      responsavelNome: responsavel?.responsavelNome ?? "",
      alunoNome: data.alunoNome,
      anoIR: data.anoIR,
      anoReferencia: anoReferenciaIR(data.anoIR),
      nomeColegio: data.nomeColegio,
    });

    try {
      await sendEmail(cfg, {
        to: [destino],
        subject: assuntoEmailIR(data.anoIR, data.nomeColegio),
        html: corpo.html,
        text: corpo.text,
        attachments: [
          {
            filename: nomeAnexoDeclaracaoIR(data.alunoNome, data.anoIR),
            content: data.pdfBase64,
          },
        ],
      });
      return { ok: true, email: destino };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, email: destino, error: msg };
    }
  });
