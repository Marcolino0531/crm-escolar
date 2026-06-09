-- Permite o status "scheduled" (Agendado) nas despesas previstas, além de
-- "pending" (Pendente) e "paid" (Pago). Agendado segue contando no total de
-- despesas previstas; só "paid" sai da previsão.
ALTER TABLE public.recurring_forecasts
  DROP CONSTRAINT IF EXISTS recurring_forecasts_status_check;

ALTER TABLE public.recurring_forecasts
  ADD CONSTRAINT recurring_forecasts_status_check
  CHECK (status IN ('pending', 'scheduled', 'paid'));
