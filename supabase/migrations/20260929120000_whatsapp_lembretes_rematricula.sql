-- Mensagens Automáticas — lembrete SEMANAL de rematrícula (tipo 'rematricula').
--
-- O histórico mora na mesma tabela das outras réguas (whatsapp_billing_logs),
-- separado pela coluna `tipo`. Cada linha guarda o aluno, o template usado e o
-- resultado; `status_rematricula` registra o status do acompanhamento NO
-- MOMENTO do envio ('nao_iniciado' ou 'em_andamento'), para a auditoria saber
-- por que aquele responsável recebeu aquele template.
--
-- Idempotência igual às demais réguas: decidida antes do envio pelo cron, por
-- (tipo, data_ref, unidade, fatura_id = AlunoID); sem índice único, para nunca
-- perder o registro de uma mensagem já entregue à Meta.

ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS status_rematricula text;

CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_rematricula_dia_idx
  ON public.whatsapp_billing_logs (tipo, data_ref, unidade, fatura_id)
  WHERE tipo = 'rematricula';
