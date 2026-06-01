-- Suporte a desmembramento (split) de transações: cada transação filha referencia a transação pai (linha original do extrato)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS parent_transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_transactions_parent ON public.transactions(parent_transaction_id);

-- Vínculo opcional do item de conciliação à transação filha criada
ALTER TABLE public.boleto_reconciliation_items
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;