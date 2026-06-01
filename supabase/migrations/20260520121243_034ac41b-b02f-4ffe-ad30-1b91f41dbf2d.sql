
-- 1. schools table
CREATE TABLE public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read schools" ON public.schools FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert schools" ON public.schools FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update schools" ON public.schools FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete schools" ON public.schools FOR DELETE TO authenticated USING (true);

INSERT INTO public.schools (name) VALUES ('Colégio 1'), ('Colégio 2'), ('Colégio 3'), ('Colégio 4');

-- 2. add school_id to transactions
ALTER TABLE public.transactions ADD COLUMN school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT;

-- Backfill any existing rows to Colégio 1 to allow NOT NULL
UPDATE public.transactions SET school_id = (SELECT id FROM public.schools WHERE name = 'Colégio 1') WHERE school_id IS NULL;

ALTER TABLE public.transactions ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX idx_transactions_school_id ON public.transactions(school_id);

-- 3. Replace public-access policies with authenticated-only
DROP POLICY IF EXISTS "public all cc" ON public.cost_centers;
DROP POLICY IF EXISTS "public all rules" ON public.categorization_rules;
DROP POLICY IF EXISTS "public all tx" ON public.transactions;

CREATE POLICY "auth all cc" ON public.cost_centers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all rules" ON public.categorization_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all tx" ON public.transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
