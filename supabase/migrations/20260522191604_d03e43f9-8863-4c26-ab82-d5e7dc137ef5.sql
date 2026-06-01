ALTER TABLE public.recurring_forecasts
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.recurring_forecasts
  ALTER COLUMN normalized_key DROP NOT NULL;