-- Cobrança Automática — recorrência diária agrupada por responsável.
--
-- Um disparo passa a cobrir TODAS as parcelas vencidas do responsável (podendo
-- envolver mais de um aluno) numa única mensagem diária. `alunos_cobrados` guarda
-- os alunos incluídos no disparo — [{"id":"883","nome":"..."}] — e é a lista que o
-- cron usa nos dias seguintes para reavaliar quem continua devendo. `fatura_id`
-- (aluno mais antigo do grupo) segue preenchido para o Histórico de Disparos.

ALTER TABLE public.whatsapp_billing_logs
  ADD COLUMN IF NOT EXISTS alunos_cobrados jsonb;

CREATE INDEX IF NOT EXISTS whatsapp_billing_logs_telefone_idx
  ON public.whatsapp_billing_logs (telefone);

NOTIFY pgrst, 'reload schema';
