CREATE TABLE public.recurring_series (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL,
  description text NOT NULL,
  cost_center_id uuid,
  sub_cost_center_id uuid,
  projected_amount numeric NOT NULL DEFAULT 0,
  due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  start_month date NOT NULL,
  end_month date,
  skipped_months date[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recurring_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read recurring_series" ON public.recurring_series
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin insert recurring_series" ON public.recurring_series
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admin update recurring_series" ON public.recurring_series
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admin delete recurring_series" ON public.recurring_series
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.recurring_forecasts
  ADD COLUMN series_id uuid REFERENCES public.recurring_series(id) ON DELETE SET NULL;

CREATE INDEX idx_recurring_forecasts_series ON public.recurring_forecasts(series_id);
CREATE INDEX idx_recurring_series_school ON public.recurring_series(school_id);