-- Mensagens Automáticas — régua PREVENTIVA (Lembretes Automáticos).
--
-- O histórico dos lembretes mora na mesma tabela dos disparos de cobrança: o
-- registro é idêntico (responsável, aluno, telefone, valor, vencimento, status,
-- wamid, corpo enviado) e o webhook de status atualiza os dois pelo mesmo
-- `wa_message_id`. O que separa as duas abas é a coluna `tipo`.
--
-- `prazo_lembrete` guarda o prazo do disparo preventivo (D-5, D-3, D-0), que a
-- aba de Lembretes usa para diferenciar visualmente cada linha do histórico.
--
-- `data_ref` é o dia do disparo no fuso de São Paulo, gravado pelo cron: é por
-- ele que a trava de idempotência consulta quem já foi lembrado hoje, sem
-- depender de converter `data_envio` (timestamptz) para data local. A trava é a
-- mesma da cobrança — decidida antes do envio, no cron — e não um índice único:
-- perder o registro de auditoria de uma mensagem JÁ enviada à Meta seria pior
-- que gravar uma linha repetida.

ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'cobranca',
  ADD COLUMN IF NOT EXISTS prazo_lembrete text,
  ADD COLUMN IF NOT EXISTS data_ref date;

CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_tipo_data_idx
  ON public.whatsapp_billing_logs (tipo, data_envio DESC);

CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_tipo_dia_idx
  ON public.whatsapp_billing_logs (tipo, data_ref);
