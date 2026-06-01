-- Add color to revenue_categories
ALTER TABLE public.revenue_categories
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#10b981';

-- Initial balance per school (and optional reference date)
CREATE TABLE IF NOT EXISTS public.initial_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  reference_date date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, reference_date)
);

ALTER TABLE public.initial_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all initial_balances"
  ON public.initial_balances
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);