-- Cobrança — automação via WhatsApp Cloud API (Meta) + rastreamento por webhook.
--
-- Estende a tabela `whatsapp_billing_logs` (criada para o envio manual/régua) para
-- suportar o disparo automático via API Oficial da Meta e o ciclo de status
-- atualizado pelos webhooks (enviado → entregue → lido / falha).
--
-- Compatibilidade: os status legados ('sucesso'/'erro') continuam válidos para os
-- registros já existentes do envio manual. Os novos status do ciclo da Cloud API
-- são: 'pendente', 'enviado', 'entregue', 'lido', 'falha'.
--
-- `wa_message_id` é o ID da mensagem retornado pela Meta (wamid...), usado para
-- correlacionar os eventos de status recebidos pelo webhook.

ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS aluno_name text NOT NULL DEFAULT '';
ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS valor numeric NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS vencimento date;
ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS wa_message_id text;
ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS template_name text;

-- Amplia o CHECK de status para o ciclo da Cloud API, preservando os legados.
ALTER TABLE public.whatsapp_billing_logs
  DROP CONSTRAINT IF EXISTS whatsapp_billing_logs_status_check;
ALTER TABLE public.whatsapp_billing_logs
  ADD CONSTRAINT whatsapp_billing_logs_status_check
  CHECK (status IN ('sucesso', 'erro', 'pendente', 'enviado', 'entregue', 'lido', 'falha'));

CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_wa_message_id_idx
  ON public.whatsapp_billing_logs (wa_message_id);
CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_vencimento_idx
  ON public.whatsapp_billing_logs (vencimento);
