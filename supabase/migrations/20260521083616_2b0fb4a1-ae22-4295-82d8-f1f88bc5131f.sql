CREATE TABLE public.recurring_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  month date NOT NULL,
  normalized_key text NOT NULL,
  description text NOT NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  sub_cost_center_id uuid REFERENCES public.sub_cost_centers(id) ON DELETE SET NULL,
  projected_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, month, normalized_key)
);

CREATE INDEX idx_recurring_forecasts_school_month ON public.recurring_forecasts(school_id, month);

ALTER TABLE public.recurring_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all recurring_forecasts"
ON public.recurring_forecasts
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);