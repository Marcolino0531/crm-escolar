ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.recurring_forecasts ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.recurring_series ADD COLUMN IF NOT EXISTS notes text;