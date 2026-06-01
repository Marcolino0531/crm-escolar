
ALTER TABLE public.categorization_rules
  ALTER COLUMN cost_center_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','revenue')),
  ADD COLUMN IF NOT EXISTS sub_cost_center_id uuid REFERENCES public.sub_cost_centers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS revenue_category_id uuid REFERENCES public.revenue_categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS revenue_subcategory_id uuid REFERENCES public.revenue_subcategories(id) ON DELETE CASCADE;
