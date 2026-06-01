-- Remove ghost child transactions created by previous reconciliation split logic.
DELETE FROM public.transactions WHERE parent_transaction_id IS NOT NULL;

-- Detach reconciliation items from the deleted child transactions.
UPDATE public.boleto_reconciliation_items SET transaction_id = NULL WHERE transaction_id IS NOT NULL;