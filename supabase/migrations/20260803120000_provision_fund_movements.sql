-- Cash movements (aportes/resgates) per monthly fund entry.
--
-- The monthly variation of a fund was being computed as a raw balance delta,
-- which mislabels deposits/withdrawals as gains/losses. We add the period's
-- aportes (deposits) and resgates (withdrawals) so the UI can compute the real
-- profitability, isolating it from cash movements:
--
--   rentabilidade = (saldoAtual - saldoAnterior - aportes + resgates) / saldoAnterior
--
-- Both columns default to 0, preserving the current behavior for existing rows
-- (no movement informed => raw balance delta).

ALTER TABLE public.provision_fund_entries
  ADD COLUMN IF NOT EXISTS aportes numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resgates numeric(14, 2) NOT NULL DEFAULT 0;

-- Force PostgREST to reload its schema cache so the REST API immediately sees
-- the new columns.
NOTIFY pgrst, 'reload schema';
