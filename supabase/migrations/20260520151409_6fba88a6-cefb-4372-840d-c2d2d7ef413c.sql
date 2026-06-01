CREATE TABLE public.revenue_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.revenue_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_category_id uuid NOT NULL REFERENCES public.revenue_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions
  ADD COLUMN revenue_category_id uuid REFERENCES public.revenue_categories(id) ON DELETE SET NULL,
  ADD COLUMN revenue_subcategory_id uuid REFERENCES public.revenue_subcategories(id) ON DELETE SET NULL;

ALTER TABLE public.revenue_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all rev_cat" ON public.revenue_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all rev_sub" ON public.revenue_subcategories FOR ALL TO authenticated USING (true) WITH CHECK (true);