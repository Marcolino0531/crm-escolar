
CREATE TABLE public.sub_cost_centers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cost_center_id UUID NOT NULL REFERENCES public.cost_centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sub_cost_centers_cc ON public.sub_cost_centers(cost_center_id);

ALTER TABLE public.sub_cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all sub_cc" ON public.sub_cost_centers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.transactions
  ADD COLUMN sub_cost_center_id UUID REFERENCES public.sub_cost_centers(id) ON DELETE SET NULL;
