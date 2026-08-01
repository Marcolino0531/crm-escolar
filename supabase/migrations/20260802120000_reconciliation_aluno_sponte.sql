-- Conciliação manual por Aluno: guarda o vínculo entre a linha do extrato e o
-- aluno do Sponte escolhido pelo operador (casos em que o automático não fecha:
-- PIX no nome do pai com a mãe como responsável financeira, ou transferência
-- entre contas do próprio colégio).
ALTER TABLE public.boleto_reconciliations
  ADD COLUMN IF NOT EXISTS sponte_aluno_id TEXT,
  ADD COLUMN IF NOT EXISTS sponte_aluno_nome TEXT;

-- Rastro do título que originou cada item do rateio, para auditoria posterior
-- ("esta linha do extrato pagou o boleto X do aluno Y").
ALTER TABLE public.boleto_reconciliation_items
  ADD COLUMN IF NOT EXISTS sponte_conta_receber_id TEXT,
  ADD COLUMN IF NOT EXISTS sponte_numero_boleto TEXT,
  ADD COLUMN IF NOT EXISTS sponte_vencimento DATE;

CREATE INDEX IF NOT EXISTS idx_boleto_recon_sponte_aluno
  ON public.boleto_reconciliations(sponte_aluno_id);
