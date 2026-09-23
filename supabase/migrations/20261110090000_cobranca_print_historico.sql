-- Cobrança: histórico de substituições do print de uma mensagem já registrada.
-- [{ "em": timestamptz, "por": uuid,
--    "data_envio_de": "YYYY-MM-DD" | null, "data_envio_para": "YYYY-MM-DD" | null }]
ALTER TABLE public.cobranca_mensagens
  ADD COLUMN IF NOT EXISTS print_historico jsonb NOT NULL DEFAULT '[]'::jsonb;
