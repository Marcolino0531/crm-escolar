
CREATE TABLE public.reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  reconciled_date DATE NOT NULL,
  total_amount NUMERIC NOT NULL,
  items_count INTEGER NOT NULL DEFAULT 0,
  source_filename TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all reconciliations" ON public.reconciliations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.boleto_category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_label TEXT NOT NULL UNIQUE,
  revenue_category_id UUID,
  revenue_subcategory_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.boleto_category_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all boleto_map" ON public.boleto_category_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true);
